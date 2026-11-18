import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrap } from '../apps/bcc-cli/src/context.js'
import { createDefaultConfig } from '@core/services/config.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-no-config-'))
  vi.stubEnv('BCC_DATA_DIR', dir)
})
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }) })

describe('skill 无配置初始化', () => {
  it('不创建配置文件或项目目录，保留环境代理', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:12345')
    const context = await bootstrap({ noConfig: true })
    expect(context.dataRoot).toBeUndefined()
    expect(await fs.readdir(dir)).toEqual([])
    expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:12345')
  })

  it('即使已有配置也不读取，不能继承本地密钥、模型或切镜参数', async () => {
    await fs.writeFile(path.join(dir, 'config.yaml'), 'gemini:\n  api_key: local-secret\n  model: local-model\nstoryboard:\n  max_shots: 1\n')
    const read = vi.spyOn(fs, 'readFile')
    const { config } = await bootstrap({ noConfig: true })
    expect(read).not.toHaveBeenCalled()
    expect(config.gemini.api_key).toBe('')
    expect(config.gemini.model).not.toBe('local-model')
    expect(config.storyboard.max_shots).toBe(createDefaultConfig().storyboard.max_shots)
    expect(await fs.readdir(dir)).toEqual(['config.yaml'])
  })

  it('内存默认配置每次独立，密钥和参数不会污染下一次调用', async () => {
    const first = await bootstrap({ noConfig: true })
    first.config.gemini.api_key = 'temporary-secret'
    first.config.storyboard.max_shots = 1
    expect((await bootstrap({ noConfig: true })).config).toEqual(createDefaultConfig())
  })
})
