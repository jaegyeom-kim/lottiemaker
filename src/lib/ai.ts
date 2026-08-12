// AI 모션 — 자연어 요청을 키프레임 플랜으로 (Lottie Creator 2.0 Motion Copilot 벤치).
// BYOK: 사용자의 Anthropic API 키로 브라우저에서 직접 호출한다. 키는 이 브라우저
// localStorage에만 저장되고 api.anthropic.com 외에는 어디에도 전송되지 않는다.
// 프로젝트 파일(.lmproj)·자동 저장·내보낸 Lottie JSON에는 절대 포함되지 않는다.
import { normSel, normKf, type Bezier4, type KfChannel, type KfKey } from './customBuilder'
import type { LottieJson } from './lottieUtils'
import { t } from './i18n'

const KEY_STORAGE = 'lottiemaker.anthropic.key'
const MODEL = 'claude-sonnet-5'
const CHANNELS: KfChannel[] = ['p', 's', 'r', 'o']

export function getAiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setAiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    // localStorage 접근 불가 — 이번 세션 메모리로만 동작
  }
}

/**
 * 저장 시점 키 검증 — GET /v1/models (무과금)로 인증 + 모델 접근을 즉시 확인.
 * 프롬프트를 쓰고 나서야 401을 발견하는 상황을 막는다.
 */
export async function verifyAiKey(key: string): Promise<{ ok: boolean; msg?: string }> {
  // 형식 사전 체크 — 콘솔 API 키는 sk-ant-api…, 앱 OAuth 토큰은 sk-ant-oat…
  if (key.startsWith('sk-ant-oat'))
    return {
      ok: false,
      msg: t('클로드 앱 로그인 토큰입니다 — console.anthropic.com › API Keys에서 발급한 API 키(sk-ant-api…)가 필요합니다'),
    }
  if (!key.startsWith('sk-ant-'))
    return { ok: false, msg: t('키 형식이 아닙니다 — sk-ant-로 시작하는 API 키를 넣어주세요') }
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      signal: AbortSignal.timeout(8000), // 행 걸리면 저장 버튼이 영원히 '확인 중' — 8s 컷
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    if (res.status === 401)
      return {
        ok: false,
        msg: t('API 키가 유효하지 않습니다 — console.anthropic.com › API Keys에서 발급한 키인지(클로드 앱 구독과 별개), 전체가 빠짐없이 복사됐는지 확인하세요'),
      }
    if (!res.ok) return { ok: true } // 기타 오류는 저장은 허용 — 실행 시 상세 에러로 안내
    const j = (await res.json()) as { data?: { id: string }[]; has_more?: boolean }
    // 첫 페이지에 없어도 다음 페이지가 있으면 통과 — 유효 키 오탐 방지
    if (Array.isArray(j.data) && !j.data.some((m) => m.id.startsWith(MODEL)) && j.has_more !== true)
      return { ok: false, msg: t('이 키로는 {model} 모델을 사용할 수 없습니다 — 워크스페이스 모델 설정을 확인하세요').replace('{model}', MODEL) }
    return { ok: true }
  } catch {
    return { ok: true } // 오프라인 등 — 저장은 허용
  }
}

/** AI가 반환하는 레이어별 모션 — keys는 해당 레이어의 기존 키를 통째로 대체. */
export interface AiLayerPlan {
  index: number
  keys: KfKey[]
  clip?: [number, number]
}

export interface AiMotionPlan {
  layers: AiLayerPlan[]
  note?: string
}

/** 모델에 보내는 문서 요약 — 좌표계·현재 상태를 컴팩트하게. */
export interface AiDocSummary {
  w: number
  h: number
  fr: number
  op: number
  playhead: number
  layers: {
    index: number
    name: string
    selected: boolean
    center: [number, number]
    sizeLongPx: number
    rotation: number
    opacity: number
    clip: [number, number]
    mode: 'keyframes' | 'preset'
    keys?: KfKey[]
  }[]
}

export function summarizeDoc(src: LottieJson, selectedIdxs: number[], playhead: number): AiDocSummary {
  const sel = new Set(selectedIdxs)
  return {
    w: src.w,
    h: src.h,
    fr: src.fr,
    op: src.op,
    playhead: Math.round(playhead),
    layers: src.layers.map((l, i) => {
      const layer = l as Record<string, unknown>
      const xsel = normSel(layer.xsel as Record<string, unknown> | undefined, src.op)
      const xkf = normKf(layer.xkf as Record<string, unknown> | undefined)
      const base: [number, number] = Array.isArray(layer.xbase)
        ? [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
        : [256, 256]
      return {
        index: i,
        name: String(layer.nm ?? `레이어 ${i + 1}`),
        selected: sel.has(i),
        center: [Math.round(base[0]), Math.round(base[1])],
        sizeLongPx: Math.round(xsel.size),
        rotation: xsel.rotation,
        opacity: xsel.opacity,
        clip: [xsel.clip[0], xsel.clip[1]],
        mode: xkf.on ? 'keyframes' : 'preset',
        ...(xkf.on && xkf.keys.length ? { keys: xkf.keys } : {}),
      }
    }),
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 모델 출력 검증·클램프 — 유효 레이어가 하나도 없으면 throw. */
export function sanitizePlan(raw: unknown, layerCount: number, op: number): AiMotionPlan {
  const r = (raw ?? {}) as Record<string, unknown>
  const byIndex = new Map<number, { keys: KfKey[]; clip?: [number, number] }>()
  const rawLayers = Array.isArray(r.layers) ? (r.layers as Record<string, unknown>[]) : []
  for (const rl of rawLayers) {
    if (!rl || typeof rl !== 'object') continue
    const index = Math.round(Number(rl.index))
    if (!Number.isFinite(index) || index < 0 || index >= layerCount) continue
    const entry = byIndex.get(index) ?? { keys: [] }
    for (const rk of Array.isArray(rl.keys) ? (rl.keys as Record<string, unknown>[]) : []) {
      if (!rk || !fin(rk.t)) continue
      const key: KfKey = { t: Math.round(clamp(rk.t, 0, op) * 10) / 10 }
      const p = rk.p
      if (Array.isArray(p) && fin(p[0]) && fin(p[1]))
        key.p = [clamp(p[0], -4096, 4096), clamp(p[1], -4096, 4096)]
      if (fin(rk.s)) key.s = clamp(rk.s, 0, 1000)
      if (fin(rk.r)) key.r = clamp(rk.r, -3600, 3600)
      if (fin(rk.o)) key.o = clamp(rk.o, 0, 100)
      if (key.p === undefined && key.s === undefined && key.r === undefined && key.o === undefined)
        continue
      if (rk.e && typeof rk.e === 'object') {
        const e: Partial<Record<KfChannel, Bezier4>> = {}
        for (const ch of CHANNELS) {
          const b = (rk.e as Record<string, unknown>)[ch]
          if (Array.isArray(b) && b.length === 4 && b.every(fin))
            e[ch] = [
              clamp(b[0] as number, 0, 1),
              clamp(b[1] as number, -2, 3),
              clamp(b[2] as number, 0, 1),
              clamp(b[3] as number, -2, 3),
            ]
        }
        if (Object.keys(e).length) key.e = e
      }
      // 같은 시각(±0.5f) 키는 채널 병합 — 먼저 온 값 우선
      const dup = entry.keys.find((k) => Math.abs(k.t - key.t) < 0.5)
      if (dup) {
        for (const ch of CHANNELS) if (dup[ch] === undefined && key[ch] !== undefined) (dup[ch] as unknown) = key[ch]
        if (key.e) dup.e = { ...key.e, ...(dup.e ?? {}) }
      } else if (entry.keys.length < 60) {
        entry.keys.push(key)
      }
    }
    const c = rl.clip
    if (Array.isArray(c) && fin(c[0]) && fin(c[1])) {
      const a = clamp(Math.round(c[0]), 0, op)
      const b = clamp(Math.round(c[1]), 0, op)
      entry.clip = a <= b ? [a, b] : [b, a]
    }
    byIndex.set(index, entry)
  }
  const layers: AiLayerPlan[] = [...byIndex.entries()]
    .filter(([, v]) => v.keys.length > 0)
    .map(([index, v]) => ({ index, keys: v.keys.sort((a, b) => a.t - b.t), ...(v.clip ? { clip: v.clip } : {}) }))
    .sort((a, b) => a.index - b.index)
  if (!layers.length) throw new Error(t('AI가 적용 가능한 모션을 만들지 못했습니다 — 요청을 더 구체적으로 써보세요'))
  const note = typeof r.note === 'string' ? r.note.slice(0, 200) : undefined
  return { layers, ...(note ? { note } : {}) }
}

const BEZ_SCHEMA = {
  type: 'array',
  items: { type: 'number' },
  minItems: 4,
  maxItems: 4,
  description: 'cubic-bezier [x1,y1,x2,y2] easing of the segment from this key to the next key',
}

const MOTION_TOOL = {
  name: 'apply_motion',
  description: 'Apply keyframe motion to layers of the composition. The keys array fully replaces the existing keyframes of that layer.',
  input_schema: {
    type: 'object',
    required: ['layers'],
    properties: {
      layers: {
        type: 'array',
        items: {
          type: 'object',
          required: ['index', 'keys'],
          properties: {
            index: { type: 'integer', description: 'layer index from the composition state' },
            clip: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
              description: 'optional visibility span [inFrame, outFrame]',
            },
            keys: {
              type: 'array',
              items: {
                type: 'object',
                required: ['t'],
                properties: {
                  t: { type: 'number', description: 'time in frames' },
                  p: {
                    type: 'array',
                    items: { type: 'number' },
                    minItems: 2,
                    maxItems: 2,
                    description: 'layer center position in canvas px [x,y]',
                  },
                  s: { type: 'number', description: 'uniform scale percent, 100 = natural' },
                  r: { type: 'number', description: 'rotation degrees, clockwise' },
                  o: { type: 'number', description: 'opacity percent 0..100' },
                  e: {
                    type: 'object',
                    properties: { p: BEZ_SCHEMA, s: BEZ_SCHEMA, r: BEZ_SCHEMA, o: BEZ_SCHEMA },
                    description: 'per-channel easing toward the NEXT key; omit on the last key',
                  },
                },
              },
            },
          },
        },
      },
      note: { type: 'string', description: 'one short Korean sentence describing the motion you made' },
    },
  },
}

function systemPrompt(doc: AiDocSummary): string {
  return `You are the motion assistant inside LottieMaker, a web tool for building Lottie animations.
The user describes motion in Korean or English. Respond ONLY by calling the apply_motion tool — no prose.

Composition: ${doc.w}x${doc.h} px canvas (origin top-left), ${doc.fr} fps, ${doc.op} frames long (${Math.round((doc.op / doc.fr) * 100) / 100}s). Playhead at frame ${doc.playhead}.

Keyframe semantics:
- t is in frames, within [0, ${doc.op}].
- p = layer CENTER position in canvas px. s = uniform scale % (100 natural). r = rotation degrees. o = opacity % (0..100).
- A channel with a single key is static at that value. Channels you omit keep their current settled value.
- keys REPLACE the layer's existing keyframes entirely — if the layer already has keys you want to keep, include them again.
- e on a key eases the segment from that key to the NEXT key of the same channel. x1,x2 in [0,1]; y1,y2 may leave [0,1] (max -2..3) for anticipation/overshoot.

Craft guidelines:
- Prefer expressive easing over linear: ease-out [0.22,1,0.36,1], ease-in-out [0.65,0,0.35,1], anticipation dip or >100% overshoot via extra keys.
- Bounce = several keys with decreasing amplitude, ease-out falling / ease-in rising, not one curve.
- When the request implies sequence over multiple layers, stagger their key times (e.g. 4-8 frame offsets).
- Off-canvas start/end positions are fine for entries/exits; settled poses should sit inside the canvas.
- If specific layers are selected (selected: true), animate those; otherwise animate the layers that best match the request (all if it is global).
- Keep motion within the composition length. End settled unless a loop is asked; for loops make the last key equal the first key of that channel.
- note: one short Korean sentence.`
}

/** 상태별 한국어 에러 매핑 — UI에 그대로 표출. */
function apiError(status: number, detail: string): Error {
  if (status === 401)
    return new Error(
      t('API 키가 유효하지 않습니다 — console.anthropic.com › API Keys에서 발급한 키인지(클로드 앱 구독과 별개), 전체가 빠짐없이 복사됐는지 확인하세요'),
    )
  if (status === 403)
    return new Error(`${t('권한이 없는 키입니다 — 워크스페이스/모델 접근 설정을 확인하세요')}${detail ? ` (${detail})` : ''}`)
  if (status === 400 && /credit/i.test(detail))
    return new Error(t('크레딧이 부족합니다 — console.anthropic.com에서 충전 후 다시 시도하세요'))
  if (status === 404 && /model/i.test(detail))
    return new Error(t('모델을 사용할 수 없는 키입니다 ({detail})').replace('{detail}', detail))
  if (status === 429) return new Error(t('요청 한도 초과 — 잠시 후 다시 시도하세요'))
  if (status >= 500) return new Error(t('Anthropic API 일시 오류 — 잠시 후 다시 시도하세요'))
  return new Error(detail || t('API 오류 ({status})').replace('{status}', String(status)))
}

export async function generateMotion(opts: {
  apiKey: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
}): Promise<AiMotionPlan> {
  const { apiKey, prompt, doc, signal } = opts
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // 정적 사이트 BYOK — 사용자의 자기 키를 자기 브라우저에서 쓰는 구조
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        // claude-sonnet-5는 thinking 생략 시 adaptive thinking이 기본 —
        // max_tokens가 (thinking + 툴 JSON) 합산 상한이라 여유 있게 잡고 effort는 낮춘다
        max_tokens: 16000,
        output_config: { effort: 'low' },
        system: systemPrompt(doc),
        tools: [MOTION_TOOL],
        tool_choice: { type: 'tool', name: 'apply_motion' },
        messages: [
          {
            role: 'user',
            content: `<composition>\n${JSON.stringify(doc)}\n</composition>\n\n요청: ${prompt}`,
          },
        ],
      }),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error(t('네트워크 오류 — 인터넷 연결을 확인하세요'))
  }
  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      detail = j.error?.message ?? ''
    } catch {
      // 본문 없는 에러 — 상태 코드 매핑만 사용
    }
    throw apiError(res.status, detail)
  }
  const data = (await res.json()) as {
    stop_reason?: string
    content?: { type: string; name?: string; input?: unknown }[]
  }
  const tool = data.content?.find((b) => b.type === 'tool_use' && b.name === 'apply_motion')
  if (!tool) {
    // refusal은 같은 프롬프트 재시도가 무의미 — 재시도 안내 대신 표현 변경 안내
    if (data.stop_reason === 'refusal')
      throw new Error(t('요청이 거부되었습니다 — 다른 표현으로 다시 써보세요'))
    if (data.stop_reason === 'max_tokens')
      throw new Error(t('응답이 너무 길어 잘렸습니다 — 요청을 더 작게 나눠보세요'))
    throw new Error(t('AI가 모션을 반환하지 않았습니다 — 다시 시도해보세요'))
  }
  return sanitizePlan(tool.input, doc.layers.length, doc.op)
}
