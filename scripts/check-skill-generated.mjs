import { execFileSync } from 'node:child_process'

// git diff 不检查新生成但未跟踪的块，必须同时检查 untracked 文件。
const changed = execFileSync('git', [
  'status', '--porcelain', '--untracked-files=all', '--',
  'skills/bcc/bin', 'THIRD_PARTY_NOTICES.md', 'skills/bcc/THIRD_PARTY_NOTICES.md',
], { encoding: 'utf8' })
if (changed.trim()) {
  console.error('skill 分发产物或许可声明未与源码同步，请重建并提交完整产物：\n' + changed)
  process.exitCode = 1
}
