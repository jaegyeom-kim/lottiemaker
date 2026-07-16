// 커스텀 빌더 — 상용 모션 툴(Jitter/LottieFiles Creator/Canva)의 3슬롯 모델.
// 레이어마다 등장(In) / 루프(Loop) / 퇴장(Out)을 조합하고,
// 각 슬롯이 필요한 채널(위치/스케일/불투명도/회전)에 시간 분리된 키프레임을 쓴다.
import type { LottieJson } from './lottieUtils'
import { wrapToFit, fitImageSize, type ImportedGraphic, type ImportedImage } from './svgImport'

export const CUSTOM_OP = 90 // 1.5s @60fps
export const CUSTOM_ASSET_PREFIX = 'img_custom'

/** 레이어 라벨 컬러 (AE 라벨 개념) — 타임라인 클립·레이어 패널에서 공유. */
// 초록·빨강 계열은 등장/퇴장 세그먼트 전용으로 예약 — 레이어 색과 절대 안 겹치게
export const LAYER_COLORS = [
  '#5B8DEF', '#E5A64B', '#9B6EE8', '#4BC0C8', '#E570A6', '#B0BC4A', '#8894A8', '#C98F5A',
]

/** 레이어의 라벨 컬러 — 생성 시 배정된 xci, 없으면 인덱스 기반. */
export function layerColor(layer: Record<string, unknown>, fallbackIdx: number): string {
  const ci = typeof layer.xci === 'number' ? layer.xci : fallbackIdx
  return LAYER_COLORS[((ci % LAYER_COLORS.length) + LAYER_COLORS.length) % LAYER_COLORS.length]
}

/** hex → rgba 문자열. */
export function tint(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const IN_TYPES = ['없음', '페이드', '아래에서', '위에서', '왼쪽에서', '오른쪽에서', '팝', '드롭']
export const LOOP_TYPES = ['없음', '플로팅', '펄스', '흔들기', '회전', '바운스']
export const OUT_TYPES = ['없음', '페이드', '아래로', '위로', '왼쪽으로', '오른쪽으로', '축소']

export interface AnimIn {
  type: number
  /** 시작 지연 f — 타임라인에서 바를 밀면 변한다. */
  delay: number
  dur: number
  /** 슬라이드/드롭 이동 거리 px. */
  dist: number
  /** 도착 오버슈트. */
  bounce: number
}

export interface AnimLoop {
  type: number
  /** 진폭 — px(플로팅/흔들기/바운스) 또는 %(펄스). 회전은 무시. */
  amount: number
  /** 한 사이클 길이 f. */
  period: number
}

export interface AnimOut {
  type: number
  dur: number
  dist: number
  /** 윈드업 오버슛 — 반대로 살짝 당겼다가 나간다 (축소는 살짝 커졌다가). */
  bounce: number
}

export interface CustomSel {
  /** 변형(정적) — 크기/회전/불투명도/앵커. */
  size: number
  rotation: number
  opacity: number
  anchor: [number, number]
  /** 레이어 클립 구간 [시작 f, 끝 f] — 밖에서는 레이어가 렌더되지 않는다 (ip/op). */
  clip: [number, number]
  /** 애니메이션 3슬롯. */
  in: AnimIn
  loop: AnimLoop
  out: AnimOut
}

export const DEFAULT_SEL: CustomSel = {
  size: 240, rotation: 0, opacity: 100, anchor: [0.5, 0.5],
  clip: [0, CUSTOM_OP],
  in: { type: 0, delay: 0, dur: 24, dist: 80, bounce: 1 },
  loop: { type: 0, amount: 24, period: 60 },
  out: { type: 0, dur: 20, dist: 80, bounce: 1 },
}

/** 부분/구버전 xsel → 완전한 CustomSel. 구버전 in.delay는 클립 시작으로 이관. */
export function normSel(raw: Partial<CustomSel> | undefined, op = CUSTOM_OP): CustomSel {
  const r = raw ?? {}
  const inn = { ...DEFAULT_SEL.in, ...(r.in ?? {}) }
  const clip: [number, number] = Array.isArray(r.clip)
    ? [r.clip[0], r.clip[1]]
    : [Math.max(0, Math.min(op - 8, inn.delay ?? 0)), op]
  return {
    ...DEFAULT_SEL,
    ...r,
    clip,
    in: inn,
    loop: { ...DEFAULT_SEL.loop, ...(r.loop ?? {}) },
    out: { ...DEFAULT_SEL.out, ...(r.out ?? {}) },
  }
}

const ease = (n: number) => ({
  i: { x: Array(n).fill(0.4), y: Array(n).fill(1) },
  o: { x: Array(n).fill(0.6), y: Array(n).fill(0) },
})

type Kf = Record<string, unknown> & { t: number; s: number[] }
const kf = (dims: number, t: number, s: number[]): Kf => ({ ...ease(dims), t: Math.round(t * 10) / 10, s })
const R = (v: number) => Math.round(v * 10) / 10

/** 키프레임 목록 → 프로퍼티. 1개 이하이면 정적으로 축약, 마지막 kf 이징 제거. */
function prop(dims: number, kfs: Kf[], staticVal: number[]): unknown {
  if (kfs.length < 2) {
    return { a: 0, k: dims === 1 ? staticVal[0] : staticVal }
  }
  const k = kfs.map((x, i) => (i < kfs.length - 1 ? x : { t: x.t, s: x.s }))
  return { a: 1, k }
}

/** 등장/퇴장 방향 단위벡터 — type 2~5 = 아래/위/왼쪽/오른쪽. */
const DIR: Record<number, [number, number]> = {
  2: [0, 1], 3: [0, -1], 4: [-1, 0], 5: [1, 0],
}

export interface AnimSpans {
  clipA: number
  clipB: number
  inStart: number
  inEnd: number
  outStart: number
}

/** 슬롯 시간 구간 — 클립 [시작,끝] 안에서 등장은 앞, 퇴장은 뒤에 붙는다. */
export function animSpans(sel: CustomSel, op = CUSTOM_OP): AnimSpans {
  const rawA = sel.clip?.[0] ?? 0
  const rawB = sel.clip?.[1] ?? op
  const clipA = Math.max(0, Math.min(op - 8, rawA))
  const clipB = Math.max(clipA + 8, Math.min(op, rawB))
  const inOn = sel.in.type > 0
  const outOn = sel.out.type > 0
  const outDur = outOn ? Math.max(4, Math.min(clipB - clipA - 4, sel.out.dur)) : 0
  const outStart = clipB - outDur
  const inDur = inOn ? Math.max(4, Math.min(outStart - clipA, sel.in.dur)) : 0
  return { clipA, clipB, inStart: clipA, inEnd: clipA + inDur, outStart }
}

/**
 * 3슬롯 → 채널별 키프레임(ks의 o/r/p/s).
 * 등장 전에는 시작 상태(밖/투명/0스케일) 홀드, 루프는 중간 구간을 정수 사이클로 채우고
 * (첫=마지막 값이라 홀로 있을 땐 심리스), 퇴장은 클립 끝에 고정.
 */
export function buildAnimKs(
  sel: CustomSel,
  base: [number, number],
  op = CUSTOM_OP,
): { o: unknown; r: unknown; p: unknown; s: unknown } {
  const { clipA, clipB, inStart, inEnd, outStart } = animSpans(sel, op)
  const [bx, by] = base
  const P = (dx: number, dy: number): number[] => [R(bx + dx), R(by + dy), 0]
  const maxO = Math.max(0, Math.min(100, sel.opacity))
  const inT = sel.in.type
  const loopT = sel.loop.type
  const outT = sel.out.type
  const dist = Math.max(4, Math.min(600, sel.in.dist))
  const outDist = Math.max(4, Math.min(600, sel.out.dist))

  // ---- 루프 사이클 배치: 중간 구간을 정수 사이클로 나눔
  const midA = inEnd
  const midB = outStart
  const midLen = Math.max(0, midB - midA)
  const period = Math.max(12, Math.min(op, sel.loop.period))
  const nCyc = loopT && midLen >= 12 ? Math.max(1, Math.round(midLen / period)) : 0
  const cyc = nCyc ? midLen / nCyc : 0

  // ---- 위치 채널
  const pk: Kf[] = []
  const dirIn = DIR[inT]
  const dirOut = DIR[outT]
  if (dirIn || inT === 7) {
    const [dx, dy] = inT === 7 ? [0, -1] : dirIn!
    const off = inT === 7 ? Math.max(dist, 120) : dist
    pk.push(kf(3, inStart, P(dx * off, dy * off)))
    if (inT === 7) {
      // 드롭 — 낙하 후 한 번 튀고 정착
      const d = inEnd - inStart
      pk.push(kf(3, inStart + d * 0.55, P(0, 0)))
      pk.push(kf(3, inStart + d * 0.8, P(0, -off * 0.16)))
      pk.push(kf(3, inEnd, P(0, 0)))
    } else if (sel.in.bounce) {
      pk.push(kf(3, inStart + (inEnd - inStart) * 0.72, P(-dx * dist * 0.08, -dy * dist * 0.08)))
      pk.push(kf(3, inEnd, P(0, 0)))
    } else {
      pk.push(kf(3, inEnd, P(0, 0)))
    }
  }
  // 루프 — 플로팅(1)/흔들기(3)/바운스(5)
  if (nCyc && (loopT === 1 || loopT === 3 || loopT === 5)) {
    const amt = Math.max(2, Math.min(300, sel.loop.amount))
    if (!pk.length) {
      if (midA > clipA) pk.push(kf(3, clipA, P(0, 0)))
      pk.push(kf(3, midA, P(0, 0)))
    } else if (pk[pk.length - 1].t < midA) {
      pk.push(kf(3, midA, P(0, 0)))
    }
    for (let i = 0; i < nCyc; i++) {
      const t0 = midA + i * cyc
      if (loopT === 1) {
        // 플로팅 — 상하 부유
        pk.push(kf(3, t0 + cyc * 0.25, P(0, -amt / 2)))
        pk.push(kf(3, t0 + cyc * 0.5, P(0, 0)))
        pk.push(kf(3, t0 + cyc * 0.75, P(0, amt / 2)))
        pk.push(kf(3, t0 + cyc, P(0, 0)))
      } else if (loopT === 3) {
        // 흔들기 — 좌우
        pk.push(kf(3, t0 + cyc * 0.25, P(-amt / 2, 0)))
        pk.push(kf(3, t0 + cyc * 0.75, P(amt / 2, 0)))
        pk.push(kf(3, t0 + cyc, P(0, 0)))
      } else {
        // 바운스 — 위로 튀었다 복귀
        pk.push(kf(3, t0 + cyc * 0.4, P(0, -amt)))
        pk.push(kf(3, t0 + cyc * 0.8, P(0, 0)))
        pk.push(kf(3, t0 + cyc, P(0, 0)))
      }
    }
  }
  if (dirOut) {
    const [dx, dy] = dirOut
    if (!pk.length || pk[pk.length - 1].t < outStart) pk.push(kf(3, outStart, P(0, 0)))
    if (sel.out.bounce) {
      // 윈드업 — 반대 방향으로 8% 당겼다가 발사
      pk.push(kf(3, outStart + (clipB - outStart) * 0.3, P(-dx * outDist * 0.08, -dy * outDist * 0.08)))
    }
    pk.push(kf(3, clipB, P(dx * outDist, dy * outDist)))
  } else if (pk.length && pk[pk.length - 1].t < clipB) {
    pk.push(kf(3, clipB, [...pk[pk.length - 1].s])) // 배열 복사 — 참조 공유 시 시프트가 두 번 적용됨
  }

  // ---- 스케일 채널 (팝 등장 / 펄스 루프 / 축소 퇴장)
  const sk: Kf[] = []
  const S = (v: number): number[] => [R(v), R(v), 100]
  if (inT === 6) {
    sk.push(kf(3, inStart, S(0)))
    if (sel.in.bounce) sk.push(kf(3, inStart + (inEnd - inStart) * 0.7, S(112)))
    sk.push(kf(3, inEnd, S(100)))
  }
  if (nCyc && loopT === 2) {
    const amt = Math.max(1, Math.min(100, sel.loop.amount))
    if (!sk.length) {
      if (midA > clipA) sk.push(kf(3, clipA, S(100)))
      sk.push(kf(3, midA, S(100)))
    } else if (sk[sk.length - 1].t < midA) {
      sk.push(kf(3, midA, S(100)))
    }
    for (let i = 0; i < nCyc; i++) {
      const t0 = midA + i * cyc
      sk.push(kf(3, t0 + cyc * 0.5, S(100 + amt)))
      sk.push(kf(3, t0 + cyc, S(100)))
    }
  }
  if (outT === 6) {
    if (!sk.length || sk[sk.length - 1].t < outStart) sk.push(kf(3, outStart, S(100)))
    if (sel.out.bounce) sk.push(kf(3, outStart + (clipB - outStart) * 0.3, S(112)))
    sk.push(kf(3, clipB, S(0)))
  } else if (sk.length && sk[sk.length - 1].t < clipB) {
    sk.push(kf(3, clipB, [...sk[sk.length - 1].s]))
  }

  // ---- 불투명도 채널 (모든 등장/퇴장은 페이드 동반 — 상용 툴 관례)
  const ok: Kf[] = []
  if (inT > 0) {
    ok.push(kf(1, inStart, [0]))
    ok.push(kf(1, inStart + (inEnd - inStart) * 0.8, [maxO]))
  }
  if (outT > 0) {
    if (!ok.length || ok[ok.length - 1].t < outStart) ok.push(kf(1, outStart, [maxO]))
    ok.push(kf(1, clipB, [0]))
  } else if (ok.length && ok[ok.length - 1].t < clipB) {
    ok.push(kf(1, clipB, [maxO]))
  }

  // ---- 회전 채널 (정적 각도 + 회전 루프는 등속 램프, 사이클당 360°)
  const rot = sel.rotation
  let r: unknown = { a: 0, k: rot }
  if (nCyc && loopT === 4) {
    const lin = { i: { x: [0.833], y: [0.833] }, o: { x: [0.167], y: [0.167] } }
    const rk: Record<string, unknown>[] = []
    if (midA > clipA) rk.push({ ...ease(1), t: clipA, s: [rot] }, { ...lin, t: midA, s: [rot] })
    else rk.push({ ...lin, t: midA, s: [rot] })
    if (midB < clipB) {
      rk.push({ ...ease(1), t: midB, s: [rot + 360 * nCyc] })
      rk.push({ t: clipB, s: [rot + 360 * nCyc] })
    } else {
      rk.push({ t: midB, s: [rot + 360 * nCyc] })
    }
    r = { a: 1, k: rk }
  }

  return {
    o: prop(1, ok, [maxO]),
    r,
    p: prop(3, pk, [bx, by, 0]),
    s: prop(3, sk, [100, 100, 100]),
  }
}

/** 레이어 i의 반폭/반높이 — 이미지는 에셋 크기, SVG는 bbox×스케일. */
export function layerHalfOf(doc: LottieJson, i: number): [number, number] {
  const layer = doc.layers[i] as Record<string, unknown> | undefined
  if (!layer) return [60, 60]
  const asset = (doc.assets as Record<string, unknown>[] | undefined)?.find(
    (a) => a.id === layer.refId,
  )
  if (asset) return [(asset.w as number) / 2, (asset.h as number) / 2]
  const g = (layer.shapes as Record<string, unknown>[] | undefined)?.[0]
  if (g && typeof g.bboxW === 'number' && typeof g.bboxH === 'number') {
    const tr = (g.it as Record<string, unknown>[]).find((it) => it.ty === 'tr')
    const sc = ((tr?.s as { k: number[] })?.k[0] ?? 100) / 100
    return [((g.bboxW as number) * sc) / 2, ((g.bboxH as number) * sc) / 2]
  }
  return [60, 60]
}

/** 앵커 오프셋 — 시각적 중심 = 기준위치(xbase) + 이 값. (회전은 근사 무시) */
export function layerCenterOffsetOf(doc: LottieJson, i: number): [number, number] {
  const layer = doc.layers[i] as Record<string, unknown> | undefined
  if (!layer) return [0, 0]
  const a = (((layer.ks as Record<string, unknown>)?.a as { k?: number[] })?.k as number[]) ?? [0, 0]
  const asset = (doc.assets as Record<string, unknown>[] | undefined)?.find(
    (x) => x.id === layer.refId,
  )
  if (asset) return [(asset.w as number) / 2 - a[0], (asset.h as number) / 2 - a[1]]
  return [-a[0], -a[1]]
}

export type CustomPayload =
  | { kind: 'image'; image: ImportedImage }
  | { kind: 'svg'; graphic: ImportedGraphic }

/**
 * 그래픽 하나 → 레이어(+ 이미지 에셋). xsel = 슬롯/변형 상태, xbase = 기준(정착) 위치
 * (로티 재생기는 무시하는 확장 필드 — undo/내보내기에도 따라다닌다).
 */
export function buildCustomLayer(
  payload: CustomPayload,
  sel: CustomSel,
  base: [number, number],
  nm: string,
  assetId: string,
  op = CUSTOM_OP,
): { layer: Record<string, unknown>; asset?: Record<string, unknown> } {
  const anim = buildAnimKs(sel, base, op)
  const ks = { ...anim, a: { a: 0, k: [0, 0, 0] } }
  const { clipA, clipB } = animSpans(sel, op)
  const common = {
    ddd: 0, sr: 1, ao: 0, ip: clipA, op: clipB, st: 0, bm: 0, nm,
    xsel: structuredClone(sel), xbase: [...base],
  }
  const [afx, afy] = sel.anchor ?? [0.5, 0.5]
  if (payload.kind === 'image') {
    const { w, h } = fitImageSize(payload.image, sel.size)
    // nw/nh = 원본 픽셀 — 크기 조절 시 재계산 기준
    const asset = {
      id: assetId, w, h, u: '', p: payload.image.dataUri, e: 1,
      nw: payload.image.w, nh: payload.image.h,
    }
    return {
      layer: {
        ...common, ty: 2, ind: 1, refId: assetId,
        ks: { ...ks, a: { a: 0, k: [w * afx, h * afy, 0] } },
      },
      asset,
    }
  }
  const group = wrapToFit(payload.graphic, sel.size) as Record<string, unknown>
  // bboxMax = 원본 최장 변(크기 재계산 기준), bboxW/H = 스냅용 원본 비율
  group.bboxMax = Math.max(payload.graphic.bbox.w, payload.graphic.bbox.h)
  group.bboxW = payload.graphic.bbox.w
  group.bboxH = payload.graphic.bbox.h
  const sc = sel.size / Math.max(payload.graphic.bbox.w, payload.graphic.bbox.h)
  const gw = payload.graphic.bbox.w * sc
  const gh = payload.graphic.bbox.h * sc
  return {
    layer: {
      ...common, ty: 4, ind: 1,
      ks: { ...ks, a: { a: 0, k: [(afx - 0.5) * gw, (afy - 0.5) * gh, 0] } },
      shapes: [group],
      // 업로드 원문 SVG 내장 — 프로젝트 파일이 자립적이 되도록 (재생기는 무시)
      ...(payload.graphic.svgText ? { xsrc: payload.graphic.svgText } : {}),
    },
  }
}

/** 첫 그래픽 → 512×512 로티 문서. */
export function buildCustomDoc(
  payload: CustomPayload,
  sel: CustomSel,
  base: [number, number],
  nm: string,
): LottieJson {
  const { layer, asset } = buildCustomLayer(payload, sel, base, nm, `${CUSTOM_ASSET_PREFIX}_0`)
  return {
    v: '5.7.4', fr: 60, ip: 0, op: CUSTOM_OP, w: 512, h: 512, nm: 'Custom', ddd: 0,
    assets: asset ? [asset] : [], layers: [layer as never],
  } as unknown as LottieJson
}
