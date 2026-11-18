import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ analyze: vi.fn(), bootstrap: vi.fn(), report: vi.fn() }))
vi.mock('@core/pipelines/video-analysis.js', () => ({ runVideoAnalysis: mock.analyze }))
vi.mock('../apps/bcc-cli/src/context.js', () => ({ bootstrap: mock.bootstrap }))
vi.mock('../apps/bcc-cli/src/output.js', () => ({
  reportOutput: mock.report, resolveMasterArg: (value: string) => value, UsageError: class extends Error {},
}))
import { runAnalyzeCommand } from '../apps/bcc-cli/src/commands/analyze.js'

let dir: string
let video: string
let out: string
beforeEach(async () => {
  vi.resetAllMocks()
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-analyze-cli-'))
  video = path.join(dir, 'input.mp4')
  out = path.join(dir, 'result.md')
  await fs.writeFile(video, 'video')
  vi.stubEnv('GEMINI_API_KEY', 'environment-key')
  vi.stubEnv('GEMINI_MODEL', 'environment-model')
  mock.bootstrap.mockResolvedValue({ config: { gemini: { api_key: 'configured-key', model: 'configured' } } })
  mock.analyze.mockResolvedValue('剧本结果')
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs() })

describe('analyze CLI 契约', () => {
  it('传递指定模型、临时环境密钥并报告文件绝对路径', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'environment-key')
    await runAnalyzeCommand([video, '--task', 'script', '--model', 'chosen', '--out', out])
    expect(mock.analyze.mock.calls[0][0]).toMatchObject({ model: 'chosen', config: { gemini: { api_key: 'environment-key' } } })
    expect(await fs.readFile(out, 'utf8')).toBe('剧本结果')
    expect(mock.report).toHaveBeenCalledWith(out, false)
    expect(mock.bootstrap).toHaveBeenCalledWith(expect.objectContaining({ noConfig: true }))
    expect((await mock.bootstrap.mock.results[0].value).config.gemini.api_key).toBe('configured-key')
  })

  it('缺省使用 GEMINI_MODEL，而非本地配置或内置模型', async () => {
    await runAnalyzeCommand([video, '--task', 'script', '--out', out])
    expect(mock.analyze.mock.calls[0][0]).toMatchObject({
      model: 'environment-model',
      config: { gemini: { model: 'environment-model', api_key: 'environment-key' } },
    })
  })

  it.each(['GEMINI_API_KEY', 'GEMINI_MODEL'])('缺少或空白 %s 时不初始化、不调用 API', async (name) => {
    vi.stubEnv(name, '  ')
    await expect(runAnalyzeCommand([video, '--task', 'script', '--out', out])).rejects.toThrow(name)
    expect(mock.bootstrap).not.toHaveBeenCalled()
    expect(mock.analyze).not.toHaveBeenCalled()
  })

  it('显式 --model 可以覆盖未设置的 GEMINI_MODEL', async () => {
    vi.stubEnv('GEMINI_MODEL', '')
    await runAnalyzeCommand([video, '--task', 'script', '--out', out, '--model', 'explicit-model'])
    expect(mock.analyze.mock.calls[0][0].model).toBe('explicit-model')
  })

  it('分析失败不覆盖旧结果、不输出成功路径', async () => {
    await fs.writeFile(out, 'old result')
    mock.analyze.mockRejectedValue(new Error('API failed'))
    await expect(runAnalyzeCommand([video, '--task', 'script', '--out', out])).rejects.toThrow('API failed')
    expect(await fs.readFile(out, 'utf8')).toBe('old result')
    expect(mock.report).not.toHaveBeenCalled()
  })

  it('错误输入在联网和分析前被拒绝', async () => {
    for (const args of [
      [video, video, '--task', 'script', '--out', out],
      [video, '--task', 'storyboard', '--out', out],
      [video, '--task', 'script', '--out', out, '--model', ' '],
    ]) await expect(runAnalyzeCommand(args)).rejects.toThrow()
    expect(mock.bootstrap).not.toHaveBeenCalled()
    expect(mock.analyze).not.toHaveBeenCalled()
  })
})
