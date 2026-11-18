---
name: bcc
description: 把视频拆成剧本、分镜表或风格指南。用户提供视频并要求拆剧本、台词、storyboard、分镜或风格研究，或明确使用 bcc / 包拆拆时使用。自带 CLI，可通过 Google 官方 Gemini API 调用用户指定模型分析视频画面与音轨，并导出 docx/xlsx/html；也保留用户明确选择的宿主 Agent 分析方式。
---

# bcc — 视频分析与成品导出

## 输入与模式

输入为本地视频、任务类型、输出位置，以及用户指定的模型（如有）。CLI 入口位于本文件同级 `bin/bcc.cjs`，无需另装桌面版或 npm CLI。提交、部署时必须保留完整 `bin/`（含 `.mjs` 运行块），不能只复制入口；生成文件不手工编辑，改 TypeScript 源码后运行 `npm run build:skill` 重建。

- **Gemini API 模式（本 fork 的默认流程）**：Agent 调度 CLI，`analyze` 把视频交给 Google 官方 API。宿主 Agent 不需要原生视频能力。用户给出模型 ID 时必须传 `--model`；未指定时读取宿主环境变量 `GEMINI_MODEL` 并告知实际模型，不自行替换。
- **宿主 Agent 模式**：仅在用户明确选择时使用 `probe` / `shots` / `master` / `export`，由宿主分析。必须确认宿主确实能接收视频及音轨；只有看图能力时，不能声称已听取对白或音效。
- 指定模型/API 调用失败时停止并报告原因，不自动换模型、换供应商、改看图片或用宿主补写。

## 前置与配置

1. Node.js 20+；首次处理视频会解析或下载 ffmpeg/ffprobe，网络受限时可传 `--ffmpeg-path` / `--ffprobe-path`。
2. API 模式先读 `reference.md` 的“Gemini 视频分析”部分，检查宿主 Agent 的 `GEMINI_API_KEY` 与 `GEMINI_MODEL` 环境变量是否可用，不输出密钥值。`analyze` 不读取或创建本地配置文件；缺少 Key 或模型时停止并明确报告对应变量名。模型可由用户明确指定的 `--model` 单次覆盖。
3. 本地 `probe` / `shots` / `export` 必须带 `--no-config`，避免初始化本地配置；`master` 本身不读配置。代理与 ffmpeg 路径沿用宿主环境变量。
4. Google 官方 API 与宿主订阅是独立调用。确认用户任务允许把输入视频交给所选 API；用户已明确指定该调用方式时沿用授权。

## 执行流程

按任务只读取对应规范，然后完成分析、结果检查、导出：

| 任务 | 读取 | API 分析结果 | 成品 |
|---|---|---|---|
| 剧本 / 台词 | `references/script.md` | `analyze --task script` → md | `export script` → docx/md/txt/html |
| 分镜 / storyboard | `references/storyboard.md` | `analyze --task storyboard` → json | `export storyboard` → xlsx/html |
| 风格研究 | `references/research.md` | `analyze --task research` → md | md 即成品 |

```bash
BCC="/abs/path/to/skills/bcc/bin/bcc.cjs"
node "$BCC" analyze ./a.mp4 --task script --out ./剧本.md
node "$BCC" export script --from ./剧本.md --out ./剧本.docx --video ./a.mp4 --no-config
```

PowerShell 使用 `$BCC = "C:\abs\path\to\skills\bcc\bin\bcc.cjs"` 和 `node $BCC ...`。

## 职能边界

- `analyze` 固定调用 Google 官方 Gemini API；`--model` 仅覆盖本次模型，不修改持久配置。
- 分镜使用本地算法确定时间区间，模型分析视频；导出时才按需生成缩略图。抽缩略图不代表分析输入是图片。
- 剧本复用核心视频管线，超过 200 MB 会压缩并保留音轨，超过两小时会分段；分镜/风格直接上传所给视频文件。API 的文件、上下文和输出限制仍适用，失败时报告限制，不交付伪完整结果。
- 原 `storyboard` / `research` API 命令仍是图片管线，不能用它们代替本技能的视频分析入口。

## 验证与汇报

按退出码判成功：0 成功，1 失败。stdout 为 `analyze` / `export` 的产物绝对路径，`probe` / `shots` / `master --list` 的 JSON，或 `master <id>` 的方法论文本；进度和诊断在 stderr。

检查任务对应的结果完整性，不能只检查文件存在。汇报实际模型、分析输入为视频、是否含音轨、压缩/分段情况（如有）及产物路径；未经实际观看或核验，不声称逐句准确或完全无遗漏。

失败时按 `reference.md` 排查。保留错误和未完成状态；不得把已有旧文件当作本次成功产物。
