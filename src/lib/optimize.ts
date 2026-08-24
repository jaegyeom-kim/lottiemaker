// 내보내기 최적화 — 소수점 라운딩(3dp) + 미사용 에셋 제거 + 에디터 전용 키 정리.
// 시각 결과는 동일하게 유지 (3dp = 1/255 색 정밀도보다 촘촘).
import type { LottieJson } from './lottieUtils'

/** 레이어에 실리는 에디터 전용 키 — 로티 플레이어는 무시하지만 파일만 불린다. */
const EDITOR_LAYER_KEYS = [
  'xsel', 'xkf', 'xbase', 'xci', 'xlock', 'xsolo', 'xtloff', 'xshape', 'xpk', 'xgk', 'xblank',
]

function roundDeep(node: unknown): unknown {
  if (typeof node === 'number') {
    return Number.isInteger(node) ? node : Math.round(node * 1000) / 1000
  }
  if (Array.isArray(node)) return node.map(roundDeep)
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    for (const k of Object.keys(o)) o[k] = roundDeep(o[k])
    return o
  }
  return node
}

/** 문서 최적화 — 새 문서 반환 (원본 불변). */
export function optimizeLottie(doc: LottieJson): LottieJson {
  const out = structuredClone(doc) as unknown as Record<string, unknown>

  // 1) 에디터 전용 키 제거 (메인 + 씬 에셋 레이어)
  const stripLayers = (layers: unknown) => {
    if (!Array.isArray(layers)) return
    for (const l of layers as Record<string, unknown>[]) {
      for (const k of EDITOR_LAYER_KEYS) delete l[k]
    }
  }
  stripLayers(out.layers)
  const assets = Array.isArray(out.assets) ? (out.assets as Record<string, unknown>[]) : []
  for (const a of assets) stripLayers(a.layers)
  delete out.xblank
  delete out.xguides

  // 2) 미사용 에셋 제거 — 레이어(메인·에셋 내부)가 참조하는 refId만 유지
  const used = new Set<string>()
  const collect = (layers: unknown) => {
    if (!Array.isArray(layers)) return
    for (const l of layers as Record<string, unknown>[]) {
      if (typeof l.refId === 'string') used.add(l.refId)
    }
  }
  collect(out.layers)
  // 에셋 안의 레이어가 다른 에셋을 참조할 수 있어 고정점까지 반복
  let grew = true
  while (grew) {
    grew = false
    for (const a of assets) {
      if (typeof a.id === 'string' && used.has(a.id)) {
        const before = used.size
        collect(a.layers)
        if (used.size > before) grew = true
      }
    }
  }
  out.assets = assets.filter((a) => typeof a.id !== 'string' || used.has(a.id))

  // 3) 소수점 3자리 라운딩
  return roundDeep(out) as unknown as LottieJson
}
