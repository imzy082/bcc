import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '@shared/types'
import { STORYBOARD_DESCRIPTION_LABELS } from '@shared/defaults'

const mock = vi.hoisted(() => ({ analyze: vi.fn(), script: vi.fn(), construct: vi.fn(), detect: vi.fn(), probe: vi.fn() }))
vi.mock('@core/services/gemini.js', () => ({
  GeminiService: class { constructor(config: unknown) { mock.construct(config) }; analyzeVideos = mock.analyze; generateScript = mock.script },
}))
vi.mock('@core/services/storyboard-manager.js', () => ({ detectAndCaptureShots: mock.detect }))
vi.mock('@core/services/video.js', () => ({ getVideoInfo: mock.probe, formatHMS: (n: number) => String(n) }))
import { parseVideoStoryboard, runVideoAnalysis } from '@core/pipelines/video-analysis.js'

const shot = () => ({
  number: 1, shotType: '近景', angle: '平视', cameraMove: '推', dialogue: '你好', sound: '雨声',
  description: Object.fromEntries(STORYBOARD_DESCRIPTION_LABELS.map((key) => [key, key === '景别' ? '近景' : '描述'])),
})
const config = {
  script_provider: 'openai', storyboard_provider: 'openai',
  gemini: { api_key: 'fake', model: 'configured-model', video_resolution: 'low', proxy: '' },
  storyboard: { cut_method: 'smart', max_shots: 200 }, research: {},
} as AppConfig

beforeEach(() => {
  vi.resetAllMocks()
  mock.probe.mockResolvedValue({ durationSec: 10, videoCodec: 'h264', audioCodec: 'aac' })
  mock.detect.mockResolvedValue({ detected: [{ timestamp: 0, score: 0 }], framePaths: [] })
  mock.analyze.mockResolvedValue(JSON.stringify([shot()]))
  mock.script.mockResolvedValue('[00:00:00] 1-1 开场\n小明：你好')
})

describe('skill 指定 Gemini 视频管线', () => {
  it('覆盖本次模型并复用剧本管线，不修改原配置或调用其他 provider', async () => {
    const text = await runVideoAnalysis({ task: 'script', videoPaths: ['a.mp4'], config, model: 'chosen' })
    expect(text).toContain('你好')
    expect(mock.construct).toHaveBeenCalledWith(expect.objectContaining({ model: 'chosen' }))
    expect(mock.script).toHaveBeenCalledOnce()
    expect(config.script_provider).toBe('openai')
    expect(config.gemini.model).toBe('configured-model')
  })

  it('分镜只检测时间轴，视频直接交给 Gemini，时间和声音保留到导出数据', async () => {
    const content = await runVideoAnalysis({ task: 'storyboard', videoPaths: ['a.mp4'], config })
    expect(mock.detect.mock.calls[0][0].framesDir).toBeUndefined()
    expect(mock.analyze.mock.calls[0][0]).toEqual(['a.mp4'])
    const result = JSON.parse(content)
    expect(result.durationSec).toBe(10)
    expect(result.shots[0]).toMatchObject({ startSec: 0, endSec: 10, dialogue: '你好', sound: '雨声' })
  })

  it('研究传入全部视频，不走图片分镜；无音轨信息传给模型', async () => {
    mock.probe.mockResolvedValue({ durationSec: 10, videoCodec: 'h264', audioCodec: '' })
    mock.analyze.mockResolvedValue('# 制作风格\n雨夜\n# 剧本风格\n# 镜头语言分析\n# 创作建议')
    await runVideoAnalysis({ task: 'research', videoPaths: ['a.mp4', 'b.mp4'], config })
    expect(mock.detect).not.toHaveBeenCalled()
    expect(mock.analyze.mock.calls[0][0]).toEqual(['a.mp4', 'b.mp4'])
    expect(mock.analyze.mock.calls[0][1]).toContain('无音轨')
  })

  it('API 失败直接失败，不生成替代结果', async () => {
    mock.analyze.mockRejectedValue(new Error('quota'))
    await expect(runVideoAnalysis({ task: 'storyboard', videoPaths: ['a.mp4'], config })).rejects.toThrow('quota')
    expect(mock.analyze).toHaveBeenCalledOnce()
  })

  it('研究返回缺少章节的内容时不交付', async () => {
    mock.analyze.mockResolvedValue('# 制作风格\n只分析了一部分')
    await expect(runVideoAnalysis({ task: 'research', videoPaths: ['a.mp4'], config })).rejects.toThrow('缺少必要章节')
  })

  it('拒绝漏镜、重复镜号、缺失声音字段或无效景别', () => {
    const boundaries = [{ startSec: 0, endSec: 10, sceneScore: 0 }]
    for (const invalid of [[], [shot(), shot()], [{ ...shot(), number: 2 }], [{ ...shot(), sound: null }], [{ ...shot(), shotType: '猜测' }]]) {
      expect(() => parseVideoStoryboard(JSON.stringify(invalid), boundaries)).toThrow()
    }
  })
})
