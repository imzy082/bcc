# 分镜 / storyboard

用户要求分镜表或逐镜头分析时读取。默认由 Gemini 视频输入分析，导出沿用 xlsx/html。

## API 工作流

```bash
node "$BCC" analyze <视频> --task storyboard --out <工作目录>/分镜.json
node "$BCC" export storyboard --no-config --from <工作目录>/分镜.json --out <成品目录>/分镜.xlsx --format xlsx,html --video <视频>
```

`analyze` 使用核心默认参数检测镜头边界，将时间区间与视频一起交给 Gemini，不抽图供模型分析。用户指定模型时必须传 `--model`；可加 `--master <大师ID>`。导出阶段才自动补充缩略图。

不要改用旧 `storyboard` 命令，它仍是图片分析管线。切镜参数及调参说明见 `reference.md` 的 `shots` 部分；独立 `shots --no-config` 可通过命令参数调整切镜，`analyze` 使用内置默认参数，不读取持久配置。

## 结果契约与验证

结果为 `{"shots":[...],"durationSec":秒数}`；每镜带编号、起止秒数及分析字段。CLI 验证数量、编号与字段，并用检测结果固定时间轴；验证失败不输出本次结果。

| 字段 | 要求 |
|---|---|
| `number` | 1 起连续，与检测区间一一对应 |
| `startSec` / `endSec` | 使用程序给出的镜头边界，不能自行改时间 |
| `shotType` | 特写 / 近景 / 中景 / 全景 / 大全景 / 远景 |
| `angle` / `cameraMove` | 根据视频判断角度与运动；无法确认时明确标注 |
| `description` | 七行：风格限定、景别、视角构图、主体描述、背景设定、细节修饰、光影色调；与核心共享契约一致 |
| `dialogue` | 该区间实际对白，无对白为空；听不清须标注 |
| `sound` | 实际音乐、环境声、音效；无声与无法确认要区分 |

检查首尾覆盖、镜数与明显转场、对白/音效来源及导出文件；检测算法和模型都可能出错，通过结构校验不等于内容逐项准确。不能因看到导出的图片就把本次调用描述为图片分析。

## 用户明确选择宿主 Agent 模式

用 `shots --no-config --no-frames` 获取边界，再让具备视频和音轨输入能力的宿主按区间分析，生成同契约 JSON 后导出。用户明确接受纯图像分析时可用 `shots --no-config --frames-dir <dir>`，但必须披露无法从图片确认声音与完整运镜，不能编造台词/音效。
