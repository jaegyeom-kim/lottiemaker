// 드로잉 툴 → SVG 문자열 — svgToLottie 파이프라인 재사용 (색상 편집·bbox·스케일 전부 공짜).
// 좌표는 로컬 (0,0)-(w,h). 배치는 addCustomLayer(at=중심, size=긴 변)가 담당.

export type DrawTool = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'pen'
export const DRAW_FILL = '#3380f5'
export const STROKE_W = 8

const HEAD = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`

/** 5각 별 포인트 (외경 R, 내경 R*0.382 — Figma 기본과 동일 비율). */
function starPoints(w: number, h: number): string {
  const cx = w / 2
  const cy = h / 2
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5
    const rx = (i % 2 === 0 ? 0.5 : 0.191) * w
    const ry = (i % 2 === 0 ? 0.5 : 0.191) * h
    pts.push(`${(cx + Math.cos(ang) * rx).toFixed(2)},${(cy + Math.sin(ang) * ry).toFixed(2)}`)
  }
  return pts.join(' ')
}

/** 고스트 오버레이용 폴리곤 포인트 (캔버스 좌표 x,y 오프셋). */
export function shapeGhostPoints(
  tool: 'polygon' | 'star',
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  if (tool === 'polygon') return `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`
  return starPoints(w, h)
    .split(' ')
    .map((pt) => {
      const [px, py] = pt.split(',').map(Number)
      return `${px + x},${py + y}`
    })
    .join(' ')
}

/** 박스 드래그 도형 → SVG. line은 dx/dy 부호로 방향 유지. */
export function buildShapeSvg(
  tool: DrawTool,
  w: number,
  h: number,
  line?: { dx: number; dy: number },
): string {
  const W = Math.max(4, Math.round(w))
  const H = Math.max(4, Math.round(h))
  switch (tool) {
    case 'rect':
      return `${HEAD(W, H)}<rect width="${W}" height="${H}" fill="${DRAW_FILL}"/></svg>`
    case 'ellipse':
      return `${HEAD(W, H)}<ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2}" ry="${H / 2}" fill="${DRAW_FILL}"/></svg>`
    case 'polygon':
      return `${HEAD(W, H)}<polygon points="${W / 2},0 ${W},${H} 0,${H}" fill="${DRAW_FILL}"/></svg>`
    case 'star':
      return `${HEAD(W, H)}<polygon points="${starPoints(W, H)}" fill="${DRAW_FILL}"/></svg>`
    case 'line': {
      // 스트로크 여유 패딩 — bbox가 선을 자르지 않게
      const pad = STROKE_W / 2 + 1
      const dx = line?.dx ?? W
      const dy = line?.dy ?? H
      const lw = Math.abs(dx) + pad * 2
      const lh = Math.abs(dy) + pad * 2
      const x1 = dx >= 0 ? pad : lw - pad
      const y1 = dy >= 0 ? pad : lh - pad
      const x2 = dx >= 0 ? lw - pad : pad
      const y2 = dy >= 0 ? lh - pad : pad
      return `${HEAD(Math.round(lw), Math.round(lh))}<polyline points="${x1},${y1} ${x2},${y2}" fill="none" stroke="${DRAW_FILL}" stroke-width="${STROKE_W}" stroke-linecap="round"/></svg>`
    }
    default:
      return `${HEAD(W, H)}<rect width="${W}" height="${H}" fill="${DRAW_FILL}"/></svg>`
  }
}

/** 펜 포인트 — p 앵커, ho 나가는 핸들, hi 들어오는 핸들 (독립 — ⌥로 꺾인 앵커). */
export interface PenPt {
  p: [number, number]
  /** 나가는 핸들 (다음 세그먼트 방향), p 기준 상대. */
  ho: [number, number] | null
  /** 들어오는 핸들 (이전 세그먼트 방향), p 기준 상대. */
  hi: [number, number] | null
}

/** 펜 포인트 → path d (좌표 그대로 — 프리뷰 오버레이용). */
export function penPathD(pts: PenPt[], closed: boolean, hover?: [number, number] | null): string {
  if (!pts.length) return ''
  const seg = (a: PenPt, b: PenPt) => {
    if (!a.ho && !b.hi) return `L ${b.p[0]} ${b.p[1]}`
    const c1: [number, number] = a.ho ? [a.p[0] + a.ho[0], a.p[1] + a.ho[1]] : a.p
    const c2: [number, number] = b.hi ? [b.p[0] + b.hi[0], b.p[1] + b.hi[1]] : b.p
    return `C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${b.p[0]} ${b.p[1]}`
  }
  let d = `M ${pts[0].p[0]} ${pts[0].p[1]}`
  for (let i = 1; i < pts.length; i++) d += ` ${seg(pts[i - 1], pts[i])}`
  if (hover && pts.length) {
    d += ` ${seg(pts[pts.length - 1], { p: hover, ho: null, hi: null })}`
  }
  if (closed && pts.length >= 3) d += ` ${seg(pts[pts.length - 1], pts[0])} Z`
  return d
}

/** 펜 경로 → SVG (로컬 좌표로 이동). closed = fill, open = stroke. 중심·크기 동봉. */
export function buildPenSvg(
  pts: PenPt[],
  closed: boolean,
): { svg: string; center: [number, number]; size: number } | null {
  if (pts.length < 2) return null
  const xs = pts.flatMap((pt) => [
    pt.p[0], pt.p[0] + (pt.ho?.[0] ?? 0), pt.p[0] + (pt.hi?.[0] ?? 0),
  ])
  const ys = pts.flatMap((pt) => [
    pt.p[1], pt.p[1] + (pt.ho?.[1] ?? 0), pt.p[1] + (pt.hi?.[1] ?? 0),
  ])
  const pad = closed ? 2 : STROKE_W / 2 + 1
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const w = Math.max(4, Math.max(...xs) + pad - minX)
  const h = Math.max(4, Math.max(...ys) + pad - minY)
  const local = pts.map((pt) => ({
    p: [pt.p[0] - minX, pt.p[1] - minY] as [number, number],
    ho: pt.ho,
    hi: pt.hi,
  }))
  const d = penPathD(local, closed)
  const paint = closed
    ? `fill="${DRAW_FILL}"`
    : `fill="none" stroke="${DRAW_FILL}" stroke-width="${STROKE_W}" stroke-linecap="round" stroke-linejoin="round"`
  return {
    svg: `${HEAD(Math.round(w), Math.round(h))}<path d="${d}" ${paint}/></svg>`,
    center: [minX + w / 2, minY + h / 2],
    size: Math.max(w, h),
  }
}
