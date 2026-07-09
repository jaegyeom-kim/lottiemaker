// Lottie JSON 구조 유틸리티: 검증, 레이어 조작, 크기/속도 변경.

export interface LottieJson {
  v: string
  fr: number
  ip: number
  op: number
  w: number
  h: number
  nm?: string
  layers: LottieLayer[]
  assets?: unknown[]
  [key: string]: unknown
}

export interface LottieLayer {
  ind: number
  nm?: string
  ty: number
  hd?: boolean
  ip: number
  op: number
  [key: string]: unknown
}

export function isLottieJson(data: unknown): data is LottieJson {
  if (data === null || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.v === 'string' &&
    typeof d.fr === 'number' &&
    typeof d.ip === 'number' &&
    typeof d.op === 'number' &&
    Array.isArray(d.layers)
  )
}

export function parseLottie(text: string): LottieJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('JSON 파싱 실패 — 올바른 JSON 파일이 아닙니다.')
  }
  if (!isLottieJson(parsed)) {
    throw new Error('로티 형식이 아닙니다 — v, fr, ip, op, layers 필드가 필요합니다.')
  }
  return parsed
}

export interface LayerInfo {
  /** layers 배열 인덱스 — ind는 파일에 없거나 중복될 수 있어 식별자로 쓰지 않는다. */
  index: number
  name: string
  hidden: boolean
}

export function getLayers(data: LottieJson): LayerInfo[] {
  return data.layers.map((l, i) => ({
    index: i,
    name: l.nm ?? `Layer ${i + 1}`,
    hidden: l.hd === true,
  }))
}

export function toggleLayer(data: LottieJson, index: number): LottieJson {
  const clone = structuredClone(data)
  const layer = clone.layers[index]
  if (layer) layer.hd = !(layer.hd === true)
  return clone
}

export function resize(data: LottieJson, w: number, h: number): LottieJson {
  const clone = structuredClone(data)
  clone.w = Math.max(1, Math.round(w))
  clone.h = Math.max(1, Math.round(h))
  return clone
}

/** 재생 속도를 파일에 굽는다: fr을 배속만큼 올리면 프레임 수 유지, 재생 시간 단축. */
export function bakeSpeed(data: LottieJson, speed: number): LottieJson {
  const clone = structuredClone(data)
  clone.fr = Math.round(clone.fr * speed * 100) / 100
  return clone
}

export function durationSec(data: LottieJson): number {
  return (data.op - data.ip) / data.fr
}

export function download(data: LottieJson, fileName: string) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.json') ? fileName : `${fileName}.json`
  a.click()
  URL.revokeObjectURL(url)
}
