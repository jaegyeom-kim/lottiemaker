// AI 모션 — 자연어 요청을 키프레임 플랜으로 (Lottie Creator 2.0 Motion Copilot 벤치).
// BYOK: 사용자의 Anthropic API 키로 브라우저에서 직접 호출한다. 키는 이 브라우저
// localStorage에만 저장되고 api.anthropic.com 외에는 어디에도 전송되지 않는다.
// 프로젝트 파일(.lmproj)·자동 저장·내보낸 Lottie JSON에는 절대 포함되지 않는다.
import {
  normSel, normKf, bakeSprings, layerHalfOf, layerBaseOf,
  IN_TYPES, LOOP_TYPES, OUT_TYPES,
  type Bezier4, type KfChannel, type KfKey,
} from './customBuilder'
import type { LottieJson } from './lottieUtils'
import { t } from './i18n'

const KEY_STORAGE = 'lottiemaker.anthropic.key'
const PROVIDER_STORAGE = 'lottiemaker.ai.provider'
const LOCAL_URL_STORAGE = 'lottiemaker.ai.localUrl'
const LOCAL_MODEL_STORAGE = 'lottiemaker.ai.localModel'
const LOCAL_CTX_STORAGE = 'lottiemaker.ai.localCtx'
/** 컨텍스트 창 토큰 — 무조건 올리면 사용자 머신 KV 캐시가 같이 커져 작은 모델이 OOM 난다. */
export const DEFAULT_LOCAL_CTX = 8192
export const DEFAULT_LOCAL_URL = 'http://localhost:11434'

export type AiProvider = 'anthropic' | 'glm' | 'deepseek' | 'gemini' | 'ling' | 'local'

// ── GLM (Z.ai) — OpenAI 호환, 브라우저 CORS 허용 확인됨 ──
const GLM_KEY_STORAGE = 'lottiemaker.glm.key'
const GLM_MODEL_STORAGE = 'lottiemaker.glm.model'
const GLM_BASE_STORAGE = 'lottiemaker.glm.base'
export const DEFAULT_GLM_MODEL = 'glm-5.3-flash'
/** 코딩 플랜 키(opencode 등)는 coding 경로, 일반 API 키는 paas 경로 — 401이면 자동 전환. */
const GLM_BASES = ['https://api.z.ai/api/coding/paas/v4', 'https://api.z.ai/api/paas/v4']
/** sk-or-… 키는 어느 프로바이더를 골랐든 OpenRouter로 — 모델 슬러그만 갈아끼운다. */
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const DEEPSEEK_BASE = 'https://api.deepseek.com'
/** Ling(InclusionAI)은 자체 공개 API가 없어 ZenMux 라우터를 기본 경로로 쓴다. */
const ZENMUX_BASE = 'https://zenmux.ai/api/v1'
/** Gemini는 OpenAI 호환 경로를 따로 연다 — chat/completions 스펙 그대로. */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'

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

// ── DeepSeek — OpenAI 호환. 공식 API는 날짜 없는 별칭만 받는다
// (deepseek-v4-flash = V4-Flash-0731). 날짜 스냅샷은 OpenRouter 슬러그로. ──
const DS_KEY_STORAGE = 'lottiemaker.deepseek.key'
const DS_MODEL_STORAGE = 'lottiemaker.deepseek.model'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'

export function getDeepseekKey(): string {
  try {
    return localStorage.getItem(DS_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}
export function setDeepseekKey(key: string) {
  try {
    if (key) localStorage.setItem(DS_KEY_STORAGE, key)
    else localStorage.removeItem(DS_KEY_STORAGE)
  } catch {
    // 무시
  }
}
export function getDeepseekModel(): string {
  try {
    return localStorage.getItem(DS_MODEL_STORAGE) || DEFAULT_DEEPSEEK_MODEL
  } catch {
    return DEFAULT_DEEPSEEK_MODEL
  }
}
export function setDeepseekModel(m: string) {
  try {
    localStorage.setItem(DS_MODEL_STORAGE, m || DEFAULT_DEEPSEEK_MODEL)
  } catch {
    // 무시
  }
}

// ── Gemini (Google) — OpenAI 호환 경로. 키는 AI Studio 키 또는 OpenRouter 키. ──
const GEM_KEY_STORAGE = 'lottiemaker.gemini.key'
const GEM_MODEL_STORAGE = 'lottiemaker.gemini.model'
export const DEFAULT_GEMINI_MODEL = 'gemini-3.7-flash'

export function getGeminiKey(): string {
  try {
    return localStorage.getItem(GEM_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}
export function setGeminiKey(key: string) {
  try {
    if (key) localStorage.setItem(GEM_KEY_STORAGE, key)
    else localStorage.removeItem(GEM_KEY_STORAGE)
  } catch {
    // 무시
  }
}
export function getGeminiModel(): string {
  try {
    return localStorage.getItem(GEM_MODEL_STORAGE) || DEFAULT_GEMINI_MODEL
  } catch {
    return DEFAULT_GEMINI_MODEL
  }
}
export function setGeminiModel(m: string) {
  try {
    localStorage.setItem(GEM_MODEL_STORAGE, m || DEFAULT_GEMINI_MODEL)
  } catch {
    // 무시
  }
}

// ── Ling (InclusionAI) — OpenAI 호환. ZenMux·OpenRouter 모두 inclusionai/ 슬러그를 쓴다. ──
const LING_KEY_STORAGE = 'lottiemaker.ling.key'
const LING_MODEL_STORAGE = 'lottiemaker.ling.model'
export const DEFAULT_LING_MODEL = 'ling-3.0-flash'

export function getLingKey(): string {
  try {
    return localStorage.getItem(LING_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}
export function setLingKey(key: string) {
  try {
    if (key) localStorage.setItem(LING_KEY_STORAGE, key)
    else localStorage.removeItem(LING_KEY_STORAGE)
  } catch {
    // 무시
  }
}
export function getLingModel(): string {
  try {
    return localStorage.getItem(LING_MODEL_STORAGE) || DEFAULT_LING_MODEL
  } catch {
    return DEFAULT_LING_MODEL
  }
}
export function setLingModel(m: string) {
  try {
    localStorage.setItem(LING_MODEL_STORAGE, m || DEFAULT_LING_MODEL)
  } catch {
    // 무시
  }
}

export function getAiProvider(): AiProvider {
  try {
    const v = localStorage.getItem(PROVIDER_STORAGE)
    return v === 'local' || v === 'glm' || v === 'deepseek' || v === 'gemini' || v === 'ling'
      ? v
      : 'anthropic'
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
export function getLocalCtx(): number {
  try {
    const v = Number(localStorage.getItem(LOCAL_CTX_STORAGE))
    return Number.isFinite(v) && v >= 2048 ? v : DEFAULT_LOCAL_CTX
  } catch {
    return DEFAULT_LOCAL_CTX
  }
}
export function setLocalCtx(n: number) {
  try {
    localStorage.setItem(LOCAL_CTX_STORAGE, String(Math.max(2048, Math.round(n) || DEFAULT_LOCAL_CTX)))
  } catch {
    // 무시
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
  /** 'merge'면 기존 키를 시드로 두고 같은 시각만 덮어쓴다 (기본 'replace'). */
  mode?: 'replace' | 'merge'
  /** 위치 경로 — 'linear'면 자동 아크를 끈다 (기본은 키 수 휴리스틱). */
  path?: 'linear' | 'smooth'
  /** 회전/스케일 축 (레이어 박스 분율) — 키 적용 전에 먼저 옮긴다. */
  anchor?: [number, number]
}

export interface AiMotionPlan {
  layers: AiLayerPlan[]
  note?: string
  /** 검증에서 버리거나 고친 것 — UI가 성공 메시지에 덧붙인다. */
  issues?: string[]
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
    kind: string
    /** 텍스트 레이어의 실제 문구 — 이름이 전부 '텍스트'라 이게 없으면 구분 불가. */
    text?: string
    hasStroke: boolean
    /** ts/te(트림 패스)가 실제로 먹는 레이어인지 — shapes/gr 그룹이 없으면 무성 no-op. */
    canTrim: boolean
    selected: boolean
    locked: boolean
    /** 캔버스 절대 좌표의 중심 — 부모가 있어도 화면 기준. */
    center: [number, number]
    /** 부모가 있을 때 p 채널이 해석되는 로컬 좌표 (부모 없으면 center와 같다). */
    localPos: [number, number]
    /** 부모 레이어의 배열 인덱스 — p/s/r가 이 레이어 기준으로 합성된다. */
    parent: number | null
    /** 현재 scale·부모 스케일이 이미 반영된 화면상 렌더 크기 [w,h] px (회전 미반영). 실측이 없으면 생략. */
    renderedBox?: [number, number]
    /** s 채널 키가 없을 때 적용되는 정적 스케일 % — s:100은 이 값이 아니라 원본 100%다. */
    scale: number
    /** 회전 축 (레이어 박스 분율, [0.5,0.5]가 중심). */
    anchor: [number, number]
    rotation: number
    opacity: number
    clip: [number, number]
    mode: 'keyframes' | 'preset'
    keys?: KfKey[]
    /** 프리셋 모드일 때 현재 걸린 등장/루프/퇴장 — 키를 적용하면 전부 사라진다. */
    preset?: { in: string; loop: string; out: string }
    /** 패스 모핑/그라디언트 키가 걸려 있다 (기하는 생략 — 이 채널은 계획할 수 없다). */
    hasPathAnim?: boolean
    hasGradAnim?: boolean
  }[]
}

/** 컨텍스트에 실을 키 — pk/gk 기하 blob은 수천 토큰인데 계획에 쓸 수 없으니 뺀다. */
function stripKeys(keys: KfKey[]): KfKey[] {
  return keys.map((k) => {
    const { pk: _pk, gk: _gk, pto: _pto, pti: _pti, ...rest } = k
    void _pk
    void _gk
    void _pto
    void _pti
    return rest
  })
}

export function summarizeDoc(src: LottieJson, selectedIdxs: number[], playhead: number): AiDocSummary {
  const sel = new Set(selectedIdxs)
  // layer.parent는 lottie 관례상 대상의 ind — 모델은 배열 index로 레이어를 지목하므로 변환한다
  const indToIdx = new Map<number, number>()
  src.layers.forEach((l, i) => {
    const ind = (l as Record<string, unknown>).ind
    if (typeof ind === 'number') indToIdx.set(ind, i)
  })
  const at = Math.round(playhead)
  return {
    w: src.w,
    h: src.h,
    fr: src.fr,
    op: src.op,
    playhead: at,
    layers: src.layers.map((l, i) => {
      const layer = l as Record<string, unknown>
      const xsel = normSel(layer.xsel as Record<string, unknown> | undefined, src.op)
      const xkf = normKf(layer.xkf as Record<string, unknown> | undefined)
      const local: [number, number] = Array.isArray(layer.xbase)
        ? [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
        : [256, 256]
      const world = layerBaseOf(src, i, at) ?? local
      const kind = layer.xtext
        ? 'text'
        : (layer.xshape as { tool?: string } | undefined)?.tool ??
          (typeof layer.xsrc === 'string' ? 'path' : layer.refId ? 'image' : 'shape')
      // gs(그라디언트 스트로크)도 획이다 — st만 보면 드로우온 후보를 놓친다
      const hasStroke = /"ty":"(st|gs)"/.test(JSON.stringify(layer.shapes ?? ''))
      // 트림은 shapes의 gr 그룹에 tm을 심는 방식 — 그룹이 없으면 ts/te가 무성 no-op이다
      const shapes = layer.shapes as Record<string, unknown>[] | undefined
      const canTrim = !!shapes?.some((g) => g.ty === 'tm' || (g.ty === 'gr' && Array.isArray(g.it)))
      const parentInd = layer.parent
      const parent =
        typeof parentInd === 'number' && indToIdx.has(parentInd) ? (indToIdx.get(parentInd) as number) : null
      // layerHalfOf는 실측이 없으면 [60,60]로 폴백한다 — 모델에 확신에 찬 오답을 주느니 뺀다
      const g0 = (layer.shapes as Record<string, unknown>[] | undefined)?.[0]
      const knownBox =
        (Number(layer.ty) === 0 && typeof layer.w === 'number') ||
        typeof layer.refId === 'string' ||
        (typeof g0?.bboxW === 'number' && typeof g0?.bboxH === 'number')
      const half = layerHalfOf(src, i, at)
      return {
        index: i,
        name: String(layer.nm ?? `레이어 ${i + 1}`),
        kind,
        ...(layer.xtext
          ? { text: String((layer.xtext as { text?: unknown }).text ?? '').slice(0, 40) }
          : {}),
        hasStroke,
        canTrim,
        selected: sel.has(i),
        locked: layer.xlock === true,
        center: [Math.round(world[0]), Math.round(world[1])] as [number, number],
        localPos: [Math.round(local[0]), Math.round(local[1])] as [number, number],
        parent,
        ...(knownBox
          ? { renderedBox: [Math.round(half[0] * 2), Math.round(half[1] * 2)] as [number, number] }
          : {}),
        scale: Math.round(xsel.scale),
        anchor: xsel.anchor,
        rotation: xsel.rotation,
        opacity: xsel.opacity,
        clip: [xsel.clip[0], xsel.clip[1]] as [number, number],
        mode: (xkf.on ? 'keyframes' : 'preset') as 'keyframes' | 'preset',
        ...(xkf.on && xkf.keys.length
          ? {
              keys: stripKeys(xkf.keys),
              ...(xkf.keys.some((k) => k.pk) ? { hasPathAnim: true } : {}),
              ...(xkf.keys.some((k) => k.gk) ? { hasGradAnim: true } : {}),
            }
          : {}),
        ...(xkf.on
          ? {}
          : {
              preset: {
                in: IN_TYPES[xsel.in.type] ?? '없음',
                loop: LOOP_TYPES[xsel.loop.type] ?? '없음',
                out: OUT_TYPES[xsel.out.type] ?? '없음',
              },
            }),
      }
    }),
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 모델이 낸 위치 값 → [x,y]. 배열 외에 {x,y}/{"0","1"} 형태도 받는다. */
function coercePair(v: unknown): [number, number] | null {
  if (Array.isArray(v) && fin(v[0]) && fin(v[1])) return [v[0], v[1]]
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const x = fin(o.x) ? o.x : fin(o['0']) ? (o['0'] as number) : undefined
    const y = fin(o.y) ? o.y : fin(o['1']) ? (o['1'] as number) : undefined
    if (x !== undefined && y !== undefined) return [x, y]
  }
  return null
}

/**
 * 모델 출력 검증·클램프 — 유효 레이어가 하나도 없으면 throw.
 * 버리거나 고친 것은 plan.issues로 올린다 (조용한 손실이 "적용됨"으로 보이면 안 된다).
 */
export function sanitizePlan(raw: unknown, layerCount: number, op: number): AiMotionPlan {
  const r = (raw ?? {}) as Record<string, unknown>
  const springs = new Map<KfKey, { z: number }>()
  const byIndex = new Map<
    number,
    {
      keys: KfKey[]
      clip?: [number, number]
      mode?: 'replace' | 'merge'
      path?: 'linear' | 'smooth'
      anchor?: [number, number]
    }
  >()
  const issues: string[] = []
  let outOfRange = 0
  let pastEnd = 0
  let emptyKeys = 0
  let coerced = 0
  let deadSpring = 0
  const rawLayers = Array.isArray(r.layers) ? (r.layers as Record<string, unknown>[]) : []
  for (const rl of rawLayers) {
    if (!rl || typeof rl !== 'object') continue
    const index = Math.round(Number(rl.index))
    if (!Number.isFinite(index) || index < 0 || index >= layerCount) {
      outOfRange++
      continue
    }
    const entry = byIndex.get(index) ?? { keys: [] }
    for (const rk of Array.isArray(rl.keys) ? (rl.keys as Record<string, unknown>[]) : []) {
      if (!rk || !fin(rk.t)) continue
      if (rk.t > op || rk.t < 0) pastEnd++
      const key: KfKey = { t: Math.round(clamp(rk.t, 0, op) * 10) / 10 }
      const p = coercePair(rk.p)
      if (p) {
        if (!Array.isArray(rk.p)) coerced++
        key.p = [clamp(p[0], -4096, 4096), clamp(p[1], -4096, 4096)]
      }
      if (fin(rk.s)) key.s = clamp(rk.s, 0, 1000)
      if (fin(rk.r)) key.r = clamp(rk.r, -3600, 3600)
      if (fin(rk.o)) key.o = clamp(rk.o, 0, 100)
      if (fin(rk.ts)) key.ts = clamp(rk.ts, 0, 100)
      if (fin(rk.te)) key.te = clamp(rk.te, 0, 100)
      if (
        key.p === undefined && key.s === undefined && key.r === undefined &&
        key.o === undefined && key.ts === undefined && key.te === undefined
      ) {
        emptyKeys++
        continue
      }
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
      } else {
        entry.keys.push(key)
      }
      // spring 플래그 — true=0.5, 숫자/{"damping":n} 허용 (낮을수록 출렁).
      // 0.6 초과는 bakeSprings의 진폭 컷에 걸려 키를 0개 만든다(= 무성 no-op) — 0.6으로 낮춘다.
      // spring:0("끄기" 의도)이 하한 클램프로 가장 출렁이는 값이 되지 않게 양수만 받는다.
      const sp = rk.spring
      const zRaw =
        sp === true
          ? 0.5
          : fin(sp) && (sp as number) > 0
            ? (sp as number)
            : sp && typeof sp === 'object' && fin((sp as { damping?: unknown }).damping)
              ? (sp as { damping: number }).damping
              : undefined
      if (zRaw !== undefined && zRaw > 0) {
        if (zRaw > 0.6) deadSpring++
        springs.set(dup ?? key, { z: clamp(zRaw, 0.15, 0.6) })
      }
    }
    const c = coercePair(rl.clip)
    if (c) {
      const a = clamp(Math.round(c[0]), 0, op)
      const b = clamp(Math.round(c[1]), 0, op)
      entry.clip = a <= b ? [a, b] : [b, a]
    }
    if (rl.mode === 'merge' || rl.mode === 'replace') entry.mode = rl.mode
    if (rl.path === 'linear' || rl.path === 'smooth') entry.path = rl.path
    const an = coercePair(rl.anchor)
    if (an) entry.anchor = [clamp(an[0], 0, 1), clamp(an[1], 0, 1)]
    byIndex.set(index, entry)
  }
  let capped = 0
  let clipWidened = 0
  const layers: AiLayerPlan[] = [...byIndex.entries()]
    .filter(([, v]) => v.keys.length > 0)
    .map(([index, v]) => {
      const baked = bakeSprings(v.keys.sort((a, b) => a.t - b.t), springs)
      // 60키 상한은 스프링 베이크까지 끝난 뒤 시각 순으로 자른다 — 중간 키가 통째로 사라지지 않게
      if (baked.length > 60) capped += baked.length - 60
      const keys = baked.length > 60 ? baked.slice(0, 60) : baked
      // 클립 밖 키는 렌더 자체가 안 된다 — 모델이 둘을 어긋나게 냈으면 클립을 키 범위로 넓힌다
      let clip = v.clip
      if (clip) {
        const lo = Math.min(clip[0], Math.floor(keys[0].t))
        const hi = Math.max(clip[1], Math.ceil(keys[keys.length - 1].t))
        if (lo !== clip[0] || hi !== clip[1]) {
          clipWidened++
          clip = [clamp(lo, 0, op), clamp(hi, 0, op)]
        }
      }
      return {
        index,
        keys,
        ...(clip ? { clip } : {}),
        ...(v.mode ? { mode: v.mode } : {}),
        ...(v.path ? { path: v.path } : {}),
        ...(v.anchor ? { anchor: v.anchor } : {}),
      }
    })
    .sort((a, b) => a.index - b.index)
  const n = (msg: string, count: number) => msg.replace('{n}', String(count))
  if (outOfRange) issues.push(n(t('레이어 {n}개는 없는 인덱스라 건너뛰었습니다'), outOfRange))
  if (pastEnd) issues.push(n(t('키 {n}개가 컴포지션 길이를 벗어나 잘렸습니다'), pastEnd))
  if (emptyKeys) issues.push(n(t('값이 없는 키 {n}개를 버렸습니다'), emptyKeys))
  if (coerced) issues.push(n(t('위치 값 {n}개를 [x,y] 형식으로 고쳤습니다'), coerced))
  if (deadSpring) issues.push(n(t('효과가 없는 스프링 감쇠 {n}개를 0.6으로 낮췄습니다'), deadSpring))
  if (capped) issues.push(n(t('키 상한(60)을 넘겨 {n}개를 잘랐습니다'), capped))
  if (clipWidened) issues.push(n(t('키가 클립 밖이라 레이어 {n}개의 표시 구간을 넓혔습니다'), clipWidened))
  if (!layers.length)
    throw new Error(
      `${t('AI가 적용 가능한 모션을 만들지 못했습니다 — 요청을 더 구체적으로 써보세요')}${
        issues.length ? ` (${issues.join(' / ')})` : ''
      }`,
    )
  const note = typeof r.note === 'string' ? r.note.slice(0, 200) : undefined
  return { layers, ...(note ? { note } : {}), ...(issues.length ? { issues } : {}) }
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
  description: 'Apply keyframe motion to layers of the composition. The keys array fully replaces the existing keyframes of that layer, and also discards that layer\'s in/loop/out preset.',
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
            mode: {
              type: 'string',
              enum: ['replace', 'merge'],
              description: "default 'replace' (keys become the layer's whole animation). Use 'merge' to keep the layer's existing keys and only add/overwrite the times you list — for partial edits like 'keep it but add a rotation'.",
            },
            anchor: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
              description: 'move the rotation/scale pivot to this fraction of the layer box before applying keys — [0.5,0.5] is the middle, [0.5,1] the bottom edge, [0,0.5] the left edge. Only set it when the request implies a different pivot (a clock hand, a swinging sign, a door).',
            },
            path: {
              type: 'string',
              enum: ['linear', 'smooth'],
              description: "position path shape. Omit to let the engine decide (3+ position keys curve). 'linear' forces straight segments and sharp corners; 'smooth' forces a curve.",
            },
            clip: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
              description: 'visibility span [inFrame, outFrame] — the layer is NOT rendered outside it, so keys outside are invisible. Minimum 8 frames. Omit to keep the layer current clip.',
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
                    description: 'layer position [x,y] in the PARENT coordinate space (canvas px when the layer has no parent). Absolute, not an offset.',
                  },
                  s: { type: 'number', description: 'uniform scale percent, absolute (100 = the layer at its original size, NOT its current size)' },
                  r: { type: 'number', description: 'rotation degrees clockwise, absolute — around the layer anchor' },
                  o: { type: 'number', description: 'opacity percent 0..100' },
                  ts: { type: 'number', description: 'trim-path start percent 0..100 — only on layers with canTrim: true (silently does nothing otherwise); animate with te for draw-on effects' },
                  te: { type: 'number', description: 'trim-path end percent 0..100 — only on layers with canTrim: true' },
                  e: {
                    type: 'object',
                    properties: {
                      p: BEZ_SCHEMA, s: BEZ_SCHEMA, r: BEZ_SCHEMA, o: BEZ_SCHEMA,
                      ts: BEZ_SCHEMA, te: BEZ_SCHEMA,
                    },
                    description: 'per-channel easing toward the NEXT key; omit on the last key. A key with no easing is LINEAR (constant velocity).',
                  },
                  spring: {
                    type: ['boolean', 'number'],
                    description: 'physical overshoot-settle into THIS key for p/s/r — true (damping 0.5) or a damping in 0.2 (loose, wobbly) .. 0.6 (subtlest that still overshoots). Above 0.6 bakes nothing and degrades to a plain ease. Needs 4+ frames from the previous key of that channel. The engine bakes the extra keyframes. Prefer this for arrivals, pop-ins, snaps.',
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
{"layers":[{"index":<int>,"clip":[inFrame,outFrame] (optional),"mode":"replace"|"merge" (optional),"path":"linear"|"smooth" (optional),"anchor":[fx,fy] (optional),"keys":[{"t":<frames>,"p":[x,y],"s":<scale%>,"r":<deg>,"o":<opacity%>,"ts":<trim start%>,"te":<trim end%>,"spring":true|<damping 0.2..0.6>,"e":{"p":[x1,y1,x2,y2],"s":[...],"r":[...],"o":[...]}}]}],"note":"한국어 한 문장"}
Every key needs t plus at least one of p/s/r/o/ts/te. All fields except t are optional.`
  return `You are the motion assistant inside LottieMaker, a web tool for building Lottie animations.
The user describes motion in Korean or English. ${respond}

Composition: ${doc.w}x${doc.h} px canvas (origin top-left), ${doc.fr} fps, ${doc.op} frames long (${Math.round((doc.op / doc.fr) * 100) / 100}s). Playhead at frame ${doc.playhead}.

Keyframe semantics:
- t is in frames, within [0, ${doc.op}]. You CANNOT change the composition length — keys past ${doc.op} are dropped. If the request needs a longer comp, say so in note.
- p = layer position in canvas px. s = uniform scale %. r = rotation degrees. o = opacity % (0..100).
- All four are ABSOLUTE, not relative to the layer's current pose. A layer at scale 50 / rotation 30 still needs s:50 / r:30 to stay put — writing s:100 or r:0 snaps it. Each layer's current values are in the state (scale, rotation, opacity, center).
- p is in the PARENT's coordinate space. For a layer with parent: null, that is canvas coords (use center). For a parented layer, plan against localPos — canvas coords will land somewhere else.
- r rotates around anchor (a fraction of the layer box, [0.5,0.5] = middle). It is given per layer; you cannot change it.
- A channel with a single key is static at that value. Channels you omit keep their current settled value.
- keys REPLACE the layer's existing keyframes entirely. For a layer with mode "preset", applying keys also DISCARDS its in/loop/out preset (listed in the state) — if the user wants those kept, rebuild them as keys.
- Two keys of the same channel closer than 1 frame get merged (first wins). For a hard cut, leave at least 1 frame between them.
- e on a key eases the segment from that key to the NEXT key of the same channel. x1,x2 in [0,1]; y1,y2 may leave [0,1] (max -2..3) for anticipation/overshoot.
- A key with NO e is LINEAR (constant velocity). That is what you want for spinners and marquees; for anything organic set e explicitly.
- 3 or more position keys turn the path into a Catmull-Rom curve through them — good for arcs, wrong for L-shaped or angular paths. Keep position to 2 keys per move when the path must be straight or the corner sharp. Note springs add position keys too, so a sprung move can cross that threshold.
- clip [inFrame, outFrame] is the layer's visibility span: outside it the layer is NOT RENDERED AT ALL, so any key outside the clip is invisible. The layer's current clip is in the state — either keep your keys inside it, or widen the clip in the same layer entry. Minimum span is 8 frames. Omit clip to leave it unchanged.
- Layers with locked: true cannot be changed — do not plan motion for them.
- ts/te only work on layers with canTrim: true. hasPathAnim / hasGradAnim layers have path-morph or gradient animation you cannot see or author — plan other channels and leave those alone.

Craft guidelines:
- Prefer expressive easing over linear: ease-out [0.22,1,0.36,1], ease-in-out [0.65,0,0.35,1], anticipation dip or >100% overshoot via extra keys.
- Natural arrivals: put "spring": true on the destination key (p/s/r) — the engine bakes a physical overshoot-settle into that segment. Damping tunes it over 0.2..0.6: 0.2 loose and wobbly, 0.5 default, 0.6 the subtlest that still moves. Above 0.6 the overshoot is too small to survive and you get a plain ease, so never ask for it; omit spring entirely if you do not want one. USE THIS instead of hand-crafting overshoot keys. Example pop-in: {"t":0,"s":0},{"t":18,"s":100,"spring":0.4}.
- A spring needs at least 4 frames from the previous key of that same channel, and it reaches the target around 45-55% into the segment before settling — account for that when staggering layers.
- Bounce off a floor (falling ball) = several keys with decreasing amplitude, ease-out falling / ease-in rising — spring won't do ground contact.
- Give the settle room: a sprung segment reads best over 15+ frames.
- When the request implies sequence over multiple layers, stagger their key times (e.g. 4-8 frame offsets).
- Off-canvas start/end positions are fine for entries/exits; settled poses should sit inside the canvas.
- ts/te animate the trim path (draw-on): typical draw effect = te 0->100 (ts 0 static). ONLY on layers with canTrim: true — on any other layer they do nothing at all and the user sees no change. Great for strokes (hasStroke: true) and pen paths (kind: path).
- kind tells you what each layer is (rect/ellipse/star/text/path/image) — match layers to the request by kind and name.
- If specific layers are selected (selected: true), animate those; otherwise animate the layers that best match the request (all if it is global).
- For a follow-up that adjusts existing motion ("keep it, just add X", "only change the rotation"), set mode:"merge" on that layer and list only the keys you are adding or changing. Use the default replace when rebuilding the motion from scratch.
- Set path:"linear" on a layer whose position must travel in straight segments with sharp corners (L-shapes, rectangles, zigzags); otherwise leave it out.
- r spins around the layer anchor. When the request implies a different pivot (clock hand, swinging sign, hinged door, pendulum), set anchor on that layer — [0.5,1] bottom edge, [0.5,0] top edge, [0,0.5] left edge — and the engine moves the pivot without moving the graphic.
- Keep motion within the composition length. End settled unless a loop is asked; for loops make the last key equal the first key of that channel.
- note: one short Korean sentence.`
}

/** 상태별 한국어 에러 매핑 — UI에 그대로 표출. fatal 표시로 형식 재시도를 막는다. */
function apiError(status: number, detail: string): Error {
  const e = apiErrorMsg(status, detail) as Error & { fatal?: boolean; status?: number }
  e.fatal = true
  e.status = status
  return e
}

function apiErrorMsg(status: number, detail: string): Error {
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
          options: { temperature: 0, num_ctx: getLocalCtx() },
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
    const err = e as Error
    if (err.name === 'AbortError') throw e
    // 스키마 위반/파싱 실패 — 1회 재시도 (실제 실패 원인을 실어 보낸다)
    onProgress?.(t('형식이 어긋나 다시 요청 중'))
    return ask(
      `\n\n(이전 응답을 쓸 수 없었습니다: ${err.message}. 지시된 JSON 오브젝트 하나만, 다른 텍스트 없이 출력하세요.)`,
    )
  }
}

/**
 * OpenAI 호환 chat/completions 공용 경로 — SSE 누적 + JSON 모드, 베이스 폴백, 1회 형식 재시도.
 * GLM(Z.ai)·DeepSeek·OpenRouter가 모두 같은 스펙이라 프로바이더별 차이는 인자로만 받는다.
 */
async function generateMotionOpenAi(opts: {
  apiKey: string
  /** 요청에 실제로 보낼 모델 id (슬러그 변환까지 끝난 값). */
  model: string
  /** 시도 순서대로의 엔드포인트. 401/403/404면 다음 것으로 넘어간다. */
  bases: string[]
  /** 상태·에러 문구에 쓸 이름. */
  brand: string
  /** 401/403일 때 보여줄 안내. */
  authHint: string
  /** fetch 자체가 실패했을 때(네트워크·CORS) 보여줄 안내. */
  netHint: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
  /** 성공한 엔드포인트 기억 훅 (GLM 코딩/일반 플랜 전환용). */
  onBase?: (base: string) => void
}): Promise<AiMotionPlan> {
  const { apiKey, model, bases, brand, authHint, netHint, prompt, doc, signal, onProgress, onBase } = opts
  const askAt = async (base: string, extra: string): Promise<AiMotionPlan> => {
    onProgress?.(t('{brand}에 연결 중').replace('{brand}', brand))
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
          model,
          stream: true,
          // 상한이 없으면 프로바이더 기본값(보통 짧다)에 걸려 JSON이 중간에 끊긴다
          max_tokens: 16000,
          // 구조화 출력 작업 — 표본 다양성이 정확도를 깎는다
          temperature: 0,
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
      throw new Error(netHint)
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
          ? authHint + (detail ? ` (${detail})` : '')
          : detail || t('API 오류 ({status})').replace('{status}', String(res.status)),
      ) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    onBase?.(base)
    // OpenAI 형식 SSE — choices[0].delta.content 누적
    const reader = res.body?.getReader()
    let acc = ''
    let finish = ''
    if (reader) {
      const dec = new TextDecoder()
      let buf = ''
      const eat = (ln: string) => {
        const m = ln.startsWith('data:') ? ln.slice(5).trim() : ''
        if (!m || m === '[DONE]') return
        try {
          const j = JSON.parse(m) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[]
          }
          acc += j.choices?.[0]?.delta?.content ?? ''
          const fr = j.choices?.[0]?.finish_reason
          if (fr) finish = fr
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
    // 잘림은 재시도해도 같은 길이에서 또 끊긴다 — 형식 오류로 오분류하지 않는다
    if (finish === 'length') {
      const err = new Error(t('응답이 너무 길어 잘렸습니다 — 요청을 더 작게 나눠보세요')) as Error & {
        fatal?: boolean
      }
      err.fatal = true
      throw err
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
      // 플랜/경로가 다른 키 — 다음 엔드포인트로 자동 전환
      if ((st === 401 || st === 403 || st === 404) && bases[1]) return askAt(bases[1], extra)
      throw e
    }
  }
  try {
    return await ask('')
  } catch (e) {
    const err = e as Error & { status?: number; fatal?: boolean }
    if (err.name === 'AbortError' || err.status || err.fatal) throw e
    onProgress?.(t('형식이 어긋나 다시 요청 중'))
    return ask(
      `\n\n(이전 응답을 쓸 수 없었습니다: ${err.message}. 지시된 JSON 오브젝트 하나만, 다른 텍스트 없이 출력하세요.)`,
    )
  }
}

/** GLM(Z.ai) — 엔드포인트 자동 전환(코딩 플랜/일반), OpenRouter 키는 슬러그 변환. */
export function generateMotionGlm(opts: {
  apiKey: string
  model: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
}): Promise<AiMotionPlan> {
  const { apiKey, model, ...rest } = opts
  // OpenRouter 키(sk-or-…)는 엔드포인트/모델 슬러그 자동 전환
  const orKey = apiKey.startsWith('sk-or-')
  let bases: string[]
  if (orKey) {
    bases = [OPENROUTER_BASE]
  } else {
    try {
      const saved = localStorage.getItem(GLM_BASE_STORAGE)
      bases = saved ? [saved, ...GLM_BASES.filter((b) => b !== saved)] : [...GLM_BASES]
    } catch {
      bases = [...GLM_BASES]
    }
  }
  return generateMotionOpenAi({
    ...rest,
    apiKey,
    model: orKey && !model.includes('/') ? `z-ai/${model}` : model,
    bases,
    brand: 'GLM',
    authHint: t('GLM 키 인증 실패 — 키와 플랜(코딩/일반)을 확인하세요'),
    netHint: t('네트워크 오류 — 인터넷 연결을 확인하세요'),
    onBase: orKey
      ? undefined
      : (base) => {
          try {
            localStorage.setItem(GLM_BASE_STORAGE, base) // 성공 엔드포인트 기억
          } catch {
            // 무시
          }
        },
  })
}

/**
 * DeepSeek — 공식 API(api.deepseek.com) 또는 OpenRouter 키(sk-or-…)로.
 * 공식 API는 날짜 없는 별칭만 받으므로(deepseek-v4-flash = V4-Flash-0731),
 * 0731 같은 고정 스냅샷을 쓰려면 OpenRouter 키 + deepseek-v4-flash-0731.
 */
export function generateMotionDeepseek(opts: {
  apiKey: string
  model: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
}): Promise<AiMotionPlan> {
  const { apiKey, model, ...rest } = opts
  const orKey = apiKey.startsWith('sk-or-')
  return generateMotionOpenAi({
    ...rest,
    apiKey,
    model: orKey && !model.includes('/') ? `deepseek/${model}` : model,
    bases: orKey ? [OPENROUTER_BASE] : [DEEPSEEK_BASE],
    brand: 'DeepSeek',
    authHint: t('DeepSeek 키 인증 실패 — 키를 확인하세요'),
    // 공식 API가 브라우저 요청을 막는 경우가 있어 대안을 알려준다
    netHint: t('DeepSeek 연결 실패 — 브라우저에서 막히면 OpenRouter 키(sk-or-…)를 쓰세요'),
  })
}

/**
 * Ling(InclusionAI) — ZenMux 키 또는 OpenRouter 키(sk-or-…)로.
 * 두 라우터 모두 inclusionai/ 슬러그를 요구해서 접두는 항상 붙인다.
 */
export function generateMotionLing(opts: {
  apiKey: string
  model: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
}): Promise<AiMotionPlan> {
  const { apiKey, model, ...rest } = opts
  const orKey = apiKey.startsWith('sk-or-')
  return generateMotionOpenAi({
    ...rest,
    apiKey,
    model: model.includes('/') ? model : `inclusionai/${model}`,
    bases: orKey ? [OPENROUTER_BASE] : [ZENMUX_BASE],
    brand: 'Ling',
    authHint: t('Ling 키 인증 실패 — 키를 확인하세요'),
    netHint: t('Ling 연결 실패 — 브라우저에서 막히면 OpenRouter 키(sk-or-…)를 쓰세요'),
  })
}

/**
 * Gemini — Google AI Studio 키(OpenAI 호환 경로) 또는 OpenRouter 키(sk-or-…)로.
 * OpenRouter로 보낼 때만 google/ 슬러그를 붙인다.
 */
export function generateMotionGemini(opts: {
  apiKey: string
  model: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
}): Promise<AiMotionPlan> {
  const { apiKey, model, ...rest } = opts
  const orKey = apiKey.startsWith('sk-or-')
  return generateMotionOpenAi({
    ...rest,
    apiKey,
    model: orKey && !model.includes('/') ? `google/${model}` : model,
    bases: orKey ? [OPENROUTER_BASE] : [GEMINI_BASE],
    brand: 'Gemini',
    authHint: t('Gemini 키 인증 실패 — 키를 확인하세요'),
    netHint: t('Gemini 연결 실패 — 브라우저에서 막히면 OpenRouter 키(sk-or-…)를 쓰세요'),
  })
}

export async function generateMotion(opts: {
  apiKey: string
  prompt: string
  doc: AiDocSummary
  signal?: AbortSignal
  onProgress?: (status: string) => void
}): Promise<AiMotionPlan> {
  const { apiKey, prompt, doc, signal, onProgress } = opts
  const ask = async (extra: string): Promise<AiMotionPlan> => {
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
          // 프레임 오프셋·캔버스 밖 좌표·스프링 도착 타이밍을 한 번에 세워야 하는 작업이라
          // effort를 낮추면 계획 단계가 통째로 날아간다. max_tokens는 thinking + 툴 JSON 합산 상한.
          max_tokens: 32000,
          output_config: { effort: 'high' },
          stream: true,
          system: systemPrompt(doc),
          tools: [MOTION_TOOL],
          tool_choice: { type: 'tool', name: 'apply_motion' },
          messages: [
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
    // 잘림 판정이 먼저다 — 툴 블록이 열린 뒤 잘리면 sawTool/inputJson이 둘 다 truthy라
    // 아래 가드를 통과해 "다시 시도해보세요"로 오진된다 (같은 요청을 다시 보내도 또 잘린다).
    if (stopReason === 'max_tokens') {
      const err = new Error(t('응답이 너무 길어 잘렸습니다 — 요청을 더 작게 나눠보세요')) as Error & {
        fatal?: boolean
      }
      err.fatal = true
      throw err
    }
    if (!sawTool || !inputJson) {
      // refusal은 같은 프롬프트 재시도가 무의미 — 재시도 안내 대신 표현 변경 안내
      if (stopReason === 'refusal') {
        const err = new Error(t('요청이 거부되었습니다 — 다른 표현으로 다시 써보세요')) as Error & {
          fatal?: boolean
        }
        err.fatal = true
        throw err
      }
      throw new Error(t('AI가 모션을 반환하지 않았습니다 — 다시 시도해보세요'))
    }
    onProgress?.(t('모션 검증 중'))
    const parsed = JSON.parse(inputJson) as unknown // 실패 시 아래에서 1회 재시도
    return sanitizePlan(parsed, doc.layers.length, doc.op)
  }
  try {
    return await ask('')
  } catch (e) {
    const err = e as Error & { fatal?: boolean; status?: number }
    // 중단·API 오류·잘림·거부는 재시도해도 같은 결과 — 형식 실패만 1회 더
    if (err.name === 'AbortError' || err.fatal || err.status) throw err
    onProgress?.(t('형식이 어긋나 다시 요청 중'))
    return ask(
      `\n\n(이전 응답을 쓸 수 없었습니다: ${err.message}. apply_motion 툴을 정확히 한 번 호출하세요.)`,
    )
  }
}
