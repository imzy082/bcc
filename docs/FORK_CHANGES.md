# Fork 需求与同步台账

本文件是本地需求、差异及上游同步状态的唯一记录入口；执行规则见 [AGENTS.md](../AGENTS.md)。同一需求持续更新原条目，代码历史由 Git 保存。

## 仓库与基线

| 项目 | 当前记录 |
|---|---|
| 本仓库 | `imzy082/bcc` |
| 上游仓库 | `aixlb/bcc`（用户已确认） |
| 台账建立日期 | 2026-11-18 |
| 建立时本地分支 | `main` |
| 建立时本地 HEAD | `c5536c83de186b61448d4346f1fd1e27ba59a74c`（仅本地快照，非已核验的上游同步基线） |
| 建立时远端 | `origin=git@github.com:imzy082/bcc.git`，未配置 `upstream` |
| 当前远端（2026-11-18） | `origin=git@github.com:imzy082/bcc.git`；`upstream=https://github.com/aixlb/bcc.git` |
| 上游目标分支、共同基线及最近已合入提交 | 待核实；本次未获取或合并上游 |
| 既有本地差异 | 待与上游核对；建立前工作区干净不代表不存在已提交的本地差异 |

## 本地需求

新增条目记录稳定编号、需求、必须保留的行为、涉及模块、验证命令及结果、当前状态；有相关代码提交时可附提交引用。状态可为待实现、已实现、上游已覆盖或已撤销，未完成验证须明确标注。

### FORK-001：持续接入上游并保留本地需求

- 需求：本项目基于开源项目 fork，后续迭代必须可追踪本地定制，支持接入主项目更新。
- 必须保留的行为：迭代前读取、完成后维护本台账；合并上游逐项检查本地需求并验证；未知差异不能被当作不存在；规则与需求分别维护，避免文档漂移。
- 涉及模块：根 `AGENTS.md`、`docs/FORK_CHANGES.md`；`CLAUDE.md` 继续引用根规则。
- 验证命令：`git diff --check`；新文件尚未跟踪时另执行 `git diff --no-index --check /dev/null docs/FORK_CHANGES.md`；`git diff -- AGENTS.md`；`cat docs/FORK_CHANGES.md`；`cat CLAUDE.md`。
- 验证结果：2026-11-18 文档差异与空白检查通过，双向引用及 `CLAUDE.md` 的根规则引用已核对；仅文档变更，未运行业务构建与测试。
- 当前状态：已实现；用户已确认，规则与台账已建立，不涉及业务代码或运行行为变更。

### FORK-002：配置上游远端

- 需求：为当前 checkout 配置 `upstream`，便于后续获取原项目更新。
- 必须保留的行为：`origin` 指向自己的 fork，`upstream` 指向 `aixlb/bcc`；配置远端本身不获取或合并代码。
- 涉及模块：本地 `.git/config`（不随提交分发）、本台账。
- 配置命令：尚无该远端的新 checkout 可执行 `git remote add upstream https://github.com/aixlb/bcc.git`；已有同名远端时先核对地址。
- 验证命令：`git remote -v`；`git config --get-all remote.upstream.fetch`。
- 验证结果：2026-11-18 地址核对通过，fetch 映射为 `+refs/heads/*:refs/remotes/upstream/*`，`origin` 地址保持不变；未验证网络连通性，未执行 fetch 或 merge。
- 当前状态：已实现；仅当前 checkout 的本地配置生效，新 clone 需单独配置。

### FORK-003：通过 skill 使用指定 Gemini 模型分析视频与音轨

- 需求：用户只部署 `skills/bcc/`，由 Agent 调度 Google 官方 Gemini API，使用用户指定模型完成剧本、分镜和风格研究；不把“使用 skill”等同于必须由宿主模型分析。方案已于 2026-11-18 获用户确认。
- 必须保留的行为：skill 自包含；Key 和默认模型由宿主环境提供，`--model` 仅作用户明确指定的单次覆盖；指定模型/API 失败不回退宿主、其他模型或图片；视频保留音轨，无音轨或无法确认时如实说明；导出仍支持 docx/md/txt/xlsx/html。
- 实现：新增 `analyze <视频...> --task script|storyboard|research --out <md|json> [--model ID]`，固定使用 Google 官方 API。剧本复用现有 Gemini 视频管线；分镜只在本地检测时间区间，把视频及时间轴交给模型，严格校验镜数/编号/字段，缩略图留到导出时生成；风格研究一次请求综合全部输入视频，拒绝缺少必要章节的结果。
- 配置（用户于 2026-11-18 明确修订并确认）：宿主 Agent 提供 `GEMINI_API_KEY`、`GEMINI_MODEL`；模型优先级为用户显式 `--model` > `GEMINI_MODEL`。`analyze` 不读写本地配置、不初始化/迁移项目库、不回退文件中的 Key 或内置模型；缺少环境变量时报错。skill 的 `probe` / `shots` / `export` 使用 `--no-config`，同样不读写配置。使用核心默认参数，保留宿主代理变量；旧 CLI 未带 `--no-config` 的行为不变。
- 涉及模块：新增 `apps/bcc-cli/src/commands/analyze.ts` 和 `packages/bcc-core/src/pipelines/video-analysis.ts`；调整 CLI 入口、上下文、Agent 本地工具与 `services/{gemini,config}.ts`；同步 `skills/bcc/SKILL.md`、`reference.md`、三个任务规范、README，并重建完整 `skills/bcc/bin/`。测试位于 `tests/{cli-analyze,cli-no-config,gemini-video,video-analysis}.test.ts`。
- 上游合并注意：保留旧 `storyboard` / `research` 图片管线，视频入口为新增能力；Gemini 请求不再强制 `thinkingLevel: LOW`，以避免对用户指定模型施加不兼容参数。分镜 description 沿用核心共享七项标签，不能恢复 skill 原先另一套标签。上游出现等效视频入口时按上述需求逐项验证后再替换。
- 验证命令：Node 24 下执行 `npm run check`；专项可运行 `npx vitest run tests/gemini-video.test.ts tests/video-analysis.test.ts tests/cli-analyze.test.ts tests/cli-no-config.test.ts`；skill 文档用 skill-creator 的 `quick_validate.py skills/bcc` 验证。
- 验证结果（2026-11-18）：完整检查通过，28 个测试文件、143 项测试通过，桌面/CLI/skill 构建通过。skill 校验通过；Node 24 独立目录冒烟通过：带音轨视频探测、不抽帧时间轴、缺 Key 失败、xlsx 嵌图及 html/docx 导出；Node 20 独立目录启动和失败退出契约通过；后续 Node 20/24 无配置冒烟确认环境模型生效、缺变量报错、已有配置被忽略，且 probe/shots/docx/xlsx 流程不创建配置或项目目录。测试模拟 Gemini 响应并检查视频引用、模型、完整输入与错误传播，未进行真实付费 API 调用。
- 限制与后续：剧本对超过 200 MB 输入压缩并保留音轨，超过两小时分段；分镜/研究直接上传原文件，仍受服务端文件/上下文/输出限制，超限报错而非静默抽帧。尚待宿主环境提供实际 `GEMINI_MODEL` 和 `GEMINI_API_KEY`，并用带可核对对白/声音的视频做真实效果验收；结构检查不能证明语义完全准确。
- 当前状态：代码、文档、分发产物与离线验证已完成；真实 API 联调待宿主环境变量和样片。部署时使用本 fork 的完整 `skills/bcc/`，从上游安装不会获得这些修改；提交与远端同步状态以 Git 历史为准。

### FORK-004：拆分自包含 skill 分发文件

- 需求：原 `skills/bcc/bin/bcc.cjs` 约 6.34 MB，打开、保存和编辑负担大；用户要求保留功能和自包含部署，并拆成多个小文件。完整 bin 提交/部署规则及 skill 文档变更已获确认。
- 必须保留的行为：仍通过 `node skills/bcc/bin/bcc.cjs` 调用；全部原命令和导出格式可用；无需另装 JS 依赖；支持 Node 20+；保留函数/类名与第三方许可。生成文件不手工编辑，修改源码后重建。
- 实现：`scripts/build-skill.mjs` 使用 esbuild ESM 分块及压缩，CJS 小入口加载主模块；为各块提供 Node 内置模块的 require/路径兼容。依赖分割根按 import 条件解析，只写入从 CLI 可达的输出，并清理旧生成块。每块设 512 KiB 上限，行长度目标 160；所有块位于同一 bin 目录，保持相对资源查找基准。
- 涉及模块：构建脚本、publish 兼容入口、完整 `skills/bcc/bin/`、`.gitattributes`、CI 及 `scripts/check-skill-generated.mjs`；同步 AGENTS、README、发布文档与 skill 说明。CI 检查整个 bin 的已修改和未跟踪文件，避免漏提交新块。
- 上游合并注意：完整 bin 是分发单位，不能恢复只提交/部署入口的约定；上游依赖升级若触及体积预算，应重新划分依赖边界而非删除功能。ESM 块仍需兼容依赖中的动态 require，路径基准不能随意移动到更深目录。
- 验证命令：Node 24 下 `npm run check`；`node skills/bcc/bin/bcc.cjs --version`；提交分发产物后执行 `node scripts/check-skill-generated.mjs`。修改分包策略还需对照原构建验证工具、模型请求和导出内容。
- 验证结果（2026-11-18）：143 项测试与全部构建通过。Node 20/24 下，在仓库外对照原未压缩单文件，帮助/版本/方法论/视频探测/时间轴输出一致；三个任务经模拟 HTTP 响应验证视频上传字节、指定模型、请求体、流式解析及结果一致；docx/xlsx/html/txt 导出内容一致（忽略生成时间）。缺块正确失败，生成结果重复构建哈希一致，旧块清理与 CI 未跟踪文件检测通过；116 份依赖许可内容未改变，未调用真实模型 API。
- 当前产物：24 个文件，总计 3,191,982 字节；入口 276 字节，最大块 437,231 字节。相比初始 6,339,146 字节单文件，总体积减少约 49.6%。
- 当前状态：已实现并验证；部署时必须复制完整 `skills/bcc/`，不能只复制小入口；提交与远端同步状态以 Git 历史为准。

## 上游同步记录

尚未执行上游同步。首次同步时先核实目标分支、共同基线和已有本地差异，再补全上方记录。

每次同步记录日期、同步前本地提交、上游来源与分支、实际合入的上游完整提交哈希、合并结果提交（尚未提交则明确注明）、各需求的保留或替代情况，以及 `npm run check` 和专项验证结果。失败或暂未完成的同步保留现状与待办，不能标记为已完成。
