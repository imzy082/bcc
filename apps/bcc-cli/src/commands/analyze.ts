import { parseArgs } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import { runVideoAnalysis, type VideoAnalysisTask } from '@core/pipelines/video-analysis.js'
import { bootstrap } from '../context.js'
import { reportOutput, resolveMasterArg, UsageError } from '../output.js'

/** 固定 Google 官方视频 API；输出 md/json 后复用 export，不改变上游图片管线。 */
export async function runAnalyzeCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      task: { type: 'string' }, model: { type: 'string' }, master: { type: 'string' },
      out: { type: 'string', short: 'o' },
      quiet: { type: 'boolean', short: 'q' }, verbose: { type: 'boolean' },
      'ffmpeg-path': { type: 'string' }, 'ffprobe-path': { type: 'string' },
    },
  })
  if (!['script', 'storyboard', 'research'].includes(values.task ?? '') || !values.out || !positionals.length) {
    throw new UsageError('用法: bcc analyze <视频...> --task script|storyboard|research --out <结果.md|分镜.json> [--model Gemini模型ID]')
  }
  const task = values.task as VideoAnalysisTask
  if (task !== 'research' && positionals.length !== 1) throw new UsageError('剧本/分镜一次只接受一个视频')
  if (task === 'research' && values.master !== undefined) throw new UsageError('风格研究不支持 --master')
  if (values.model !== undefined && !values.model.trim()) throw new UsageError('--model 不能为空')
  const out = path.resolve(values.out)
  if (path.extname(out).toLowerCase() !== (task === 'storyboard' ? '.json' : '.md')) {
    throw new UsageError('analyze 只输出分镜 .json 或剧本/风格 .md；成品请用 export 导出')
  }
  const videos = positionals.map((file) => path.resolve(file))
  for (const file of videos) {
    if (file === out) throw new UsageError('输出路径不能覆盖源视频')
    if (!(await fs.stat(file)).isFile()) throw new UsageError(`不是视频文件: ${file}`)
  }
  const masterId = resolveMasterArg(values.master)
  if (values['ffmpeg-path']) process.env.BCC_FFMPEG_PATH = values['ffmpeg-path']
  if (values['ffprobe-path']) process.env.BCC_FFPROBE_PATH = values['ffprobe-path']
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  const model = (values.model ?? process.env.GEMINI_MODEL)?.trim()
  if (!apiKey) throw new UsageError('缺少环境变量 GEMINI_API_KEY，请在调用 skill 的 Agent 环境中设置')
  if (!model) throw new UsageError('缺少环境变量 GEMINI_MODEL，请在 Agent 环境中设置，或显式传入 --model')
  const { config } = await bootstrap({ noConfig: true, network: true, verbose: values.verbose })
  // API Key 和模型只存在于当前进程；不读取文件或回退到内置模型。
  const effectiveConfig = {
    ...config,
    gemini: { ...config.gemini, api_key: apiKey, model },
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  try {
    const content = await runVideoAnalysis({
      task, videoPaths: videos, config: effectiveConfig, model, masterId,
      callbacks: {
        signal: controller.signal,
        onStatus: (status, message) => {
          if (!values.quiet || status === 'cleanup') process.stderr.write(`  ${message}\n`)
        },
      },
    })
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, content, 'utf8')
    reportOutput(out, !!values.quiet)
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}
