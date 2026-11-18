/** Skill 的 Gemini 视频入口；产出原始 md/json，沿用现有 export 契约。 */
import type { AppConfig, StoryboardShot } from '@shared/types'
import {
  STORYBOARD_DESCRIPTION_LABELS, STORYBOARD_SHOT_TYPES, formatStoryboardDescription,
} from '@shared/defaults'
import { GeminiService, type GenerationCallbacks } from '../services/gemini.js'
import { getVideoInfo, formatHMS } from '../services/video.js'
import { detectAndCaptureShots } from '../services/storyboard-manager.js'
import { getStoryboardMasterAddendum } from '../services/masters.js'
import { runScript } from './script.js'

export type VideoAnalysisTask = 'script' | 'storyboard' | 'research'

const shotProperties = {
  number: { type: 'integer' },
  shotType: { type: 'string', enum: [...STORYBOARD_SHOT_TYPES] },
  angle: { type: 'string' }, cameraMove: { type: 'string' },
  description: {
    type: 'object',
    properties: Object.fromEntries(STORYBOARD_DESCRIPTION_LABELS.map((key) => [key, { type: 'string' }])),
    required: [...STORYBOARD_DESCRIPTION_LABELS],
  },
  dialogue: { type: 'string' }, sound: { type: 'string' },
}

const storyboardSchema = {
  type: 'array', items: { type: 'object', properties: shotProperties, required: Object.keys(shotProperties) },
}

export interface ShotBoundary { startSec: number; endSec: number; sceneScore: number }

/** 模型不能修改时间轴；逐镜数量、编号和字段验证后才允许导出。 */
export function parseVideoStoryboard(text: string, boundaries: ShotBoundary[]): StoryboardShot[] {
  const raw: unknown = JSON.parse(text)
  if (!Array.isArray(raw) || raw.length !== boundaries.length || !raw.length) {
    throw new Error('Gemini 分镜数量与镜头时间轴不一致，未保存不完整结果')
  }
  return raw.map((shot, index) => {
    if (!shot || typeof shot !== 'object' || shot.number !== index + 1 ||
        !STORYBOARD_SHOT_TYPES.includes(shot.shotType) ||
        !['angle', 'cameraMove', 'dialogue', 'sound'].every((key) => typeof shot[key] === 'string') ||
        !shot.description || typeof shot.description !== 'object' ||
        !STORYBOARD_DESCRIPTION_LABELS.every((key) => typeof shot.description[key] === 'string') ||
        shot.description.景别 !== shot.shotType) {
      throw new Error(`Gemini 第 ${index + 1} 镜字段不完整或不符合契约`)
    }
    const boundary = boundaries[index]
    return {
      number: index + 1, shotType: shot.shotType, angle: shot.angle, cameraMove: shot.cameraMove,
      description: formatStoryboardDescription(shot.description, shot.shotType),
      dialogue: shot.dialogue, sound: shot.sound, ...boundary,
      timeRange: `${formatHMS(boundary.startSec)}-${formatHMS(boundary.endSec)}`,
    }
  })
}

export async function runVideoAnalysis(opts: {
  task: VideoAnalysisTask
  videoPaths: string[]
  config: AppConfig
  model?: string
  masterId?: string
  callbacks?: GenerationCallbacks
}): Promise<string> {
  const { task, videoPaths, masterId, callbacks = {} } = opts
  if (!videoPaths.length || (task !== 'research' && videoPaths.length !== 1)) {
    throw new Error('剧本/分镜需要一个视频，风格研究需要至少一个视频')
  }
  const config = {
    ...opts.config, script_provider: 'gemini',
    gemini: { ...opts.config.gemini, model: (opts.model ?? opts.config.gemini.model).trim() },
  }
  if (!config.gemini.model) throw new Error('请通过 --model 或 gemini.model 指定模型 ID')
  const service = new GeminiService(config.gemini)
  callbacks.onStatus?.('preparing', `provider=gemini model=${config.gemini.model} input=video`)
  if (task === 'script') {
    return (await runScript({
      videoPath: videoPaths[0], config, masterId, signal: callbacks.signal,
      generate: (file, info, cb, system) => {
        callbacks.onStatus?.('preparing', `源视频${info.audioCodec ? '含音轨' : '无音轨，无法转写声音'}`)
        return service.generateScript(file, info, cb, system)
      },
      onProgress: (ev) => callbacks.onStatus?.(ev.status, ev.message),
    })).script
  }

  const infos = await Promise.all(videoPaths.map(getVideoInfo))
  for (const [index, info] of infos.entries()) {
    if (!Number.isFinite(info.durationSec) || info.durationSec <= 0 || !info.videoCodec) {
      throw new Error(`视频${index + 1}无有效视频轨道或时长`)
    }
    callbacks.onStatus?.('preparing', `视频${index + 1}: ${formatHMS(info.durationSec)}，${info.audioCodec ? '含音轨' : '无音轨'}`)
  }
  const mediaInfo = infos.map((info, i) =>
    `视频${i + 1}：时长 ${info.durationSec} 秒，${info.audioCodec ? '含音轨，请分析实际声音' : '无音轨，必须注明，不能编造声音'}`
  ).join('\n')
  const evidenceRule = `完整分析提供的视频画面和音轨。台词按听到的原文记录，听不清标注【听不清】，无法判断标注【无法确认】。不能根据静态画面猜测声音或运镜。无声音与无法确认要区分。用中文输出。\n${mediaInfo}`

  if (task === 'research') {
    const prompt = `${evidenceRule}
请综合全部视频生成风格指南 Markdown，包含“制作风格”“剧本风格”“镜头语言分析”“创作建议”四个一级标题。
分析光线色彩、剪辑节奏、运镜、叙事、对白、音乐音效及音画关系；每条结论引用视频编号与时间戳。
对各视频的共性和差异分别说明，给出可执行的拍摄剪辑配方。不要输出代码围栏。
${config.research.synthesis_prompt?.trim() || ''}`
    const guide = await service.analyzeVideos(videoPaths, prompt, callbacks)
    if (!['制作风格', '剧本风格', '镜头语言分析', '创作建议'].every((heading) =>
      new RegExp(`^# ${heading}\\s*$`, 'm').test(guide))) {
      throw new Error('Gemini 风格指南缺少必要章节，未保存不完整结果')
    }
    return guide
  }

  const sb = config.storyboard
  const captured = await detectAndCaptureShots({
    videoPath: videoPaths[0],
    cutParams: {
      method: sb.cut_method, scene_threshold: sb.scene_threshold,
      smart_hard_min: sb.smart_hard_min, smart_hard_ratio: sb.smart_hard_ratio,
      smart_min_gap: sb.smart_min_gap,
    },
    maxShots: sb.max_shots, signal: callbacks.signal,
    onProgress: (ev) => callbacks.onStatus?.('preparing', ev.message),
  })
  const boundaries = captured.detected.map((shot, i) => ({
    startSec: shot.timestamp,
    endSec: captured.detected[i + 1]?.timestamp ?? infos[0].durationSec,
    sceneScore: shot.score,
  }))
  if (!boundaries.length || boundaries[0].startSec !== 0 || boundaries.some((b) =>
    !Number.isFinite(b.startSec) || !Number.isFinite(b.endSec) || b.startSec < 0 || b.endSec <= b.startSec)) {
    throw new Error('未获得有效镜头时间轴')
  }
  const prompt = `${evidenceRule}
分析下列每个时间区间，严格按镜号返回 JSON 数组，每镜一条，不合并、不遗漏。
number 为镜号；shotType 为景别；angle 为角度；cameraMove 根据视频运动填写；dialogue 为区间内实际对白；sound 为实际音乐/音效/环境声，无声时为空。
description 必须包含 ${STORYBOARD_DESCRIPTION_LABELS.join('、')} 七项，景别必须与 shotType 一致。
${sb.prompt?.trim() || ''}
${getStoryboardMasterAddendum(masterId ?? config.storyboard_master)}
时间轴（秒）：${JSON.stringify(boundaries.map((b, i) => ({ number: i + 1, startSec: b.startSec, endSec: b.endSec })))}`
  const text = await service.analyzeVideos(videoPaths, prompt, callbacks, storyboardSchema)
  return JSON.stringify({ shots: parseVideoStoryboard(text, boundaries), durationSec: infos[0].durationSec }, null, 2)
}
