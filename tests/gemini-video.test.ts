import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ upload: vi.fn(), get: vi.fn(), delete: vi.fn(), generate: vi.fn() }))
vi.mock('@google/genai', async (original) => ({
  ...await original<typeof import('@google/genai')>(),
  GoogleGenAI: class {
    files = { upload: api.upload, get: api.get, delete: api.delete }
    models = { generateContentStream: api.generate }
  },
}))
import { GeminiService } from '@core/services/gemini.js'

let dir: string
let video: string
let service: GeminiService
beforeEach(async () => {
  vi.resetAllMocks()
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-gemini-'))
  video = path.join(dir, 'input.mp4')
  await fs.writeFile(video, 'fake video including audio')
  api.upload.mockResolvedValue({ name: 'files/one', uri: 'https://google.example/one', mimeType: 'video/mp4', state: 'ACTIVE' })
  api.delete.mockResolvedValue({})
  api.generate.mockImplementation(async function* () {
    yield { text: '分析结果', candidates: [{ finishReason: 'STOP' }] }
  })
  service = new GeminiService({ api_key: 'test-key', model: 'chosen-video-model', video_resolution: 'high', proxy: '' })
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); vi.useRealTimers() })

describe('Gemini 原视频请求', () => {
  it('上传源文件，发送视频引用和指定模型，不发送图片或强制 thinking 参数', async () => {
    expect(await service.analyzeVideos([video], '分析声音和画面')).toBe('分析结果')
    expect(api.upload).toHaveBeenCalledWith(expect.objectContaining({ file: video, config: expect.objectContaining({ mimeType: 'video/mp4' }) }))
    const request = api.generate.mock.calls[0][0]
    expect(request.model).toBe('chosen-video-model')
    expect(request.contents[0].parts).toContainEqual({ fileData: { fileUri: 'https://google.example/one', mimeType: 'video/mp4' } })
    expect(request.contents[0].parts.every((part: object) => !('inlineData' in part))).toBe(true)
    expect(request.config.thinkingConfig).toBeUndefined()
    expect(api.delete).toHaveBeenCalledWith({ name: 'files/one' })
  })

  it('等待文件 ACTIVE 后才生成', async () => {
    vi.useFakeTimers()
    api.upload.mockResolvedValue({ name: 'files/one', state: 'PROCESSING' })
    api.get.mockResolvedValue({ name: 'files/one', state: 'ACTIVE', uri: 'uri', mimeType: 'video/mp4' })
    const result = service.analyzeVideos([video], '分析')
    await vi.waitFor(() => expect(api.upload).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(2100)
    expect(await result).toBe('分析结果')
    expect(api.get).toHaveBeenCalledOnce()
  })

  it('第二个视频上传失败也清理第一个视频，不生成部分研究结果', async () => {
    api.upload.mockResolvedValueOnce({ name: 'files/one', state: 'ACTIVE', uri: 'uri', mimeType: 'video/mp4' })
      .mockRejectedValueOnce(new Error('upload failed'))
    await expect(service.analyzeVideos([video, video], '研究')).rejects.toThrow('upload failed')
    expect(api.generate).not.toHaveBeenCalled()
    expect(api.delete).toHaveBeenCalledWith({ name: 'files/one' })
  })

  it.each(['MAX_TOKENS', 'SAFETY', undefined])('拒绝未完整输出：%s', async (finishReason) => {
    api.generate.mockImplementation(async function* () {
      yield { text: '部分结果', candidates: [{ finishReason }] }
    })
    await expect(service.analyzeVideos([video], '分析')).rejects.toThrow()
    expect(api.delete).toHaveBeenCalledOnce()
  })

  it('取消时不上传文件', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(service.analyzeVideos([video], '分析', { signal: controller.signal })).rejects.toThrow('Cancelled')
    expect(api.upload).not.toHaveBeenCalled()
  })

  it('模型拒绝请求时传播错误并清理文件，不尝试另一个模型', async () => {
    api.generate.mockRejectedValue(new Error('unsupported model'))
    await expect(service.analyzeVideos([video], '分析')).rejects.toThrow('unsupported model')
    expect(api.generate).toHaveBeenCalledOnce()
    expect(api.delete).toHaveBeenCalledOnce()
  })

  it('研究携带全部视频；分镜 schema 透传', async () => {
    await service.analyzeVideos([video, video], '研究', {}, { type: 'array' })
    const request = api.generate.mock.calls[0][0]
    expect(request.contents[0].parts.filter((p: { fileData?: unknown }) => p.fileData)).toHaveLength(2)
    expect(request.config.responseJsonSchema).toEqual({ type: 'array' })
    expect(api.delete).toHaveBeenCalledTimes(2)
  })
})
