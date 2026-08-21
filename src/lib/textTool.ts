// 텍스트 툴 — 업로드한 폰트(.ttf/.otf)로 텍스트를 패스로 변환해 셰이프 레이어로.
// 로티 텍스트 레이어(ty:5)는 뷰어에 폰트가 있어야 렌더되지만, 패스 변환은 호환 100%.
// opentype.js는 사용 시점에만 지연 로드 — 초기 번들 제외.
import type { Font } from 'opentype.js'
import { idbFontGet, idbFontPut } from './sessionStore'
import { DRAW_FILL } from './drawTools'

export interface TextSpec {
  text: string
  /** 업로드 폰트 이름 (IDB 키). */
  font: string
  /** 폰트 크기 px. */
  size: number
  /** 줄 간격 배율 (size × lh). */
  lh: number
}

export const DEFAULT_TEXT_SPEC: Omit<TextSpec, 'font'> = { text: '텍스트', size: 64, lh: 1.2 }

const fontCache = new Map<string, Font>()

/** 폰트 파일 등록 — 파싱 검증 후 IDB 저장 (실패 시 throw). */
export async function registerFont(name: string, buf: ArrayBuffer): Promise<void> {
  const { parse } = await import('opentype.js')
  const font = parse(buf) // 손상 파일이면 여기서 throw
  await idbFontPut(name, buf)
  fontCache.set(name, font)
}

/** 저장된 폰트 로드 (캐시). */
export async function loadFont(name: string): Promise<Font | null> {
  const hit = fontCache.get(name)
  if (hit) return hit
  const buf = await idbFontGet(name)
  if (!buf) return null
  const { parse } = await import('opentype.js')
  const font = parse(buf)
  fontCache.set(name, font)
  return font
}

/** 텍스트 → SVG (멀티라인, 좌측 정렬) — svgToLottie 파이프라인용. */
export function textToSvg(
  font: Font,
  spec: Pick<TextSpec, 'text' | 'size' | 'lh'>,
): { svg: string; size: number } | null {
  const lines = spec.text.split('\n')
  if (!lines.some((l) => l.trim().length)) return null
  let d = ''
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  lines.forEach((line, i) => {
    if (!line.length) return
    const path = font.getPath(line, 0, i * spec.size * spec.lh, spec.size)
    const bb = path.getBoundingBox()
    if (bb.x2 > bb.x1) {
      minX = Math.min(minX, bb.x1)
      minY = Math.min(minY, bb.y1)
      maxX = Math.max(maxX, bb.x2)
      maxY = Math.max(maxY, bb.y2)
      d += path.toPathData(2)
    }
  })
  if (!d || !Number.isFinite(minX)) return null
  const pad = 2
  const w = Math.max(4, Math.ceil(maxX - minX + pad * 2))
  const h = Math.max(4, Math.ceil(maxY - minY + pad * 2))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<g transform="translate(${(pad - minX).toFixed(2)} ${(pad - minY).toFixed(2)})">` +
    `<path d="${d}" fill="${DRAW_FILL}"/></g></svg>`
  return { svg, size: Math.max(w, h) }
}
