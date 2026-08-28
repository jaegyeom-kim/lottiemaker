// AI 모션 — 자연어 요청을 키프레임 플랜으로 (Lottie Creator 2.0 Motion Copilot 벤치).
// BYOK: 사용자의 Anthropic API 키로 브라우저에서 직접 호출한다. 키는 이 브라우저
// localStorage에만 저장되고 api.anthropic.com 외에는 어디에도 전송되지 않는다.
// 프로젝트 파일(.lmproj)·자동 저장·내보낸 Lottie JSON에는 절대 포함되지 않는다.
import { normSel, normKf, type Bezier4, type KfChannel, type KfKey } from './customBuilder'
import type { LottieJson } from './lottieUtils'
import { t } from './i18n'

const KEY_STORAGE = 'lottiemaker.anthropic.key'
const PROVIDER_STORAGE = 'lottiemaker.ai.provider'
const LOCAL_URL_STORAGE = 'lottiemaker.ai.localUrl'
const LOCAL_MODEL_STORAGE = 'lottiemaker.ai.localModel'
export const DEFAULT_LOCAL_URL = 'http://localhost:11434'

export type AiProvider = 'anthropic' | 'glm' | 'local'

// ── GLM (Z.ai) — OpenAI 호환, 브라우저 CORS 허용 확인됨 ──
const GLM_KEY_STORAGE = 'lottiemaker.glm.key'
const GLM_MODEL_STORAGE = 'lottiemaker.glm.model'
const GLM_BASE_STORAGE = 'lottiemaker.glm.base'
export const DEFAULT_GLM_MODEL = 'glm-5.3-flash'
/** 코딩 플랜 키(opencode 등)는 coding 경로, 일반 API 키는 paas 경로 — 401이면 자동 전환. */
const GLM_BASES = ['https://api.z.ai/api/coding/paas/v4', 'https://api.z.ai/api/paas/v4']

export function getGlmKey(): string {
  try {
    return localStorage.getItem(GLM_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}
export function setGlmKey(key: string) {
  try {
    if (key) localStorage.setItem(GLM_KEY_STORAGE, key)
    else localStorage.removeItem(GLM_KEY_STORAGE)
  } catch {
    // 무시
  }
}
export function getGlmModel(): string {
  try {
    return localStorage.getItem(GLM_MODEL_STORAGE) || DEFAULT_GLM_MODEL
  } catch {
    return DEFAULT_GLM_MODEL
  }
}
export function setGlmModel(m: string) {
  try {
    localStorage.setItem(GLM_MODEL_STORAGE, m || DEFAULT_GLM_MODEL)
  } catch {
    // 무시
  }
}

export function getAiProvider(): AiProvider {
  try {
    const v = localStorage.getItem(PROVIDER_STORAGE)
    return v === 'local' || v === 'glm' ? v : 'anthropic'
  } catch {
    return 'anthropic'
  }
}
export function setAiProvider(v: AiProvider) {
  try {
    localStorage.setItem(PROVIDER_STORAGE, v)
  } catch {
    // 무시
  }
}
export function getLocalUrl(): string {
  try {
    return localStorage.getItem(LOCAL_URL_STORAGE) || DEFAULT_LOCAL_URL
  } catch {
    return DEFAULT_LOCAL_URL
  }
}
export function getLocalModel(): string {
  try {
    return localStorage.getItem(LOCAL_MODEL_STORAGE) ?? ''
  } catch {
    return ''
  }
}
export function setLocalConfig(url: string, model: string) {
  try {
    localStorage.setItem(LOCAL_URL_STORAGE, url || DEFAULT_LOCAL_URL)
    localStorage.setItem(LOCAL_MODEL_STORAGE, model)
  } catch {
    // 무시
  }
}

/** 로컬 서버 모델 목록 — Ollama /api/tags 우선, OpenAI 호환 /v1/models 폴백. */
export async function listLocalModels(url = getLocalUrl()): Promise<string[]> {
  const base = url.replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      const j = (await res.json()) as { models?: { name: string }[] }
      if (Array.isArray(j.models)) return j.models.map((m) => m.name)
    }
  } catch {
    // Ollama 아님 — OpenAI 호환 폴백
  }
  try {
    const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      const j = (await res.json()) as { data?: { id: string }[] }
      if (Array.isArray(j.data)) return j.data.map((m) => m.id)
    }
  } catch {
    // 서버 없음
  }
  return []
}
const MODEL = 'claude-sonnet-5'
const CHANNELS: KfChannel[] = ['p', 's', 'r', 'o', 'ts', 'te']

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
      const kind = layer.xtext
        ? 'text'
        : (layer.xshape as { tool?: string } | undefined)?.tool ??
          (typeof layer.xsrc === 'string' ? 'path' : layer.refId ? 'image' : 'shape')
      const hasStroke = JSON.stringify(layer.shapes ?? '').includes('"ty":"st"')
      return {
        index: i,
        name: String(layer.nm ?? `레이어 ${i + 1}`),
        kind,
        hasStroke,
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
/** 감쇠 스프링을 키프레임으로 베이크 — 도착 키에 spring 표시 시 직전 키와의 구간에 오버슛 극값 키 삽입. */
const SPRING_CHS = ['p', 's', 'r'] as const
function bakeSprings(keys: KfKey[], springs: Map<KfKey, number>): KfKey[] {
  if (!springs.size) return keys
  const out: KfKey[] = []
  keys.forEach((k, i) => {
    const z = springs.get(k)
    const prev = i > 0 ? keys[i - 1] : undefined
    if (z === undefined || !prev || k.t - prev.t < 4) {
      out.push(k)
      return
    }
    const L = k.t - prev.t
    // 반주기당 진폭비 — 감쇠 조화진동 닫힌형
    const ratio = Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z))
    const extra: KfKey[] = []
    for (const ch of SPRING_CHS) {
      const a = prev[ch]
      const b = k[ch]
      if (a === undefined || b === undefined) continue
      const d =
        ch === 'p'
          ? [(b as [number, number])[0] - (a as [number, number])[0], (b as [number, number])[1] - (a as [number, number])[1]]
          : [(b as number) - (a as number)]
      const mag = Math.hypot(...d)
      if (mag < 0.5) continue
      let n = 0
      while (n < 4 && mag * Math.pow(ratio, n + 1) > Math.max(0.02 * mag, 0.5)) n++
      if (!n) continue
      const h = (0.45 * L) / n
      // 첫 피크로 가속 진입 — 모델이 이징을 준 경우는 존중
      prev.e = { ...(prev.e ?? {}), [ch]: prev.e?.[ch] ?? ([0.33, 0, 0.35, 1] as Bezier4) }
      for (let j = 1; j <= n; j++) {
        const tt = Math.min(Math.round((prev.t + 0.55 * L + (j - 1) * h) * 10) / 10, k.t - 0.5)
        const amp = Math.pow(ratio, j) * (j % 2 ? 1 : -1)
        const kk: KfKey = { t: tt, e: { [ch]: [0.37, 0, 0.63, 1] as Bezier4 } }
        if (ch === 'p')
          kk.p = [(b as [number, number])[0] + d[0] * amp, (b as [number, number])[1] + d[1] * amp]
        else kk[ch] = (b as number) + d[0] * amp
        extra.push(kk)
      }
    }
    // 채널별 극값 키가 같은 시각이면 병합
    const merged: KfKey[] = []
    for (const kk of extra) {
      const dup = merged.find((m) => Math.abs(m.t - kk.t) < 0.5)
      if (dup) {
        for (const ch of SPRING_CHS) if (dup[ch] === undefined && kk[ch] !== undefined) (dup[ch] as unknown) = kk[ch]
        dup.e = { ...(dup.e ?? {}), ...(kk.e ?? {}) }
      } else merged.push(kk)
    }
    out.push(...merged.sort((x, y) => x.t - y.t), k)
  })
  return out
}

export function sanitizePlan(raw: unknown, layerCount: number, op: number): AiMotionPlan {
  const r = (raw ?? {}) as Record<string, unknown>
  const springs = new Map<KfKey, number>()
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
      if (fin(rk.ts)) key.ts = clamp(rk.ts, 0, 100)
      if (fin(rk.te)) key.te = clamp(rk.te, 0, 100)
      if (
        key.p === undefined && key.s === undefined && key.r === undefined &&
        key.o === undefined && key.ts === undefined && key.te === undefined
      )
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
      // spring 플래그 — true=0.5, 숫자/{"damping":n} 허용 (낮을수록 출렁)
      const sp = rk.spring
      const zRaw = sp === true ? 0.5 : fin(sp) ? (sp as number) : sp && typeof sp === 'object' && fin((sp as { damping?: unknown }).damping) ? ((sp as { damping: number }).damping) : undefined
      if (zRaw !== undefined) springs.set(dup ?? key, clamp(zRaw, 0.15, 0.85))
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
    .map(([index, v]) => ({
      index,
      keys: bakeSprings(v.keys.sort((a, b) => a.t - b.t), springs),
      ...(v.clip ? { clip: v.clip } : {}),
    }))
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
                  ts: { type: 'number', description: 'trim-path start percent 0..100 (shape layers) — animate 0->N with te for draw-on effects' },
                  te: { type: 'number', description: 'trim-path end percent 0..100 (shape layers)' },
                  e: {
                    type: 'object',
                    properties: { p: BEZ_SCHEMA, s: BEZ_SCHEMA, r: BEZ_SCHEMA, o: BEZ_SCHEMA },
                    description: 'per-channel easing toward the NEXT key; omit on the last key',
                  },
                  spring: {
                    type: ['boolean', 'number'],
                    description: 'physical overshoot-settle into THIS key for p/s/r — true (damping 0.5) or damping 0.2 (loose, wobbly) .. 0.8 (tight, one small overshoot). The engine bakes the extra keyframes. Prefer this for arrivals, pop-ins, snaps.',
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

function systemPrompt(doc: AiDocSummary, mode: 'tool' | 'json' = 'tool'): string {
  const respond =
    mode === 'tool'
      ? 'Respond ONLY by calling the apply_motion tool — no prose.'
      : `Respond with ONLY one JSON object, no prose, no markdown fences. Shape:
{"layers":[{"index":<int>,"clip":[inFrame,outFrame] (optional),"keys":[{"t":<frames>,"p":[x,y],"s":<scale%>,"r":<deg>,"o":<opacity%>,"ts":<trim start%>,"te":<trim end%>,"spring":true|<damping 0.2..0.8>,"e":{"p":[x1,y1,x2,y2],"s":[...],"r":[...],"o":[...]}}]}],"note":"한국어 한 문장"}
Every key needs t plus at least one of p/s/r/o/ts/te. All fields except t are optional.`
  return `You are the motion assistant inside LottieMaker, a web tool for building Lottie animations.
The user describes motion in Korean or English. ${respond}

Composition: ${doc.w}x${doc.h} px canvas (origin top-left), ${doc.fr} fps, ${doc.op} frames long (${Math.round((doc.op / doc.fr) * 100) / 100}s). Playhead at frame ${doc.playhead}.

Keyframe semantics:
- t is in frames, within [0, ${doc.op}].
- p = layer CENTER position in canvas px. s = uniform scale % (100 natural). r = rotation degrees. o = opacity % (0..100).
- A channel with a single key is static at that value. Channels you omit keep their current settled value.
- keys REPLACE the layer's existing keyframes entirely — if the layer already has keys you want to keep, include them again.
- e on a key eases the segment from that key to the NEXT key of the same channel. x1,x2 in [0,1]; y1,y2 may leave [0,1] (max -2..3) for anticipation/overshoot.

Craft guidelines:
- Prefer expressive easing over linear: ease-out [0.22,1,0.36,1], ease-in-out [0.65,0,0.35,1], anticipation dip or >100% overshoot via extra keys.
- Natural arrivals: put "spring": true on the destination key (p/s/r) — the engine bakes a physical overshoot-settle into that segment. Damping number tunes it: 0.3 wobbly, 0.5 default, 0.8 subtle. USE THIS instead of hand-crafting overshoot keys. Example pop-in: {"t":0,"s":0},{"t":18,"s":100,"spring":0.4}.
- Bounce off a floor (falling ball) = several keys with decreasing amplitude, ease-out falling / ease-in rising — spring won't do ground contact.
- Give the settle room: a sprung segment reads best over 15+ frames.
- When the request implies sequence over multiple layers, stagger their key times (e.g. 4-8 frame offsets).
- Off-canvas start/end positions are fine for entries/exits; settled poses should sit inside the canvas.
- ts/te animate the trim path (draw-on): typical draw effect = te 0->100 (ts 0 static). Shape/path layers only — never on image layers. Great for strokes (hasStroke: true) and pen paths (kind: path).
- kind tells you what each layer is (rect/ellipse/star/text/path/image) — match layers to the request by kind and name.
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

/** 로컬 LLM(Ollama) — /api/chat + format:json, 파싱/검증 실패 시 1회 재시도. */
export async function generateMotionLocal(opts: {
  url: string
  model: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
}): Promise<AiMotionPlan> {
  const { url, model, prompt, doc, signal, onProgress } = opts
  const base = url.replace(/\/$/, '')
  const ask = async (extra: string): Promise<AiMotionPlan> => {
    onProgress?.(t('로컬 모델에 연결 중'))
    let res: Response
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: true,
          format: 'json',
          options: { temperature: 0.4, num_ctx: 8192 },
          messages: [
            { role: 'system', content: systemPrompt(doc, 'json') },
            {
              role: 'user',
              content: `<composition>\n${JSON.stringify(doc)}\n</composition>\n\n요청: ${prompt}${extra}`,
            },
          ],
        }),
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      throw new Error(
        t('로컬 LLM 연결 실패 — Ollama가 실행 중인지, 브라우저 접근이 막혔다면 OLLAMA_ORIGINS="*" 로 실행했는지 확인하세요'),
      )
    }
    if (!res.ok) {
      let detail = ''
      try {
        detail = ((await res.json()) as { error?: string }).error ?? ''
      } catch {
        // 본문 없음
      }
      if (res.status === 404 && /model/i.test(detail))
        throw new Error(t('모델 "{m}"이 없습니다 — ollama pull 후 다시 시도하세요').replace('{m}', model))
      throw new Error(detail || t('로컬 LLM 오류 ({status})').replace('{status}', String(res.status)))
    }
    // NDJSON 스트림 — 청크마다 진행 표시 (모델 로딩 중엔 첫 청크가 늦다)
    onProgress?.(t('모델 준비 중 (첫 응답 대기)'))
    const reader = res.body?.getReader()
    let acc = ''
    if (reader) {
      const dec = new TextDecoder()
      let buf = ''
      const eat = (ln: string) => {
        if (!ln.trim()) return
        try {
          const j = JSON.parse(ln) as { message?: { content?: string } }
          acc += j.message?.content ?? ''
        } catch {
          // 부분 라인 — 무시
        }
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        lines.forEach(eat)
        if (acc.length) onProgress?.(t('키프레임 작성 중 — {n}자').replace('{n}', String(acc.length)))
      }
      eat(buf) // 트레일링 개행 없는 마지막 라인
    } else {
      const data = (await res.json()) as { message?: { content?: string } }
      acc = data.message?.content ?? ''
    }
    onProgress?.(t('모션 검증 중'))
    const parsed = JSON.parse(acc) as unknown // 실패 시 catch에서 재시도
    return sanitizePlan(parsed, doc.layers.length, doc.op)
  }
  try {
    return await ask('')
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    // 스키마 위반/파싱 실패 — 1회 재시도 (지시 강화)
    onProgress?.(t('형식이 어긋나 다시 요청 중'))
    return ask('\n\n(이전 응답이 JSON 스키마에 맞지 않았습니다. 지시된 JSON 오브젝트 하나만 출력하세요.)')
  }
}

/** GLM(Z.ai) — OpenAI 호환 SSE + JSON 모드, 엔드포인트 자동 전환(코딩 플랜/일반), 1회 재시도. */
export async function generateMotionGlm(opts: {
  apiKey: string
  model: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
}): Promise<AiMotionPlan> {
  const { apiKey, model, prompt, doc, signal, onProgress } = opts
  // OpenRouter 키(sk-or-…)는 엔드포인트/모델 슬러그 자동 전환
  const orKey = apiKey.startsWith('sk-or-')
  let bases: string[]
  if (orKey) {
    bases = ['https://openrouter.ai/api/v1']
  } else {
    try {
      const saved = localStorage.getItem(GLM_BASE_STORAGE)
      bases = saved ? [saved, ...GLM_BASES.filter((b) => b !== saved)] : [...GLM_BASES]
    } catch {
      bases = [...GLM_BASES]
    }
  }
  const mdl = orKey && !model.includes('/') ? `z-ai/${model}` : model
  const askAt = async (base: string, extra: string): Promise<AiMotionPlan> => {
    onProgress?.(t('GLM에 연결 중'))
    let res: Response
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: mdl,
          stream: true,
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt(doc, 'json') },
            {
              role: 'user',
              content: `<composition>\n${JSON.stringify(doc)}\n</composition>\n\n요청: ${prompt}${extra}`,
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
        const j = (await res.json()) as { error?: { message?: string }; msg?: string }
        detail = j.error?.message ?? j.msg ?? ''
      } catch {
        // 본문 없음
      }
      const err = new Error(
        res.status === 401 || res.status === 403
          ? t('GLM 키 인증 실패 — 키와 플랜(코딩/일반)을 확인하세요') + (detail ? ` (${detail})` : '')
          : detail || t('API 오류 ({status})').replace('{status}', String(res.status)),
      ) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    if (!orKey) {
      try {
        localStorage.setItem(GLM_BASE_STORAGE, base) // 성공 엔드포인트 기억
      } catch {
        // 무시
      }
    }
    // OpenAI 형식 SSE — choices[0].delta.content 누적
    const reader = res.body?.getReader()
    let acc = ''
    if (reader) {
      const dec = new TextDecoder()
      let buf = ''
      const eat = (ln: string) => {
        const m = ln.startsWith('data:') ? ln.slice(5).trim() : ''
        if (!m || m === '[DONE]') return
        try {
          const j = JSON.parse(m) as { choices?: { delta?: { content?: string } }[] }
          acc += j.choices?.[0]?.delta?.content ?? ''
        } catch {
          // 부분 라인 — 무시
        }
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        lines.forEach(eat)
        if (acc.length) onProgress?.(t('키프레임 작성 중 — {n}자').replace('{n}', String(acc.length)))
      }
      eat(buf)
    }
    onProgress?.(t('모션 검증 중'))
    // 모델이 마크다운 펜스로 감싸는 경우 방어
    const clean = acc.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    const parsed = JSON.parse(clean) as unknown
    return sanitizePlan(parsed, doc.layers.length, doc.op)
  }
  const ask = async (extra: string): Promise<AiMotionPlan> => {
    try {
      return await askAt(bases[0], extra)
    } catch (e) {
      const st = (e as Error & { status?: number }).status
      // 코딩 플랜 ↔ 일반 API 경로 자동 전환
      if ((st === 401 || st === 403 || st === 404) && bases[1]) return askAt(bases[1], extra)
      throw e
    }
  }
  try {
    return await ask('')
  } catch (e) {
    if ((e as Error).name === 'AbortError' || (e as Error & { status?: number }).status) throw e
    onProgress?.(t('형식이 어긋나 다시 요청 중'))
    return ask('\n\n(이전 응답이 JSON 스키마에 맞지 않았습니다. 지시된 JSON 오브젝트 하나만 출력하세요.)')
  }
}

export async function generateMotion(opts: {
  apiKey: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
}): Promise<AiMotionPlan> {
  const { apiKey, prompt, doc, signal, onProgress } = opts
  onProgress?.(t('Claude에 연결 중'))
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
        stream: true,
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
  // SSE 스트림 — thinking/툴 JSON 진행을 단계 문구로
  const reader = res.body?.getReader()
  let inputJson = ''
  let stopReason = ''
  let sawTool = false
  if (reader) {
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const ln of lines) {
        if (!ln.startsWith('data:')) continue
        let ev: Record<string, unknown>
        try {
          ev = JSON.parse(ln.slice(5)) as Record<string, unknown>
        } catch {
          continue
        }
        const type = String(ev.type ?? '')
        if (type === 'content_block_start') {
          const cb = ev.content_block as { type?: string; name?: string } | undefined
          if (cb?.type === 'tool_use' && cb.name === 'apply_motion') {
            sawTool = true
            onProgress?.(t('키프레임 작성 중'))
          }
        } else if (type === 'content_block_delta') {
          const dlt = ev.delta as { type?: string; partial_json?: string } | undefined
          if (dlt?.type === 'thinking_delta') onProgress?.(t('모션 구상 중'))
          else if (dlt?.type === 'input_json_delta' && sawTool) {
            inputJson += dlt.partial_json ?? ''
            onProgress?.(t('키프레임 작성 중 — {n}자').replace('{n}', String(inputJson.length)))
          }
        } else if (type === 'message_delta') {
          const d2 = ev.delta as { stop_reason?: string } | undefined
          if (d2?.stop_reason) stopReason = d2.stop_reason
        } else if (type === 'error') {
          const er = ev.error as { message?: string } | undefined
          throw new Error(er?.message || t('API 오류 ({status})').replace('{status}', 'stream'))
        }
      }
    }
  }
  if (!sawTool || !inputJson) {
    // refusal은 같은 프롬프트 재시도가 무의미 — 재시도 안내 대신 표현 변경 안내
    if (stopReason === 'refusal')
      throw new Error(t('요청이 거부되었습니다 — 다른 표현으로 다시 써보세요'))
    if (stopReason === 'max_tokens')
      throw new Error(t('응답이 너무 길어 잘렸습니다 — 요청을 더 작게 나눠보세요'))
    throw new Error(t('AI가 모션을 반환하지 않았습니다 — 다시 시도해보세요'))
  }
  onProgress?.(t('모션 검증 중'))
  let parsed: unknown
  try {
    parsed = JSON.parse(inputJson)
  } catch {
    throw new Error(t('AI가 모션을 반환하지 않았습니다 — 다시 시도해보세요'))
  }
  return sanitizePlan(parsed, doc.layers.length, doc.op)
}
