// SVG → 로티 셰이프 변환기.
// 지원: path(M/L/H/V/C/S/Q/T/A/Z), rect/circle/ellipse/polygon/polyline/line, g,
//       transform(translate/scale/rotate/matrix), 단색 fill/stroke, opacity.
// 미지원: 그라디언트(첫 스톱 색으로 대체), 텍스트(아웃라인 필요), 이미지/필터/마스크.

export interface ImportedGraphic {
  /** 로티 셰이프 아이템 배열 (gr 제외 — 호출부가 감싼다) */
  items: unknown[]
  /** 원본 좌표계 기준 바운딩 박스 */
  bbox: { x: number; y: number; w: number; h: number }
  /** 업로드 원문 SVG — 프로젝트 파일 내장/재사용용 (선택). */
  svgText?: string
}

/** 래스터(PNG/JPG/WebP) 이미지 — 로티 이미지 에셋으로 임베드된다. */
export interface ImportedImage {
  /** base64 data URI — 원본 해상도 그대로 (표시 크기는 에셋 w/h가 결정) */
  dataUri: string
  /** 원본 픽셀 크기 */
  w: number
  h: number
}

/** 래스터 이미지 파일을 data URI + 원본 크기로 읽는다. */
export function readImageFile(file: File): Promise<ImportedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다'))
    reader.onload = () => {
      const dataUri = reader.result as string
      const img = new Image()
      img.onerror = () => reject(new Error('이미지를 해석할 수 없습니다'))
      img.onload = () => resolve({ dataUri, w: img.naturalWidth, h: img.naturalHeight })
      img.src = dataUri
    }
    reader.readAsDataURL(file)
  })
}

/** fit 박스에 맞춘 표시 크기 (비율 유지, 긴 변 = fit). */
export function fitImageSize(img: ImportedImage, fit: number): { w: number; h: number } {
  const s = fit / Math.max(img.w, img.h)
  return { w: Math.round(img.w * s), h: Math.round(img.h * s) }
}

type Mat = [number, number, number, number, number, number] // a b c d e f

const ID: Mat = [1, 0, 0, 1, 0, 0]
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: Mat, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]
// 벡터(핸들)엔 이동 성분 제외
const applyV = (m: Mat, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y,
  m[1] * x + m[3] * y,
]

function parseTransform(str: string | null): Mat {
  if (!str) return ID
  let m: Mat = ID
  const re = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([^)]*)\)/g
  let match
  while ((match = re.exec(str))) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number)
    const [a = 0, b = 0] = args
    switch (match[1]) {
      case 'translate':
        m = mul(m, [1, 0, 0, 1, a, args.length > 1 ? b : 0])
        break
      case 'scale':
        m = mul(m, [a, 0, 0, args.length > 1 ? b : a, 0, 0])
        break
      case 'rotate': {
        const r = (a * Math.PI) / 180
        const cos = Math.cos(r)
        const sin = Math.sin(r)
        if (args.length > 2) m = mul(m, [1, 0, 0, 1, args[1], args[2]])
        m = mul(m, [cos, sin, -sin, cos, 0, 0])
        if (args.length > 2) m = mul(m, [1, 0, 0, 1, -args[1], -args[2]])
        break
      }
      case 'matrix':
        if (args.length === 6) m = mul(m, args as Mat)
        break
      case 'skewX':
        m = mul(m, [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0])
        break
      case 'skewY':
        m = mul(m, [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0])
        break
    }
  }
  return m
}

function parseColor(str: string | null): [number, number, number, number] | null {
  if (!str || str === 'none' || str === 'transparent') return null
  const s = str.trim()
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    if (h.length >= 6) {
      return [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
        1,
      ]
    }
    return null
  }
  const rgb = s.match(/rgba?\(([^)]*)\)/)
  if (rgb) {
    const p = rgb[1].split(/[\s,]+/).map(Number)
    return [p[0] / 255, p[1] / 255, p[2] / 255, 1]
  }
  const NAMED: Record<string, [number, number, number, number]> = {
    black: [0, 0, 0, 1], white: [1, 1, 1, 1], red: [1, 0, 0, 1],
    green: [0, 0.5, 0, 1], blue: [0, 0, 1, 1], currentcolor: [0.2, 0.23, 0.27, 1],
  }
  return NAMED[s.toLowerCase()] ?? [0.2, 0.23, 0.27, 1]
}

interface Bez {
  v: [number, number][]
  i: [number, number][]
  o: [number, number][]
  c: boolean
}

/** SVG path d → 로티 베지어 서브패스 배열 */
function parsePath(d: string): Bez[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  const out: Bez[] = []
  let cur: Bez | null = null
  let x = 0, y = 0, sx = 0, sy = 0
  let px: number | null = null, py: number | null = null // 이전 제어점 (S/T용)
  let prevCmd = ''
  let idx = 0
  const num = () => Number(tokens[idx++])

  const start = (nx: number, ny: number) => {
    cur = { v: [[nx, ny]], i: [[0, 0]], o: [[0, 0]], c: false }
    out.push(cur)
    x = nx; y = ny; sx = nx; sy = ny
  }
  const lineTo = (nx: number, ny: number) => {
    if (!cur) start(x, y)
    cur!.v.push([nx, ny]); cur!.i.push([0, 0]); cur!.o.push([0, 0])
    x = nx; y = ny
  }
  const cubicTo = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => {
    if (!cur) start(x, y)
    // 나가는 핸들(현재 점 기준 상대), 들어오는 핸들(다음 점 기준 상대)
    cur!.o[cur!.o.length - 1] = [c1x - x, c1y - y]
    cur!.v.push([nx, ny]); cur!.i.push([c2x - nx, c2y - ny]); cur!.o.push([0, 0])
    x = nx; y = ny; px = c2x; py = c2y
  }
  const arcTo = (rx: number, ry: number, rot: number, laf: number, sf: number, nx: number, ny: number) => {
    // SVG 타원 아크 → 큐빅 베지어 (표준 알고리즘)
    if (rx === 0 || ry === 0 || (x === nx && y === ny)) return lineTo(nx, ny)
    const phi = (rot * Math.PI) / 180
    const cosP = Math.cos(phi), sinP = Math.sin(phi)
    const dx = (x - nx) / 2, dy = (y - ny) / 2
    const x1 = cosP * dx + sinP * dy
    const y1 = -sinP * dx + cosP * dy
    let rxs = rx * rx, rys = ry * ry
    const lam = (x1 * x1) / rxs + (y1 * y1) / rys
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); rxs = rx * rx; rys = ry * ry }
    const sign = laf === sf ? -1 : 1
    const co = sign * Math.sqrt(Math.max(0, (rxs * rys - rxs * y1 * y1 - rys * x1 * x1) / (rxs * y1 * y1 + rys * x1 * x1)))
    const cxp = (co * rx * y1) / ry
    const cyp = (-co * ry * x1) / rx
    const cx = cosP * cxp - sinP * cyp + (x + nx) / 2
    const cy = sinP * cxp + cosP * cyp + (y + ny) / 2
    const ang = (ux: number, uy: number, vx: number, vy: number) => {
      const dot = ux * vx + uy * vy
      const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
      let a = Math.acos(Math.min(1, Math.max(-1, dot / len)))
      if (ux * vy - uy * vx < 0) a = -a
      return a
    }
    const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
    let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
    if (!sf && dth > 0) dth -= 2 * Math.PI
    if (sf && dth < 0) dth += 2 * Math.PI
    const segs = Math.ceil(Math.abs(dth) / (Math.PI / 2))
    const delta = dth / segs
    const t = ((4 / 3) * Math.tan(delta / 4))
    let th = th1
    for (let s = 0; s < segs; s++) {
      const cosT = Math.cos(th), sinT = Math.sin(th)
      const th2 = th + delta
      const cosT2 = Math.cos(th2), sinT2 = Math.sin(th2)
      const ep = (a: number, b: number): [number, number] => [
        cosP * rx * a - sinP * ry * b + cx,
        sinP * rx * a + cosP * ry * b + cy,
      ]
      const p1 = ep(cosT, sinT)
      const p2 = ep(cosT2, sinT2)
      const d1: [number, number] = [
        (cosP * -rx * sinT - sinP * ry * cosT) * t,
        (sinP * -rx * sinT + cosP * ry * cosT) * t,
      ]
      const d2: [number, number] = [
        (cosP * -rx * sinT2 - sinP * ry * cosT2) * t,
        (sinP * -rx * sinT2 + cosP * ry * cosT2) * t,
      ]
      cubicTo(p1[0] + d1[0], p1[1] + d1[1], p2[0] - d2[0], p2[1] - d2[1], p2[0], p2[1])
      th = th2
    }
  }

  while (idx < tokens.length) {
    const cmd = tokens[idx++]
    const rel = cmd === cmd.toLowerCase()
    switch (cmd.toUpperCase()) {
      case 'M': {
        let nx = num(), ny = num()
        if (rel) { nx += x; ny += y }
        start(nx, ny)
        // 후속 좌표쌍은 암시적 lineTo
        while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx])) {
          let lx = num(), ly = num()
          if (rel) { lx += x; ly += y }
          lineTo(lx, ly)
        }
        px = py = null
        break
      }
      case 'L':
        do {
          let nx = num(), ny = num()
          if (rel) { nx += x; ny += y }
          lineTo(nx, ny)
        } while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx]))
        px = py = null
        break
      case 'H':
        do { const nx = rel ? x + num() : num(); lineTo(nx, y) } while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx]))
        px = py = null
        break
      case 'V':
        do { const ny = rel ? y + num() : num(); lineTo(x, ny) } while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx]))
        px = py = null
        break
      case 'C':
        do {
          let c1x = num(), c1y = num(), c2x = num(), c2y = num(), nx = num(), ny = num()
          if (rel) { c1x += x; c1y += y; c2x += x; c2y += y; nx += x; ny += y }
          cubicTo(c1x, c1y, c2x, c2y, nx, ny)
        } while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx]))
        break
      case 'S':
        do {
          let c2x = num(), c2y = num(), nx = num(), ny = num()
          if (rel) { c2x += x; c2y += y; nx += x; ny += y }
          const useReflect = /[cs]/i.test(prevCmd)
          const c1x = useReflect && px !== null ? 2 * x - px : x
          const c1y = useReflect && py !== null ? 2 * y - (py as number) : y
          cubicTo(c1x, c1y, c2x, c2y, nx, ny)
          prevCmd = 'S'
        } while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx]))
        break
      case 'Q':
        do {
          let qx = num(), qy = num(), nx = num(), ny = num()
          if (rel) { qx += x; qy += y; nx += x; ny += y }
          // Q → C 승격
          cubicTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny)
          px = qx; py = qy
          prevCmd = 'Q'
        } while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx]))
        break
      case 'T':
        do {
          let nx = num(), ny = num()
          if (rel) { nx += x; ny += y }
          const useReflect = /[qt]/i.test(prevCmd)
          const qx: number = useReflect && px !== null ? 2 * x - px : x
          const qy: number = useReflect && py !== null ? 2 * y - (py as number) : y
          cubicTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny)
          px = qx; py = qy
          prevCmd = 'T'
        } while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx]))
        break
      case 'A':
        do {
          const rx = num(), ry = num(), rot = num(), laf = num(), sf = num()
          let nx = num(), ny = num()
          if (rel) { nx += x; ny += y }
          arcTo(rx, ry, rot, laf, sf, nx, ny)
        } while (idx < tokens.length && !/[a-zA-Z]/.test(tokens[idx]))
        px = py = null
        break
      case 'Z': {
        // 클로저(start) 안에서 할당되므로 TS 내로잉을 우회
        const open = cur as Bez | null
        if (open) { open.c = true; x = sx; y = sy }
        cur = null
        px = py = null
        break
      }
    }
    if (!/[SQT]/i.test(cmd)) prevCmd = cmd
  }
  return out
}

/** SVG 문자열 → 로티 셰이프 그룹 아이템 + bbox */
export function svgToLottie(svgText: string): ImportedGraphic {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = doc.querySelector('svg')
  if (!svg || doc.querySelector('parsererror')) throw new Error('SVG 파싱 실패')

  const items: unknown[] = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  const grow = (pt: [number, number]) => {
    minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0])
    minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1])
  }

  const stv = (k: unknown) => ({ a: 0, k })
  const trItem = () => ({
    ty: 'tr', p: stv([0, 0]), a: stv([0, 0]), s: stv([100, 100]), r: stv(0), o: stv(100),
  })

  const styleOf = (el: Element, name: string): string | null => {
    const attr = el.getAttribute(name)
    if (attr) return attr
    const style = el.getAttribute('style')
    if (style) {
      const m = style.match(new RegExp(`${name}\\s*:\\s*([^;]+)`))
      if (m) return m[1].trim()
    }
    return null
  }

  const emit = (bezs: Bez[], el: Element, m: Mat, inheritFill: string | null, inheritStroke: string | null) => {
    if (!bezs.length) return
    const paths = bezs.map((b) => {
      const v = b.v.map(([px2, py2]) => { const t = apply(m, px2, py2); grow(t); return t })
      const i = b.i.map(([px2, py2]) => applyV(m, px2, py2))
      const o = b.o.map(([px2, py2]) => applyV(m, px2, py2))
      return { ty: 'sh', ks: { a: 0, k: { i, o, v, c: b.c } } }
    })
    const fillStr = styleOf(el, 'fill') ?? inheritFill ?? '#333'
    const strokeStr = styleOf(el, 'stroke') ?? inheritStroke
    const fill = parseColor(fillStr)
    const stroke = parseColor(strokeStr)
    const op = Number(styleOf(el, 'opacity') ?? 1) * Number(styleOf(el, 'fill-opacity') ?? 1)
    const painters: unknown[] = []
    if (stroke) {
      const w = Number(styleOf(el, 'stroke-width') ?? 1)
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
      painters.push({ ty: 'st', c: stv(stroke), o: stv(100), w: stv(w * scale), lc: 2, lj: 2 })
    }
    if (fill) painters.push({ ty: 'fl', c: stv(fill), o: stv(Math.round(op * 100)), r: 1 })
    if (!painters.length) return
    items.push({ ty: 'gr', nm: el.tagName, it: [...paths, ...painters, trItem()] })
  }

  const visit = (el: Element, m: Mat, fill: string | null, stroke: string | null) => {
    const tag = el.tagName.toLowerCase()
    if (['defs', 'clippath', 'mask', 'metadata', 'title', 'desc', 'style'].includes(tag)) return
    const m2 = mul(m, parseTransform(el.getAttribute('transform')))
    const f2 = styleOf(el, 'fill') ?? fill
    const s2 = styleOf(el, 'stroke') ?? stroke
    const n = (name: string, dflt = 0) => Number(el.getAttribute(name) ?? dflt)

    switch (tag) {
      case 'svg':
      case 'g':
        for (const child of Array.from(el.children)) visit(child, m2, f2, s2)
        return
      case 'path': {
        const d = el.getAttribute('d')
        if (d) emit(parsePath(d), el, m2, fill, stroke)
        return
      }
      case 'rect': {
        const x = n('x'), y = n('y'), w = n('width'), h = n('height')
        const r = Math.min(n('rx') || n('ry'), w / 2, h / 2)
        const k = 0.5523 * r
        const bez: Bez = r > 0
          ? {
              v: [[x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r], [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r]],
              i: [[0, 0], [-0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0]],
              o: [[0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k]],
              c: true,
            }
          : { v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], i: [[0,0],[0,0],[0,0],[0,0]], o: [[0,0],[0,0],[0,0],[0,0]], c: true }
        emit([bez], el, m2, fill, stroke)
        return
      }
      case 'circle':
      case 'ellipse': {
        const cx = n('cx'), cy = n('cy')
        const rx = tag === 'circle' ? n('r') : n('rx')
        const ry = tag === 'circle' ? n('r') : n('ry')
        const kx = 0.5523 * rx, ky = 0.5523 * ry
        emit([{
          v: [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
          i: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
          o: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
          c: true,
        }], el, m2, fill, stroke)
        return
      }
      case 'polygon':
      case 'polyline': {
        const pts = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
        const v: [number, number][] = []
        for (let j = 0; j + 1 < pts.length; j += 2) v.push([pts[j], pts[j + 1]])
        if (v.length >= 2) {
          emit([{ v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]), c: tag === 'polygon' }], el, m2, fill, stroke)
        }
        return
      }
      case 'line': {
        emit([{
          v: [[n('x1'), n('y1')], [n('x2'), n('y2')]],
          i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], c: false,
        }], el, m2, fill, stroke)
        return
      }
      case 'text':
        throw new Error('텍스트는 아웃라인(패스)으로 변환해서 내보내주세요.')
      default:
        for (const child of Array.from(el.children)) visit(child, m2, f2, s2)
    }
  }

  visit(svg, ID, null, null)
  if (!items.length || minX === Infinity) throw new Error('변환 가능한 도형이 없습니다 (path/도형 요소 필요).')
  return { items, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, svgText }
}

/**
 * 가져온 그래픽을 슬롯 크기(fit×fit)에 맞춰 중앙 정렬한 단일 그룹으로 감싼다.
 * 슬롯 로컬 원점(0,0)이 중심이라고 가정한다.
 */
export function wrapToFit(graphic: ImportedGraphic, fit: number): unknown {
  const { items, bbox } = graphic
  const scale = (fit / Math.max(bbox.w, bbox.h)) * 100
  const cx = bbox.x + bbox.w / 2
  const cy = bbox.y + bbox.h / 2
  return {
    ty: 'gr',
    nm: 'Custom Graphic',
    it: [
      ...items,
      {
        ty: 'tr',
        p: { a: 0, k: [0, 0] },
        a: { a: 0, k: [cx, cy] }, // 그래픽 중심을 앵커로
        s: { a: 0, k: [scale, scale] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      },
    ],
  }
}
