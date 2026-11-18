#!/usr/bin/env node
// Generated entry. Deploy the entire bin/ directory; edit TypeScript sources and rebuild.
import('./bcc-main.mjs').catch((error) => {
  console.error('失败: 无法启动 bcc，请确认 bin/ 目录完整。', error.message);
  process.exitCode = 1;
});
