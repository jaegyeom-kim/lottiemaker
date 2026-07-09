// Lottie JSON 색상 추출/치환 유틸리티.
// 지원 대상: "fl"(fill), "st"(stroke) 셰이프의 정적 색상과 키프레임 색상.

export interface ColorRef {
  /** JSON 루트로부터의 경로. 마지막 요소가 색상 배열을 가리킨다. */
  path: (string | number)[]
}

export interface ColorGroup {
  hex: string
  refs: ColorRef[]
}

function toHex(n: number): string {
  const v = Math.round(Math.max(0, Math.min(1, n)) * 255)
  return v.toString(16).padStart(2, '0')
}

export function rgbArrayToHex(arr: number[]): string {
  return `#${toHex(arr[0])}${toHex(arr[1])}${toHex(arr[2])}`
}

export function hexToRgbArray(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
}

function isColorArray(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    (v.length === 3 || v.length === 4) &&
    v.every((n) => typeof n === 'number' && n >= 0 && n <= 1)
  )
}

/**
 * 애니메이션 데이터를 순회하며 fill/stroke 색상 위치를 모두 수집한다.
 * 정적 색상: shape.c.k = [r,g,b,a]
 * 키프레임 색상: shape.c.k = [{s:[r,g,b,a], ...}, ...]
 */
export function extractColorGroups(data: unknown): ColorGroup[] {
  const groups = new Map<string, ColorRef[]>()

  const visit = (node: unknown, path: (string | number)[]) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, [...path, i]))
      return
    }
    if (node === null || typeof node !== 'object') return
    const obj = node as Record<string, unknown>

    if ((obj.ty === 'fl' || obj.ty === 'st') && obj.c && typeof obj.c === 'object') {
      const c = obj.c as Record<string, unknown>
      // a 플래그 대신 k의 형태로 정적/키프레임 구분 — a 누락 파일도 처리.
      // 키프레임은 s(시작)와 레거시 e(끝) 배열 모두 수집해야 재색상이 완전히 적용된다.
      if (isColorArray(c.k)) {
        addRef(groups, rgbArrayToHex(c.k), [...path, 'c', 'k'])
      } else if (Array.isArray(c.k)) {
        c.k.forEach((kf, i) => {
          if (kf === null || typeof kf !== 'object') return
          const kfo = kf as Record<string, unknown>
          if (isColorArray(kfo.s)) {
            addRef(groups, rgbArrayToHex(kfo.s), [...path, 'c', 'k', i, 's'])
          }
          if (isColorArray(kfo.e)) {
            addRef(groups, rgbArrayToHex(kfo.e), [...path, 'c', 'k', i, 'e'])
          }
        })
      }
    }

    for (const key of Object.keys(obj)) visit(obj[key], [...path, key])
  }

  visit(data, [])
  return [...groups.entries()].map(([hex, refs]) => ({ hex, refs }))
}

function addRef(groups: Map<string, ColorRef[]>, hex: string, path: (string | number)[]) {
  const list = groups.get(hex) ?? []
  list.push({ path })
  groups.set(hex, list)
}

/** refs가 가리키는 모든 색상 배열의 RGB를 교체한 새 데이터를 반환한다(알파 유지). */
export function replaceColor(data: unknown, refs: ColorRef[], hex: string): unknown {
  const clone = structuredClone(data)
  const [r, g, b] = hexToRgbArray(hex)
  for (const ref of refs) {
    let node: unknown = clone
    for (let i = 0; i < ref.path.length - 1; i++) {
      node = (node as Record<string | number, unknown>)[ref.path[i]]
      if (node === undefined) break
    }
    if (node === undefined || node === null) continue
    const last = ref.path[ref.path.length - 1]
    const arr = (node as Record<string | number, unknown>)[last]
    if (isColorArray(arr)) {
      arr[0] = r
      arr[1] = g
      arr[2] = b
    }
  }
  return clone
}
