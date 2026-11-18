# bcc 命令参考

CLI 路径：`<skill目录>/bin/bcc.cjs`。所有命令用 `node "<path>/bcc.cjs" <命令> ...` 调用。
`bcc.cjs` 是小型入口，必须与同目录的全部 `.mjs` 运行块一起部署；缺块时重新部署完整 `bin/`。这些文件由构建生成，不手工编辑或格式化。
需要 Node 20+；CLI 已随 skill 分发。`analyze` 调用 Google 官方 Gemini API；`probe` / `shots` / `master` / `export` 是不调用模型的本地工具。

> **任务级详细规范（渐进式披露，开工前必读对应文件）**：
> `references/script.md`（拆剧本）、`references/storyboard.md`（拆分镜）、`references/research.md`（风格研究）。
> 本文件是命令/参数/契约的完整索引。

## 机器契约

| 项 | 约定 |
|----|------|
| stdout | 机器结果：`probe`/`shots`/`master --list` 出 JSON（单行）；`analyze`/`export` 出产物绝对路径（每行一个）；`master <id>` 出方法论文本 |
| stderr | 进度 / 诊断（含 ffmpeg/ffprobe 下载进度与来源日志） |
| 退出码 | 0 成功；1 失败（用法错误前缀 `错误:`，运行失败前缀 `失败:`） |

## Gemini 视频分析

由调用 skill 的 Agent 环境提供以下变量，无需本地配置文件：

| 变量 | 用途 |
|---|---|
| `GEMINI_API_KEY` | Google 官方 API Key，必需；不落盘、不输出其值 |
| `GEMINI_MODEL` | 默认模型 ID；用户显式提供 `--model` 时仅覆盖本次 |
| `HTTPS_PROXY` / `HTTP_PROXY` | 可选网络代理；沿用宿主环境，不被空配置清除 |

```bash
node "$BCC" analyze <视频> --task script --out 剧本.md
node "$BCC" analyze <视频> --task storyboard --out 分镜.json
node "$BCC" analyze <视频1> <视频2> --task research --out 风格指南.md
# 仅在用户明确指定另一个模型时覆盖：
node "$BCC" analyze <视频> --task script --model <模型ID> --out 剧本.md
```

- `--task`、`--out` 必填；剧本/分镜只接受一个视频，研究至少一个；仅支持本地文件。
- 模型优先级为显式 `--model` > `GEMINI_MODEL`，没有本地文件或内置模型回退。Key 缺失或模型未指定时退出 1，不调用 API。
- 模型必须支持当前请求的视频输入，分镜还需 JSON schema 输出；不支持时报告 API 错误，不自动换模型。
- `--master` 用于剧本/分镜，缺省不注入大师附录；`default` 明确不注入。研究不接受此参数。
- 公共参数：`--quiet`、`--verbose`、`--ffmpeg-path`、`--ffprobe-path`。`analyze` 不支持 `--data-dir`，不读写 `config.yaml`，也不初始化或迁移项目库。
- 非认证参数使用核心内置默认值；不会读取本地保存的大师、代理、分镜或研究配置。
- 剧本输出 md，分镜输出 `{shots, durationSec}` JSON，研究输出 md。docx/xlsx/html 使用 `export --no-config` 生成。
- stderr 显示实际 `provider=gemini model=... input=video`。API 失败、输出截断、分镜数量或字段错误时退出 1，不写本次结果，也不回退图片模式。
- 上传后等待视频处理最多 10 分钟；任务结束尝试删除上传文件。分镜/研究入口清理失败会报告服务端文件名；剧本沿用既有后台清理，不能把清理请求当作已确认删除。
- 分镜/研究直接上传原视频；多视频研究在同一次请求中综合全部视频。超出服务端限制时减少单次素材或在用户认可后分段，不静默漏掉输入。

Skill 调用 `probe` / `shots` / `export` 时必须加 `--no-config`，整个工作流均不读取或创建配置文件。旧 CLI 用法不加该参数时仍保留原配置行为；不能把旧用法误用于此 skill 的无配置流程。`master` 无需该参数。

### API 异常处置

| 情况 | 处理 |
|---|---|
| 缺少 Key | 请用户在 Agent 环境设置 `GEMINI_API_KEY`，不索取聊天中的明文密钥 |
| 缺少模型 | 在 Agent 环境设置 `GEMINI_MODEL`，或按用户明确要求传 `--model` |
| 认证/模型不可用/不支持视频或 schema | 核对官方 Key、模型 ID 和权限；报告错误，不自行换模型 |
| 网络失败 | 检查宿主 `HTTPS_PROXY` / `HTTP_PROXY` 与 Google 官方服务连通性 |
| 视频处理失败/超时/上下文或输出超限 | 报告具体错误；在用户认可后缩短或拆分视频，不改用图片猜测 |
| 源视频无音轨 | 明确说明素材无音轨，不能补造对白或音效 |

## bcc probe

```
node bcc.cjs probe <video> --no-config
```

输出单行 JSON（字段与 `bcc shots` 的 video 信息一致）：

```json
{"path":"…","durationSec":92.2,"width":1280,"height":720,"sizeBytes":17008200,
 "format":"mov,mp4,m4a,3gp,3g2,mj2","videoCodec":"h264","audioCodec":"aac","fps":30,"bitrateBps":1475653}
```

用途：拿时长/分辨率判断分段与帧数；不切镜、不抽帧，最快。

## bcc shots（核心）

```
node bcc.cjs shots <video> --no-config [--no-frames|--frames-dir <dir>] [--cut-method smart|scene]
                           [--threshold 0.3] [--hard-min 5.5] [--hard-ratio 8] [--min-gap 0.3]
                           [--max-shots 200] [--quiet]
```

镜头切分（纯算法，无模型），输出单行 JSON。**两种用法**：

- **拆分镜（原版管线）**：`--frames-dir <dir>` → 切镜 + 逐镜抽关键帧（854 宽 jpg），JSON 每镜带 `frame` 路径，供模型逐镜看图分析；
- **拆剧本 / 只要时间轴**：`--no-frames`（缺省）→ 只出镜头边界，不抽帧。

```json
{
  "video": "E:\\...\\a.mp4",
  "durationSec": 25.27,
  "method": "smart",
  "framesDir": "E:\\...\\frames",
  "shots": [
    {"index":1,"startSec":0,"endSec":8.53,"thumbT":0.1,"score":0,"kind":"","frame":"E:\\...\\frames\\frame_00000100.jpg"},
    {"index":2,"startSec":8.53,"endSec":11.3,"thumbT":8.6,"score":0.204,"kind":"hard","frame":"E:\\...\\frames\\frame_00008600.jpg"}
  ]
}
```

字段：

| 字段 | 说明 |
|------|------|
| `index` | 1 起始镜号 |
| `startSec` / `endSec` | 该镜起止（秒）；`endSec` = 下一镜起点或视频总时长 |
| `thumbT` | smart 避开转场白/黑帧的取帧时间点（仅 --frames-dir 抽帧时相关） |
| `score` | 与上一帧场景差异分（0~1，第一镜为 0） |
| `kind` | 切点类型：`hard` 硬切 / `blank` 白黑场 / `front` 擦除锋面 / `dissolve` 叠化 / `sample` 长镜头补帧；首镜为空 |
| `frame` | 仅 `--frames-dir` 模式输出：该镜关键帧绝对路径（文件名 `frame_<毫秒>.jpg`） |

切割方式与调参：

- `smart`（默认）：四检测器混合（硬切/白黑场/锋面/叠化 + 长镜头覆盖补帧），渐变转场更准。
  - `--hard-min`（默认 5.5，0~255 尺度）：硬切最低帧差，**调低更敏感**；
  - `--hard-ratio`（默认 8）：× 局部中位数的倍率门控，排除运镜误报；
  - `--min-gap`（默认 0.3 秒）：切点最小间隔，动画/快切可 0.1~0.15。
- `scene`：经典帧差阈值法。`--threshold`（默认 0.3，0~1）。
- `--max-shots` 上限（默认 200，读配置 `storyboard.max_shots`）。

`--no-config` 下缺省参数使用核心内置默认值，可用命令参数调节；仅旧 CLI 未带此参数时读取本地 `storyboard.*`。

## bcc master

```
node bcc.cjs master --list                      # JSON: [{"id":"shanzhiyin","name":"山之音"}]
node bcc.cjs master <id|名称> [--kind script|storyboard]
```

输出该大师的方法论附录（纯文本，stdout）。用法：把它作为**分析思维框架**喂给你自己的模型（拼进你的分析 prompt / 作为参考材料），提升场景划分、叙事理解、镜头语言分析的专业度。方法论里的交互流程类规则（引导式提问、分步暂停等）一律忽略，输出仍以 SKILL.md 里的格式规范为准。

- `--kind script`（默认）：剧本分析用；`--kind storyboard`：逐镜分析用。

## bcc export

```
node bcc.cjs export script --no-config --from <剧本.md> --out <out> [--format docx,md,txt,html] [--video <视频>] [--name 名称]
node bcc.cjs export storyboard --no-config --from <分镜.json> --out <out> [--format xlsx,html] [--video <视频>] [--name 名称]
```

`--out` 给文件名按扩展名定格式；给目录用默认文件名；`--format a,b` 批量出多份。stdout 每行一个产物绝对路径。

### export script 输入（剧本 md）

场景头行以时间戳开头：`[HH:MM:SS]`、`[MM:SS]`、`【HH:MM:SS】`、`(MM:SS)` 均识别；行首允许 Markdown 前缀（`#`/`>`/`*` 等）。头行其余部分「编号 标题」形式（如 `1-1 大学教室 日/内`）。行内 `△` 开头=画面描述，`【字幕…】`=字幕，`人名：台词`=对白（支持 `VO`/`OS` 后缀）。docx 导出会按这些规则排版（对白行人物加粗着色、△ 行灰色斜体等）。

### export storyboard 输入（分镜 json）

数组，或 `{"shots":[...],"durationSec":123.4,"framePaths":[...]}` 对象。每个 shot：

| 字段 | 必填 | 说明 |
|------|------|------|
| `number` | 否 | 镜号，缺省按序 1..N |
| `shotType` | 否 | 特写/近景/中景/全景/大全景/远景 |
| `angle` | 否 | 平视/俯视/仰视/顶拍… |
| `cameraMove` | 否 | 固定/推/拉/摇/移/跟/手持… |
| `description` | 否 | 七行提示词描述（风格限定/景别/视角构图/主体描述/背景设定/细节修饰/光影色调） |
| `dialogue` / `sound` | 否 | 台词 / 音效 |
| `startSec` | 是 | 镜起点（秒） |
| `endSec` | 否 | 镜终点；缺省=下一镜 startSec 或 durationSec |
| `frame` | 否 | 该镜关键帧绝对路径（沿用 `shots --frames-dir` 的输出）；缺省且给了 `--video` 时 CLI 自动按每镜抽帧补齐 |

xlsx 列：镜号/景别/角度/运镜/关键帧(嵌图)/时长/提示词描述/台词/音效。html 是带缩略图的可视化分镜表。

## ffmpeg / ffprobe 运行时解析

处理视频需要 ffmpeg + ffprobe，按以下优先级解析（找到即停，来源日志打在 stderr `[bcc] ffmpeg 来源(...)`）：

1. `--ffmpeg-path` / `--ffprobe-path` 参数（或环境变量 `BCC_FFMPEG_PATH` / `BCC_FFPROBE_PATH`）；
2. `BCC_RUNTIME_DIR` 目录（或 skill 目录旁的 `runtime/`）下的二进制；
3. 本地 node_modules（供开发/桌面端/安装了依赖的环境复用）；
4. 本机缓存：Windows `%LOCALAPPDATA%\bcc-runtime`，mac/linux `~/.cache/bcc-runtime`（版本子目录 + 平台子目录）；
5. **自动下载**（首次）：ffmpeg 优先从 ffmpeg-static 官方 GitHub Release（按平台 gz，约 40~80MB）、失败回退 npm 源 `@ffmpeg-installer`；ffprobe 优先 `ffprobe-static` tarball、失败回退 `@ffprobe-installer` 单平台包。进度在 stderr；下载失败会给出代理/自备二进制的提示。

相关环境变量：

| 变量 | 作用 |
|------|------|
| `BCC_RUNTIME_DIR` | 运行时根目录（搜索 + 下载缓存都放这里） |
| `BCC_FFMPEG_PATH` / `BCC_FFPROBE_PATH` | 显式二进制路径 |
| `BCC_FFMPEG_URL` / `BCC_FFPROBE_URL` | 覆盖下载地址（镜像源） |
| `BCC_NPM_REGISTRY` | 覆盖 npm 下载源（如 `https://registry.npmmirror.com`） |
| `HTTPS_PROXY` | 下载与网络请求的代理 |
| `BCC_DATA_DIR` | 数据根（config.yaml 与项目库位置；agent 模式几乎用不到） |

## 退出码与错误

| 情况 | 退出码 | 输出 |
|------|--------|------|
| 成功 | 0 | JSON / 产物路径 → stdout |
| 用法错误 | 1 | `错误: ...` → stderr |
| 运行失败（文件不存在/下载失败/无法解码） | 1 | `失败: ...` → stderr |

## 与桌面端 / npm CLI 的关系

- skill 的完整 `bin/` 包含全部 CLI 运行文件，入口为 `bin/bcc.cjs`，无需另装桌面版或 npm 包。
- `analyze` 是本 fork 的指定 Gemini 视频分析入口，独立于 `script_provider` / `storyboard_provider`；同一二进制中的旧 API 管线命令仍保留。
- 用户明确选择宿主 Agent 模式时，才用本地工具组合；宿主必须能实际接收视频与音轨，模型名称本身不能证明宿主接口具备这种能力。
- 成品沿用现有 `export` 格式；模型输出的分镜 description 与核心共享七项标签：风格限定、景别、视角构图、主体描述、背景设定、细节修饰、光影色调。
