# AGENTS.md

本文件是 `imzy082/bcc` 的项目级维护规则。本仓库 fork 自上游 `aixlb/bcc`，需要持续接入上游更新并保留本地需求。`CLAUDE.md` 仅链接本文件，不另存一份规则。

## Fork 迭代与上游同步

- 本仓库为 `imzy082/bcc`，上游为 `aixlb/bcc`。同步前核对远端 URL、目标分支和共同基线；不能将本地 HEAD 直接视为已同步的上游基线。
- [docs/FORK_CHANGES.md](docs/FORK_CHANGES.md) 是本地需求、差异及上游同步状态的唯一台账。每次迭代前读取，完成后同步维护；同一需求更新原条目，不另建重复记录。AGENTS.md 维护规则，台账维护需求与状态，Git 保存代码历史。
- 台账必须记录需求、必须保留的行为、涉及模块、验证命令及结果、当前状态。无法确认的历史差异和上游基线标记为待核实，不将未盘点等同于没有差异。
- 实现优先沿用上游扩展点，避免与需求无关的重构、批量格式化和目录搬迁；提交按独立需求组织，减少后续合并冲突。
- 上游合并在独立分支进行，先检查工作区状态并保护未提交改动，再逐项核对台账中的本地需求。解决冲突必须保留已确认的需求；无 Git 冲突不等于功能验收通过。
- 合并后执行 `npm run check` 和台账中的本地需求专项验证，记录实际合入的上游提交、差异处理结果及验证结果。上游已覆盖的定制，经行为核验后移除重复实现，并更新原需求条目的状态。
- 根 AGENTS.md 的规则变更须先向用户确认具体内容；日常台账维护随已授权任务完成。

## 仓库边界

- `bcc` 是公开 MIT 源码仓库，包含桌面版、CLI、共用核心和 Agent skill。
- DSH 插件在独立公开 MIT 仓库 `aixlb/dsh-bcc` 维护；不要在这里恢复一份插件源码。
- 原 `v2script` 私有源码仓库和独立 skill 仓库停止作为编辑源，不再跨仓库同步。
- 迁移基线、历史保留及兼容约定以 [docs/MIGRATION.md](docs/MIGRATION.md) 为准；发布流程以 [docs/RELEASE.md](docs/RELEASE.md) 为准。

## 结构与职责

| 目录 | 职责 |
|---|---|
| `apps/bcc-desktop/src/` | Electron 主进程、preload、React 界面，适配核心事件与 IPC |
| `apps/bcc-cli/src/` | 纯 Node CLI，解析参数并调用核心 |
| `packages/bcc-core/src/` | 共用管线、运行时、配置、供应商、媒体处理、导出及 shared 契约 |
| `skills/bcc/` | skill 源文档及随版本提交的完整 `bin/` 运行时 |
| `methods/` | 方法论源文档，生成压缩运行时数据 |
| `scripts/` | 构建、打包、发布及冒烟检查 |
| `cli-dist/` | npm 包 README / 配置与 `build:publish` 生成的发布文件 |

业务能力优先放进 `bcc-core`，桌面层与 CLI 层只做宿主适配。核心不得引入 Electron / React 运行时依赖。共享类型和默认值集中维护。

## 兼容约定

- 桌面版 `appId=com.xlbstoryboard.app`、`productName=XLB Storyboard` 保持不变，保留原配置、用户数据与安装身份。更名仓库不等于更名应用数据目录。
- npm 包名保持 `@aixlb/bcc`，命令保持 `bcc`。
- 管线与导出命令的 stdout 输出产物绝对路径；`probe` / `shots` / `master` 按命令契约输出 JSON 或文本。进度和诊断走 stderr，退出码 0/1。
- 原桌面 Releases 与 tag 保留原样，不用新的源码快照覆盖旧 tag。
- skill 保持自包含。改 CLI / 核心后执行 `npm run build:skill`，将完整 `skills/bcc/bin/`（`bcc.cjs` 入口及所有 `.mjs` 块）与源码一起提交、部署，不能只复制入口。生成文件不手工编辑或格式化；修改 TypeScript 源码后重建。
- 修改 `methods/` 或大师清单后执行 `npm run gen:masters`，更新 `packages/bcc-core/src/shared/masters-{meta,data}.ts`；生成文件不手改。仓库中的方法论源可公开，运行产物沿用压缩嵌入方式。

## 开发与验证

```bash
npm ci
npm run dev
npm run check
```

开发与打包使用 Node.js 24 LTS；发布 CLI / skill 的运行时仍支持 Node.js 20+。所有命令从仓库根目录运行。`check` 包含类型检查、测试、桌面构建、CLI 构建和 skill 构建。只对实际改动运行相称检查；发布前执行完整检查和目标平台包内冒烟测试。

不要提交 `config.yaml`、API Key、签名凭据、`node_modules/`、`out/`、安装包及临时检查文件。完整 `skills/bcc/bin/` 是有意提交的分发产物。

## 发布

现有发布流程沿用上游约定：桌面发布到 GitHub Release，CLI 发布到 npm。`publish:skill` 是本地 `build:skill` 的兼容入口，无远端推送。`publish:app` 仍指向上游 `aixlb/bcc` Release；fork 发布前必须核对实际目标，不能假定已随 `origin` 切换。

CI 在本仓库 push / pull request 上验证；手动 Windows / macOS 构建使用当前仓库的 `GITHUB_TOKEN`，无需跨仓库 `RELEASE_TOKEN`。安装依赖使用 `npm ci`。
