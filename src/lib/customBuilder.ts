// 커스텀 빌더 — 상용 모션 툴(Jitter/LottieFiles Creator/Canva)의 3슬롯 모델.
// 레이어마다 등장(In) / 루프(Loop) / 퇴장(Out)을 조합하고,
// 각 슬롯이 필요한 채널(위치/스케일/불투명도/회전)에 시간 분리된 키프레임을 쓴다.
import type { LottieJson } from './lottieUtils'
import { wrapToFit, fitImageSize, type ImportedGraphic, type ImportedImage } from './svgImport'
import { growCubicBbox } from './drawTools'
import { mul, apply, type Mat } from './svgImport'

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
  /** 정적 균등 스케일 % — 키프레임 모드에서 s 채널 키가 없을 때의 값. */
  scale: number
  anchor: [number, number]
  /** 레이어 클립 구간 [시작 f, 끝 f] — 밖에서는 레이어가 렌더되지 않는다 (ip/op). */
  clip: [number, number]
  /** 애니메이션 3슬롯. */
  in: AnimIn
  loop: AnimLoop
  out: AnimOut
}

export const DEFAULT_SEL: CustomSel = {
  size: 240, rotation: 0, opacity: 100, scale: 100, anchor: [0.5, 0.5],
  clip: [0, CUSTOM_OP],
  in: { type: 0, delay: 0, dur: 24, dist: 80, bounce: 1 },
  loop: { type: 0, amount: 24, period: 60 },
  out: { type: 0, dur: 20, dist: 80, bounce: 1 },
}

/** 부분/구버전 xsel → 완전한 CustomSel. 구버전 in.delay는 클립 시작으로 이관. */
export function normSel(raw: Partial<CustomSel> | undefined, op = CUSTOM_OP): CustomSel {
  const r = raw ?? {}
  const inn = { ...DEFAULT_SEL.in, ...(r.in ?? {}) }
  // 명시된 클립도 [0, op]로 클램프 — 범위 밖 클립이 xsel에 영구 저장되지 않게
  const clip: [number, number] = Array.isArray(r.clip)
    ? [Math.max(0, Math.min(op, r.clip[0])), Math.max(0, Math.min(op, r.clip[1]))]
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
  // 정착 스케일(xsel.scale) — 프리셋 등장/루프/퇴장 스케일 애니메이션에 곱해진다
  const sc = (sel.scale ?? 100) / 100
  const S = (v: number): number[] => [R(v * sc), R(v * sc), 100]
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
    s: prop(3, sk, S(100)),
  }
}

// ── 키프레임 모드 (AE 사용자용) ─────────────────────────────
// 프리셋(3슬롯) 대신 레이어에 직접 키를 찍는다. 키 하나 = 시각 t에 채널 값 부분집합.
// 로티 재생기는 xkf를 무시 — ks 채널은 편집 때마다 여기서 재생성된다.

/** cubic-bezier(x1, y1, x2, y2) — CSS/Figma와 같은 표기. */
export type Bezier4 = [number, number, number, number]

export const EASE_PRESETS: { label: string; bez: Bezier4 }[] = [
  { label: '선형', bez: [0, 0, 1, 1] },
  { label: '이지', bez: [0.42, 0, 0.58, 1] },
  { label: '천천히 시작', bez: [0.42, 0, 1, 1] },
  { label: '천천히 끝', bez: [0, 0, 0.58, 1] },
]

/** 레이어 기본 이징 칩 라벨 — 프리셋에서 파생 (인덱스가 xkf.ease와 일치해야 함). */
export const KF_EASES = EASE_PRESETS.map((p) => p.label)

// ── 스프링 이징 (Lottie Creator 2.0 Spring Curve 벤치) ──────
// 스프링은 단일 베지어로 표현 불가 — 구간을 감쇠 진동 샘플 키로 굽는다.
export const SPRING_PRESETS: { label: string; zeta: number; cycles: number }[] = [
  { label: '바운시', zeta: 0.26, cycles: 3 },
  { label: '스내피', zeta: 0.55, cycles: 1.5 },
  { label: '엘라스틱', zeta: 0.15, cycles: 4 },
]

/** 정규화 스프링 곡선 — u∈[0,1] → 0→1 진행값 (오버슛 포함, u=1에서 정착). */
export function springValue(u: number, zeta: number, cycles: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  const w = cycles * Math.PI * 2
  const wd = w * Math.sqrt(Math.max(0.0001, 1 - zeta * zeta))
  const decay = Math.exp(-zeta * w * u)
  return 1 - decay * (Math.cos(wd * u) + ((zeta * w) / wd) * Math.sin(wd * u))
}

/** 정규화 낙하 바운스 곡선 — u∈[0,1] → 0→1 (easeOutBounce, 물리 낙하+튕김 근사). */
export function bounceValue(u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  const n1 = 7.5625
  const d1 = 2.75
  let x = u
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}

/** 레이어 기본 이징 인덱스(KF_EASES) → 베지어. */
export function easeIndexBez(i: number): Bezier4 {
  return (EASE_PRESETS[i] ?? EASE_PRESETS[1]).bez
}

/** 그라디언트 스냅샷 — gk 채널 키 값 (gf.g.k 평탄 배열 + s/e 끝점). */
export interface GradSnap {
  /** 색 스톱 수 (gf.g.p). */
  p: number
  /** [t,r,g,b]×p (+ 알파쌍 [t,o]×p). */
  k: number[]
  s: [number, number]
  e: [number, number]
}

/** 패스 지오메트리 (로티 sh.ks.k 형태) — pk 채널 키 값. */
export interface PathShapeK {
  v: [number, number][]
  i: [number, number][]
  o: [number, number][]
  c: boolean
}

export interface KfKey {
  t: number
  /** 위치 (절대 캔버스 px). */
  p?: [number, number]
  /** 크기 % (100 = 현재 그래픽 크기). */
  s?: number
  /** 회전 °. */
  r?: number
  /** 불투명도 0~100. */
  o?: number
  /** 트림 패스 시작 0~100 (%). */
  ts?: number
  /** 트림 패스 끝 0~100 (%). */
  te?: number
  /** 패스 모핑 키 — 레이어 로컬 패스 지오메트리 (단일 sh 레이어 전용). */
  pk?: PathShapeK
  /** 그라디언트 키 — gf 스냅샷 (색+알파 스톱 평탄 배열 + 끝점). */
  gk?: GradSnap
  /** 위치 키의 공간 탄젠트 (모션 패스) — 나가는 핸들 오프셋 (키 기준 상대). */
  pto?: [number, number]
  /** 위치 키의 공간 탄젠트 — 들어오는 핸들 오프셋 (키 기준 상대, 이전 키 쪽). */
  pti?: [number, number]
  /** 이 키에서 시작하는 구간의 채널별 이징 오버라이드 — 없으면 레이어 기본. */
  e?: Partial<Record<KfChannel, Bezier4>>
}

/** 키 k에서 시작하는 ch 구간의 이징 — 오버라이드 → 레이어 기본 순. */
export function segEaseOf(xkf: CustomKf, k: KfKey, ch: KfChannel): Bezier4 {
  const o = k.e?.[ch]
  if (Array.isArray(o) && o.length === 4 && o.every((n) => typeof n === 'number')) return o
  return easeIndexBez(xkf.ease)
}

export interface CustomKf {
  on: boolean
  /** KF_EASES 인덱스 — 레이어 전체 세그먼트에 적용. */
  ease: number
  /** 위치 모션 패스를 곡선(Catmull-Rom 스무스)으로 보간할지 — 기본 직선. */
  smooth?: boolean
  keys: KfKey[]
}

/** 부분/없음 → 완전한 CustomKf. 키는 t 오름차순 정렬, 이징 오버라이드는 유효한 것만. */
export function normKf(raw: Partial<CustomKf> | undefined): CustomKf {
  const r = raw ?? {}
  const keys = (Array.isArray(r.keys) ? r.keys : [])
    .filter((k) => typeof k?.t === 'number')
    .map((k) => {
      const e: KfKey['e'] = {}
      for (const ch of ['p', 's', 'r', 'o', 'ts', 'te', 'pk', 'gk'] as const) {
        const b = k.e?.[ch]
        if (Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number'))
          e[ch] = [b[0], b[1], b[2], b[3]]
      }
      const { e: _drop, ...rest } = k
      void _drop
      return { ...rest, t: Math.round(k.t * 10) / 10, ...(Object.keys(e).length ? { e } : {}) }
    })
    .sort((a, b) => a.t - b.t)
  // 같은 t(±0.5f)에 쪼개진 키 병합 — 채널별 별도 키를 만드는 구버전 임포트 정규화.
  // 채널 값·이징 모두 앞선 키 우선으로 합친다.
  const merged: typeof keys = []
  for (const k of keys) {
    const dup = merged.find((m) => Math.abs(m.t - k.t) < 0.5)
    if (!dup) {
      merged.push(k)
      continue
    }
    for (const ch of ['p', 's', 'r', 'o', 'ts', 'te', 'pk', 'gk'] as const)
      if (dup[ch] === undefined && k[ch] !== undefined) (dup[ch] as unknown) = k[ch]
    if (k.e) dup.e = { ...k.e, ...(dup.e ?? {}) }
  }
  return { on: !!r.on, ease: typeof r.ease === 'number' ? r.ease : 1, smooth: !!r.smooth, keys: merged }
}

/** 곡선 경로용 키 j의 Catmull-Rom 접선 (이웃 클램프 — 끝점은 단방향/2). */
function crTangent(pts: [number, number][], j: number): [number, number] {
  const p0 = pts[Math.max(0, j - 1)]
  const p2 = pts[Math.min(pts.length - 1, j + 1)]
  return [(p2[0] - p0[0]) / 2, (p2[1] - p0[1]) / 2]
}

/** 스프링 대상 채널 — 위치/크기/회전. */
export const SPRING_CHS = ['p', 's', 'r'] as const

/**
 * 감쇠 스프링을 키프레임으로 베이크 — springs에 담긴 도착 키마다, 같은 채널의
 * 직전 키와의 구간에 감쇠 조화진동(닫힌형) 극값 키를 삽입한다. 키는 최대 4개,
 * 진폭이 이동량의 2% 아래로 떨어지면 중단 — 그래프 에디터에서 후편집 가능한
 * 최소 키 수를 유지한다.
 */
export function bakeSprings(
  keys: KfKey[],
  springs: Map<KfKey, { z: number; chs?: readonly KfChannel[] }>,
): KfKey[] {
  if (!springs.size) return keys
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const extras: KfKey[] = []
  for (const [k, sp] of springs) {
    const idx = sorted.indexOf(k)
    if (idx <= 0) continue
    // 반주기당 진폭비 — 감쇠 조화진동 닫힌형
    const ratio = Math.exp((-sp.z * Math.PI) / Math.sqrt(1 - sp.z * sp.z))
    for (const ch of sp.chs ?? SPRING_CHS) {
      const b = k[ch]
      if (b === undefined) continue
      // 같은 채널을 가진 직전 키 — 채널이 성긴 수동 키 배열에서도 동작
      let prev: KfKey | undefined
      for (let i = idx - 1; i >= 0; i--)
        if (sorted[i][ch] !== undefined) {
          prev = sorted[i]
          break
        }
      if (!prev || k.t - prev.t < 4) continue
      const a = prev[ch] as number | [number, number]
      const L = k.t - prev.t
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
      // 첫 피크로 가속 진입 — 기존 이징이 있으면 존중
      prev.e = { ...(prev.e ?? {}), [ch]: prev.e?.[ch] ?? ([0.33, 0, 0.35, 1] as Bezier4) }
      for (let j = 1; j <= n; j++) {
        const tt = Math.min(Math.round((prev.t + 0.55 * L + (j - 1) * h) * 10) / 10, k.t - 0.5)
        const amp = Math.pow(ratio, j) * (j % 2 ? 1 : -1)
        const kk: KfKey = { t: tt, e: { [ch]: [0.37, 0, 0.63, 1] as Bezier4 } }
        if (ch === 'p')
          kk.p = [(b as [number, number])[0] + d[0] * amp, (b as [number, number])[1] + d[1] * amp]
        else if (ch === 's' || ch === 'r') kk[ch] = (b as number) + d[0] * amp
        extras.push(kk)
      }
    }
  }
  if (!extras.length) return sorted
  // 같은 시각(±0.5f) 키는 채널 병합 — 기존 키 우선
  const out = [...sorted]
  for (const kk of extras) {
    const dup = out.find((m) => Math.abs(m.t - kk.t) < 0.5)
    if (dup) {
      for (const ch of SPRING_CHS) if (dup[ch] === undefined && kk[ch] !== undefined) (dup[ch] as unknown) = kk[ch]
      dup.e = { ...(kk.e ?? {}), ...(dup.e ?? {}) }
    } else out.push(kk)
  }
  return out.sort((a, b) => a.t - b.t)
}

/** 위치 구간 i의 공간 접선 — 수동(pto/pti) 우선, smooth는 Catmull-Rom 폴백. */
export function segTangents(
  keys: KfKey[],
  i: number,
  smooth: boolean | undefined,
): { to: [number, number] | null; ti: [number, number] | null } {
  let to = keys[i].pto ?? null
  let ti = keys[i + 1].pti ?? null
  if (smooth) {
    const pts = keys.map((k) => k.p as [number, number])
    if (!to) {
      const m = crTangent(pts, i)
      to = [m[0] / 3, m[1] / 3]
    }
    if (!ti) {
      const m = crTangent(pts, i + 1)
      ti = [-m[0] / 3, -m[1] / 3]
    }
  }
  return { to, ti }
}

export type KfChannel = 'p' | 's' | 'r' | 'o' | 'ts' | 'te' | 'pk' | 'gk'

/** 타임라인 키 선택 항목 — 레이어 인덱스 + 채널 + 시각. */
export interface KfSelItem {
  li: number
  ch: KfChannel
  t: number
}

/** 채널 표시 정의 — 타임라인 프로퍼티 행·패널·단축키가 공유. */
export const KF_CHANNEL_DEFS: { ch: KfChannel; label: string; unit: string }[] = [
  { ch: 'p', label: '위치', unit: 'px' },
  { ch: 's', label: '크기', unit: '%' },
  { ch: 'r', label: '회전', unit: '°' },
  { ch: 'o', label: '불투명도', unit: '%' },
  { ch: 'ts', label: '트림 시작', unit: '%' },
  { ch: 'te', label: '트림 끝', unit: '%' },
  { ch: 'pk', label: '패스', unit: '' },
  { ch: 'gk', label: '그라디언트', unit: '' },
]

/** 채널의 키 없는 구간 기본값 — ◆ 캡처/단축키/패널이 공유. */
export function kfFallbackValue(
  ch: KfChannel,
  xsel: CustomSel,
  base: [number, number],
): number | [number, number] {
  if (ch === 'p') return base
  if (ch === 's') return xsel.scale ?? 100
  if (ch === 'r') return xsel.rotation
  if (ch === 'ts') return 0
  if (ch === 'te') return 100
  if (ch === 'pk' || ch === 'gk') return 0 // 수치 채널 아님 — 값 패널에서 제외됨
  return xsel.opacity
}

/** 채널에 값이 있는 키만 t순으로. */
export function kfChannelKeys(xkf: CustomKf, ch: KfChannel): KfKey[] {
  return xkf.keys.filter((k) => k[ch] !== undefined)
}

/** 채널의 t 시점 보간값 — 키 없으면 fallback (캔버스 박스/값 캡처용, 선형 근사). */
export function kfValueAt(
  xkf: CustomKf,
  ch: KfChannel,
  t: number,
  fallback: number | [number, number],
): number | [number, number] {
  const keys = kfChannelKeys(xkf, ch)
  if (!keys.length || ch === 'pk' || ch === 'gk') return fallback // pathKAt/gradKAt으로
  const val = (k: KfKey) => k[ch] as number | [number, number]
  if (t <= keys[0].t) return val(keys[0])
  if (t >= keys[keys.length - 1].t) return val(keys[keys.length - 1])
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
      const va = val(a)
      const vb = val(b)
      if (Array.isArray(va) && Array.isArray(vb)) {
        // 곡선 경로면 렌더와 같은 공간 베지어로 (박스/모션패스 오버레이 일치)
        // — 키의 수동 탄젠트(pto/pti) 우선, smooth는 Catmull-Rom 폴백
        if (ch === 'p') {
          const { to, ti } = segTangents(keys, i, xkf.smooth)
          if (to || ti) {
            const c1: [number, number] = [va[0] + (to?.[0] ?? 0), va[1] + (to?.[1] ?? 0)]
            const c2: [number, number] = [vb[0] + (ti?.[0] ?? 0), vb[1] + (ti?.[1] ?? 0)]
            const u = 1 - f
            return [
              u * u * u * va[0] + 3 * u * u * f * c1[0] + 3 * u * f * f * c2[0] + f * f * f * vb[0],
              u * u * u * va[1] + 3 * u * u * f * c1[1] + 3 * u * f * f * c2[1] + f * f * f * vb[1],
            ]
          }
        }
        return [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f]
      }
      return (va as number) + ((vb as number) - (va as number)) * f
    }
  }
  return fallback
}

/**
 * 키프레임 모드 → ks 채널. 채널마다 키가 있으면 그 값으로, 없으면 정적
 * (위치 = xbase, 크기 = 100%, 회전/불투명도 = xsel의 변형 값).
 * 이징은 구간(키→다음 키)마다 — 키의 e 오버라이드, 없으면 레이어 기본.
 */
export function buildKfKs(
  xkf: CustomKf,
  sel: CustomSel,
  base: [number, number],
): { o: unknown; r: unknown; p: unknown; s: unknown } {
  const maxO = Math.max(0, Math.min(100, sel.opacity))
  const mk = (ch: KfChannel, dims: number, toArr: (v: never) => number[], staticVal: number[]) => {
    const keys = kfChannelKeys(xkf, ch)
    if (keys.length < 2) {
      // 키 1개 = 그 값으로 정적 (AE와 동일)
      const v = keys.length ? toArr(keys[0][ch] as never) : staticVal
      return { a: 0, k: dims === 1 ? v[0] : v }
    }
    const k: Record<string, unknown>[] = keys.map((x, i) => {
      if (i === keys.length - 1) return { t: x.t, s: toArr(x[ch] as never) }
      const [x1, y1, x2, y2] = segEaseOf(xkf, x, ch)
      return {
        o: { x: Array(dims).fill(x1), y: Array(dims).fill(y1) },
        i: { x: Array(dims).fill(x2), y: Array(dims).fill(y2) },
        t: x.t,
        s: toArr(x[ch] as never),
      }
    })
    // 곡선 모션 패스 — 공간 접선(to/ti): 키의 수동 탄젠트(pto/pti) 우선,
    // smooth 모드는 Catmull-Rom 자동값으로 폴백
    if (ch === 'p' && keys.length >= 2) {
      for (let i = 0; i < keys.length - 1; i++) {
        const { to, ti } = segTangents(keys, i, xkf.smooth)
        if (to) k[i].to = [R(to[0]), R(to[1]), 0]
        if (ti) k[i].ti = [R(ti[0]), R(ti[1]), 0]
      }
    }
    return { a: 1, k }
  }
  const st = sel.scale ?? 100
  return {
    p: mk('p', 3, (v: [number, number]) => [R(v[0]), R(v[1]), 0], [base[0], base[1], 0]),
    s: mk('s', 3, (v: number) => [R(v), R(v), 100], [R(st), R(st), 100]),
    r: mk('r', 1, (v: number) => [R(v)], [sel.rotation ?? 0]),
    o: mk('o', 1, (v: number) => [Math.max(0, Math.min(100, v))], [maxO]),
  }
}

/** 스칼라 채널 → 로티 프로퍼티 (구간 이징 포함) — 트림 패스 등 ks 밖 채널용. */
export function buildKfScalarProp(
  xkf: CustomKf,
  ch: KfChannel,
): { a: number; k: unknown } | null {
  const keys = kfChannelKeys(xkf, ch)
  if (!keys.length) return null
  if (keys.length < 2) return { a: 0, k: R(keys[0][ch] as number) }
  return {
    a: 1,
    k: keys.map((x, i) => {
      if (i === keys.length - 1) return { t: x.t, s: [R(x[ch] as number)] }
      const [x1, y1, x2, y2] = segEaseOf(xkf, x, ch)
      return {
        o: { x: [x1], y: [y1] },
        i: { x: [x2], y: [y2] },
        t: x.t,
        s: [R(x[ch] as number)],
      }
    }),
  }
}

/** 패스 k의 곡선 극값 bbox를 acc에 누적 (닫힘 세그먼트 포함). */
export function growPathBbox(
  acc: { minX: number; minY: number; maxX: number; maxY: number },
  k: PathShapeK,
): void {
  const n = k.c ? k.v.length : k.v.length - 1
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % k.v.length
    growCubicBbox(
      acc,
      k.v[j],
      [k.v[j][0] + k.o[j][0], k.v[j][1] + k.o[j][1]],
      [k.v[j2][0] + k.i[j2][0], k.v[j2][1] + k.i[j2][1]],
      k.v[j2],
    )
  }
}

/**
 * t 시점의 패스 보간값 — 키 없으면 null. 선형 근사 (kfValueAt와 동일 —
 * 편집 오버레이용이라 이징 오차 허용). 포인트 수가 다르면 모핑 불가 → 왼쪽 키 홀드.
 */
export function pathKAt(xkf: CustomKf, t: number): PathShapeK | null {
  const keys = kfChannelKeys(xkf, 'pk')
  if (!keys.length) return null
  const val = (k: KfKey) => k.pk as PathShapeK
  if (t <= keys[0].t) return structuredClone(val(keys[0]))
  if (t >= keys[keys.length - 1].t) return structuredClone(val(keys[keys.length - 1]))
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t < a.t || t > b.t) continue
    const A = val(a)
    const B = val(b)
    if (A.v.length !== B.v.length || A.c !== B.c) return structuredClone(A)
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
    const mix = (pa: [number, number][], pb: [number, number][]) =>
      pa.map((p, j) => [p[0] + (pb[j][0] - p[0]) * f, p[1] + (pb[j][1] - p[1]) * f] as [number, number])
    return { v: mix(A.v, B.v), i: mix(A.i, B.i), o: mix(A.o, B.o), c: A.c }
  }
  return structuredClone(val(keys[keys.length - 1]))
}

/** pk 키 간 포인트 수/열림 불일치 — 모핑 불가 구간 존재 여부 (⚠ 가드). */
export function pkMismatch(xkf: CustomKf): boolean {
  const keys = kfChannelKeys(xkf, 'pk')
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i].pk as PathShapeK
    const b = keys[i + 1].pk as PathShapeK
    if (a.v.length !== b.v.length || a.c !== b.c) return true
  }
  return false
}

/**
 * 패스 k를 target 포인트 수로 세분 — 가장 긴 세그먼트를 드 카스텔조 이등분.
 * 형태는 수학적으로 동일하게 유지된다 (모핑 포인트 수 맞추기용).
 */
export function subdividePathK(k0: PathShapeK, target: number): PathShapeK {
  const k = structuredClone(k0)
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ]
  const add = (a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]]
  const sub = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]]
  const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
  while (k.v.length < target) {
    const nSeg = k.c ? k.v.length : k.v.length - 1
    if (nSeg < 1) break
    // 컨트롤 폴리곤 길이가 가장 긴 세그먼트 선택
    let bestJ = 0
    let bestL = -1
    for (let j = 0; j < nSeg; j++) {
      const j2 = (j + 1) % k.v.length
      const p0 = k.v[j]
      const c1 = add(p0, k.o[j])
      const p3 = k.v[j2]
      const c2 = add(p3, k.i[j2])
      const L = dist(p0, c1) + dist(c1, c2) + dist(c2, p3)
      if (L > bestL) {
        bestL = L
        bestJ = j
      }
    }
    const j = bestJ
    const j2 = (j + 1) % k.v.length
    const p0 = k.v[j]
    const c1 = add(p0, k.o[j])
    const p3 = k.v[j2]
    const c2 = add(p3, k.i[j2])
    const L = mid(p0, c1)
    const M0 = mid(c1, c2)
    const R = mid(c2, p3)
    const LL = mid(L, M0)
    const RR = mid(M0, R)
    const MID = mid(LL, RR)
    k.o[j] = sub(L, p0)
    k.i[j2] = sub(R, p3)
    k.v.splice(j + 1, 0, MID)
    k.i.splice(j + 1, 0, sub(LL, MID))
    k.o.splice(j + 1, 0, sub(RR, MID))
  }
  return k
}

/** 그룹 안의 유일한 sh — 패스 편집/모핑 가능 조건. */
/** 레이어 shapes[0] 트리에서 지정 타입 아이템 전부 수집 (그룹 재귀) — 워커 단일 소스. */
export function collectShapeItems(
  layer: Record<string, unknown>,
  tys: string[],
): Record<string, unknown>[] {
  const shapes = layer.shapes as Record<string, unknown>[] | undefined
  const found: Record<string, unknown>[] = []
  const walk = (items?: Record<string, unknown>[]) => {
    for (const it of items ?? []) {
      if (tys.includes(String(it.ty))) found.push(it)
      else if (it.ty === 'gr') walk(it.it as Record<string, unknown>[])
    }
  }
  if (shapes?.[0]) walk(shapes[0].it as Record<string, unknown>[])
  return found
}

export function findSinglePathShape(layer: Record<string, unknown>): Record<string, unknown> | null {
  const found = collectShapeItems(layer, ['sh'])
  return found.length === 1 ? found[0] : null
}

/**
 * xkf의 패스 채널(pk)을 레이어의 단일 sh.ks에 반영 — 키 1개 = 정적, 2개+ = 모핑.
 * bbox 메타는 전 키 유니온 — 프레임마다 형태가 변해도 선택/히트 박스가 전 구간을 덮는다.
 */
export function applyPathChannel(layer: Record<string, unknown>, xkf: CustomKf): void {
  const keys = kfChannelKeys(xkf, 'pk')
  const sh = findSinglePathShape(layer)
  if (!sh) return
  if (!keys.length) {
    // pk 채널이 있다가 사라진 레이어(xpk) — 첫 키 형태로 고정 (타임라인 키 전체 삭제 등)
    if (layer.xpk === true) {
      const ks = sh.ks as { a?: number; k?: unknown }
      if (ks?.a === 1 && Array.isArray(ks.k)) {
        const first = (ks.k[0] as { s?: unknown[] } | undefined)?.s?.[0]
        if (first) sh.ks = { a: 0, k: structuredClone(first) }
      }
      delete layer.xpk
    }
    return
  }
  layer.xpk = true
  if (keys.length === 1) {
    sh.ks = { a: 0, k: structuredClone(keys[0].pk) }
  } else {
    sh.ks = {
      a: 1,
      k: keys.map((x, i) => {
        if (i === keys.length - 1) return { t: x.t, s: [structuredClone(x.pk)] }
        const [x1, y1, x2, y2] = segEaseOf(xkf, x, 'pk')
        return { o: { x: [x1], y: [y1] }, i: { x: [x2], y: [y2] }, t: x.t, s: [structuredClone(x.pk)] }
      }),
    }
  }
  const acc = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const key of keys) growPathBbox(acc, key.pk as PathShapeK)
  const group = (layer.shapes as Record<string, unknown>[] | undefined)?.[0]
  if (group && Number.isFinite(acc.minX)) {
    group.bboxW = acc.maxX - acc.minX
    group.bboxH = acc.maxY - acc.minY
    group.bboxMax = Math.max(acc.maxX - acc.minX, acc.maxY - acc.minY)
    const tr = (group.it as Record<string, unknown>[] | undefined)?.find((it) => it.ty === 'tr') as
      | { a?: { k: number[] }; s?: { k: number[] } }
      | undefined
    const ta = tr?.a?.k ?? [0, 0]
    const gsc = ((tr?.s?.k?.[0] as number | undefined) ?? 100) / 100
    group.bboxCx = ((acc.minX + acc.maxX) / 2 - ta[0]) * gsc
    group.bboxCy = ((acc.minY + acc.maxY) / 2 - ta[1]) * gsc
  }
}

/** t 시점 그라디언트 보간 — 스톱 수 다르면 왼쪽 키 홀드 (모핑 불가). 선형 근사. */
export function gradKAt(xkf: CustomKf, t: number): GradSnap | null {
  const keys = kfChannelKeys(xkf, 'gk')
  if (!keys.length) return null
  const val = (k: KfKey) => k.gk as GradSnap
  if (t <= keys[0].t) return structuredClone(val(keys[0]))
  if (t >= keys[keys.length - 1].t) return structuredClone(val(keys[keys.length - 1]))
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t < a.t || t > b.t) continue
    const A = val(a)
    const B = val(b)
    if (A.k.length !== B.k.length || A.p !== B.p) return structuredClone(A)
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
    const mix = (x: number, y: number) => x + (y - x) * f
    return {
      p: A.p,
      k: A.k.map((v, j) => mix(v, B.k[j])),
      s: [mix(A.s[0], B.s[0]), mix(A.s[1], B.s[1])],
      e: [mix(A.e[0], B.e[0]), mix(A.e[1], B.e[1])],
    }
  }
  return structuredClone(val(keys[keys.length - 1]))
}

/** gk 키 간 스톱 수 불일치 — 모핑 불가 구간 존재 여부. */
export function gkMismatch(xkf: CustomKf): boolean {
  const keys = kfChannelKeys(xkf, 'gk')
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i].gk as GradSnap
    const b = keys[i + 1].gk as GradSnap
    if (a.k.length !== b.k.length || a.p !== b.p) return true
  }
  return false
}

/**
 * xkf의 그라디언트 채널(gk)을 레이어의 첫 gf에 반영 — 키 1개 = 정적, 2개+ = 모핑
 * (g.k와 s/e 끝점 모두 애니메이션). 키가 사라진 레이어(xgk)는 첫 키 형태로 고정.
 */
export function applyGradChannel(layer: Record<string, unknown>, xkf: CustomKf): void {
  const keys = kfChannelKeys(xkf, 'gk')
  const gf = collectShapeItems(layer, ['gf'])[0]
  if (!gf) return
  const setStatic = (snap: GradSnap) => {
    gf.g = { p: snap.p, k: { a: 0, k: [...snap.k] } }
    gf.s = { a: 0, k: [...snap.s] }
    gf.e = { a: 0, k: [...snap.e] }
  }
  if (!keys.length) {
    if (layer.xgk === true) {
      const gk = (gf.g as Record<string, unknown> | undefined)?.k as
        | { a?: number; k?: unknown }
        | undefined
      if (gk?.a === 1 && Array.isArray(gk.k)) {
        const first = (gk.k[0] as { s?: number[] } | undefined)?.s
        const sP = ((gf.s as Record<string, unknown>)?.k as unknown[]) ?? []
        const eP = ((gf.e as Record<string, unknown>)?.k as unknown[]) ?? []
        const at = (prop: unknown[]): [number, number] => {
          const f0 = (prop[0] as { s?: number[] } | undefined)?.s
          return Array.isArray(f0) ? [f0[0], f0[1]] : [Number(prop[0]) || 0, Number(prop[1]) || 0]
        }
        if (first)
          setStatic({
            p: Number((gf.g as Record<string, unknown>).p) || Math.floor(first.length / 4),
            k: [...first],
            s: at(sP),
            e: at(eP),
          })
      }
      delete layer.xgk
    }
    return
  }
  layer.xgk = true
  if (keys.length === 1) {
    setStatic(keys[0].gk as GradSnap)
    return
  }
  const kfOf = (pick: (g: GradSnap) => number[]) =>
    keys.map((x, i) => {
      const sVal = pick(x.gk as GradSnap)
      if (i === keys.length - 1) return { t: x.t, s: sVal }
      const [x1, y1, x2, y2] = segEaseOf(xkf, x, 'gk')
      return { o: { x: [x1], y: [y1] }, i: { x: [x2], y: [y2] }, t: x.t, s: sVal }
    })
  gf.g = { p: (keys[0].gk as GradSnap).p, k: { a: 1, k: kfOf((g) => [...g.k]) } }
  gf.s = { a: 1, k: kfOf((g) => [...g.s]) }
  gf.e = { a: 1, k: kfOf((g) => [...g.e]) }
}

/** shapes 트리에서 첫 트림(tm) 셰이프 찾기. */
export function findTrimShape(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findTrimShape(x)
      if (r) return r
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  const obj = node as Record<string, unknown>
  if (obj.ty === 'tm') return obj
  return findTrimShape(obj.it ?? null)
}

/**
 * xkf의 트림 채널(ts/te)을 레이어 shapes의 tm에 반영 — 키 있는 채널만 덮어쓴다.
 * tm이 없으면 첫 그룹에 생성 (지오메트리 뒤·페인터 앞 — AE 배치).
 */
export function applyTrimChannels(layer: Record<string, unknown>, xkf: CustomKf): void {
  const tsProp = buildKfScalarProp(xkf, 'ts')
  const teProp = buildKfScalarProp(xkf, 'te')
  if (!tsProp && !teProp) return
  const shapes = layer.shapes as Record<string, unknown>[] | undefined
  if (!shapes?.length) return
  let tm = findTrimShape(shapes)
  if (!tm) {
    const group = shapes.find((g) => g.ty === 'gr' && Array.isArray(g.it))
    if (!group) return
    const it = group.it as Record<string, unknown>[]
    tm = {
      ty: 'tm',
      s: { a: 0, k: 0 },
      e: { a: 0, k: 100 },
      o: { a: 0, k: 0 },
      m: 1,
      nm: 'Trim Paths',
    }
    const painterIdx = it.findIndex((x) => ['st', 'fl', 'gf', 'gs'].includes(String(x.ty)))
    const trIdx = it.findIndex((x) => x.ty === 'tr')
    const at = painterIdx >= 0 ? painterIdx : trIdx >= 0 ? trIdx : it.length
    it.splice(at, 0, tm)
  }
  if (tsProp) tm.s = tsProp
  if (teProp) tm.e = teProp
}

/**
 * 레이어 tm의 s/e 애니메이션을 xkf ts/te 키로 추출 (시간은 이미 문서 시간축).
 * 해당 채널에 키가 이미 있으면 건너뜀 — 구버전 세션 마이그레이션용. 추가 시 true.
 */
export function extractTrimToKf(layer: Record<string, unknown>): boolean {
  const tm = findTrimShape(layer.shapes ?? null)
  if (!tm) return false
  const xkfRaw = (layer.xkf ?? {}) as Partial<CustomKf>
  const keys: KfKey[] = Array.isArray(xkfRaw.keys) ? (xkfRaw.keys as KfKey[]) : []
  const has = (ch: 'ts' | 'te') => keys.some((k) => k[ch] !== undefined)
  let added = false
  for (const [prop, ch] of [['s', 'ts'], ['e', 'te']] as const) {
    if (has(ch)) continue
    const p = tm[prop] as { a?: number; k?: unknown } | undefined
    if (!p || p.a !== 1 || !Array.isArray(p.k)) continue
    for (const kf of p.k as Record<string, unknown>[]) {
      if (typeof kf.t !== 'number' || !Array.isArray(kf.s)) continue
      const rt = Math.round((kf.t as number) * 10) / 10
      let key = keys.find((k) => Math.abs(k.t - rt) < 0.5)
      if (!key) {
        key = { t: rt }
        keys.push(key)
      }
      ;(key as unknown as Record<string, unknown>)[ch] =
        Math.round(Math.max(0, Math.min(100, Number(kf.s[0]) || 0)) * 10) / 10
      const o = kf.o as { x?: number[]; y?: number[] } | undefined
      const bi = kf.i as { x?: number[]; y?: number[] } | undefined
      if (o?.x?.length && bi?.x?.length)
        key.e = {
          ...(key.e ?? {}),
          [ch]: [o.x[0], o.y?.[0] ?? 0, bi.x[0], bi.y?.[0] ?? 1] as Bezier4,
        }
      added = true
    }
  }
  if (added) {
    keys.sort((a, b) => a.t - b.t)
    layer.xkf = {
      ...xkfRaw,
      on: !!xkfRaw.on,
      ease: typeof xkfRaw.ease === 'number' ? xkfRaw.ease : 1,
      keys,
    }
  }
  return added
}

/** 레이어 i의 반폭/반높이 — 이미지는 에셋 크기, SVG는 bbox×스케일. */
/**
 * 유효 레이어 스케일 (ks.s 정착값) — frame 주면 s 키 보간값, 없으면 정적(xsel.scale).
 * 박스/히트/앵커 보정이 공유 — 스케일 100 가정으로 어긋나던 버그의 단일 소스.
 */
function localScaleOf(doc: LottieJson, i: number, frame?: number): number {
  const layer = doc.layers[i] as Record<string, unknown> | undefined
  if (!layer) return 1
  // 정적 ks.s가 진실 소스 — 임포트된 씬 래퍼처럼 xsel 밖에서 온 스케일 포함
  // (xkf/프리셋 재구축 레이어의 정적 ks.s도 xsel.scale과 일치하므로 안전)
  const ksS = (layer.ks as Record<string, unknown> | undefined)?.s as
    | { a?: number; k?: number[] | number }
    | undefined
  if (ksS && ksS.a === 0 && Array.isArray(ksS.k)) {
    const v0 = Number(ksS.k[0])
    return Math.max(0.01, (Number.isFinite(v0) ? v0 : 100) / 100)
  }
  // 애니메이션 중(a:1) — xkf s 채널(프레임 보간) 또는 정착값
  const xsel = normSel(layer.xsel as Partial<CustomSel> | undefined, doc.op)
  const xkf = normKf(layer.xkf as Partial<CustomKf> | undefined)
  const v =
    xkf.on && frame !== undefined
      ? (kfValueAt(xkf, 's', frame, xsel.scale ?? 100) as number)
      : (xsel.scale ?? 100)
  return Math.max(0.01, v / 100)
}

/** 문서에서 레이어 i의 기준 위치 (첫 키프레임 또는 정적 값). atFrame = 키프레임 모드 보간 시각. */
export function localBaseOf(doc: LottieJson, i: number, atFrame?: number): [number, number] | null {
  const layer = doc.layers[i] as (Record<string, unknown> & { ks?: unknown }) | undefined
  if (!layer) return null
  // 키프레임 모드 — 파킹 프레임의 보간 위치 (박스가 애니메이션 위치를 따라감)
  const xkfRaw = layer.xkf as Partial<CustomKf> | undefined
  if (xkfRaw?.on && typeof atFrame === 'number') {
    const xb: [number, number] = Array.isArray(layer.xbase)
      ? [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
      : [256, 256]
    return kfValueAt(normKf(xkfRaw), 'p', atFrame, xb) as [number, number]
  }
  // 정착 위치 = xbase (슬라이드류는 첫 키프레임이 화면 밖 오프셋이라 쓰면 안 됨)
  if (Array.isArray(layer.xbase)) {
    return [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
  }
  const p = (layer.ks as Record<string, unknown>).p as { a?: number; k: unknown }
  if (p.a === 1 && Array.isArray(p.k)) {
    const kfs = p.k as { s: number[] }[]
    const last = kfs[kfs.length - 1].s
    return [last[0], last[1]]
  }
  return [(p.k as number[])[0], (p.k as number[])[1]]
}

/** 정착 회전(도) — 정적 ks.r 우선, 애니메이션 중엔 xkf r 채널/xsel. layerScaleOf와 같은 규칙. */
export function localRotationOf(doc: LottieJson, i: number, frame?: number): number {
  const layer = doc.layers[i] as Record<string, unknown> | undefined
  if (!layer) return 0
  const ksR = (layer.ks as Record<string, unknown> | undefined)?.r as
    | { a?: number; k?: number }
    | undefined
  if (ksR && ksR.a === 0 && typeof ksR.k === 'number') return ksR.k
  const xsel = normSel(layer.xsel as Partial<CustomSel> | undefined, doc.op)
  const xkf = normKf(layer.xkf as Partial<CustomKf> | undefined)
  return xkf.on && frame !== undefined
    ? (kfValueAt(xkf, 'r', frame, xsel.rotation ?? 0) as number)
    : (xsel.rotation ?? 0)
}

/** 레이어 앵커 (ks.a 정적) — 로컬 좌표. */
function anchorOf(doc: LottieJson, i: number): [number, number] {
  const a = ((doc.layers[i] as Record<string, unknown>)?.ks as Record<string, unknown> | undefined)
    ?.a as { k?: number[] } | undefined
  return Array.isArray(a?.k) ? [a.k[0] ?? 0, a.k[1] ?? 0] : [0, 0]
}

/** 부모 체인 — 가까운 부모부터 레이어 인덱스. 끊긴 참조/순환은 중단. */
export function parentChainOf(doc: LottieJson, i: number): number[] {
  const layers = doc.layers as unknown as Record<string, unknown>[]
  if (typeof layers[i]?.parent !== 'number') return []
  const byInd = new Map<number, number>()
  layers.forEach((l, j) => {
    if (typeof l.ind === 'number') byInd.set(l.ind as number, j)
  })
  const chain: number[] = []
  let cur = layers[i]
  let hop = 0
  while (cur && typeof cur.parent === 'number' && hop++ < 64) {
    const pj = byInd.get(cur.parent as number)
    if (pj === undefined || pj === i || chain.includes(pj)) break
    chain.push(pj)
    cur = layers[pj]
  }
  return chain
}

/** 항등 2×3. */
const MAT_ID: Mat = [1, 0, 0, 1, 0, 0]

/** 2×3 역행렬. */
export function invMat(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

/** 방향 벡터 변환 — 이동 성분 제외. */
export function applyVMat(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y]
}

/**
 * 레이어 i의 부모 월드 변환 — 로컬→캔버스 2×3 행렬 + 회전 합/스케일 곱.
 * 부모 없으면 항등 (fast path). 로티 합성 순서: T(p)·R·S·T(-a).
 */
export function parentWorldOf(
  doc: LottieJson,
  i: number,
  frame?: number,
): { rot: number; sc: number; m: Mat } {
  const chain = parentChainOf(doc, i)
  if (!chain.length) return { rot: 0, sc: 1, m: MAT_ID }
  let m: Mat = MAT_ID
  let rot = 0
  let sc = 1
  for (let c = chain.length - 1; c >= 0; c--) {
    const j = chain[c]
    const p = localBaseOf(doc, j, frame) ?? [0, 0]
    const r = localRotationOf(doc, j, frame)
    const scl = localScaleOf(doc, j, frame)
    const a = anchorOf(doc, j)
    const rad = (r * Math.PI) / 180
    const cos = Math.cos(rad) * scl
    const sin = Math.sin(rad) * scl
    m = mul(m, [cos, sin, -sin, cos, p[0] - (a[0] * cos - a[1] * sin), p[1] - (a[0] * sin + a[1] * cos)])
    rot += r
    sc *= scl
  }
  return { rot, sc, m }
}

/** 기준 위치 — 부모 체인 반영(캔버스 좌표). atFrame = 키프레임 보간 시각. */
export function layerBaseOf(doc: LottieJson, i: number, atFrame?: number): [number, number] | null {
  const local = localBaseOf(doc, i, atFrame)
  if (!local) return null
  const pw = parentWorldOf(doc, i, atFrame)
  return pw.m === MAT_ID ? local : apply(pw.m, local[0], local[1])
}

/** 회전 — 부모 회전 합산. */
export function layerRotationOf(doc: LottieJson, i: number, frame?: number): number {
  return localRotationOf(doc, i, frame) + parentWorldOf(doc, i, frame).rot
}

/** 스케일 — 부모 스케일 곱. */
export function layerScaleOf(doc: LottieJson, i: number, frame?: number): number {
  return localScaleOf(doc, i, frame) * parentWorldOf(doc, i, frame).sc
}

/**
 * 화면(축 정렬) 바운딩 박스 — 회전 반영 AABB 절반 + 중심 오프셋.
 * 셀렉션 박스/호버/히트테스트용. 앵커 분율 수학은 무회전 layerHalfOf를 쓸 것.
 */
export function layerAabbOf(
  doc: LottieJson,
  i: number,
  frame?: number,
): { half: [number, number]; offset: [number, number] } {
  const [hw, hh] = layerHalfOf(doc, i, frame)
  const [ox, oy] = layerCenterOffsetOf(doc, i, frame)
  const deg = layerRotationOf(doc, i, frame)
  if (Math.abs(deg % 360) < 0.01) return { half: [hw, hh], offset: [ox, oy] }
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const sn = Math.sin(r)
  return {
    half: [Math.abs(hw * c) + Math.abs(hh * sn), Math.abs(hw * sn) + Math.abs(hh * c)],
    // 중심 오프셋 벡터도 회전 — 앵커가 중심이 아니면 회전 시 중심이 원호를 돈다
    offset: [ox * c - oy * sn, ox * sn + oy * c],
  }
}

export function layerHalfOf(doc: LottieJson, i: number, frame?: number): [number, number] {
  const [hw, hh] = layerHalfRawOf(doc, i)
  const sc = layerScaleOf(doc, i, frame)
  return [hw * sc, hh * sc]
}

function layerHalfRawOf(doc: LottieJson, i: number): [number, number] {
  const layer = doc.layers[i] as Record<string, unknown> | undefined
  if (!layer) return [60, 60]
  // 씬 참조(프리컴프) 레이어 — 뷰포트 크기가 곧 박스
  if (Number(layer.ty) === 0 && typeof layer.w === 'number')
    return [(layer.w as number) / 2, Number(layer.h ?? layer.w) / 2]
  const asset = (doc.assets as Record<string, unknown>[] | undefined)?.find(
    (a) => a.id === layer.refId,
  )
  if (asset && typeof asset.w === 'number' && !asset.layers)
    return [(asset.w as number) / 2, (asset.h as number) / 2]
  const g = (layer.shapes as Record<string, unknown>[] | undefined)?.[0]
  if (g && typeof g.bboxW === 'number' && typeof g.bboxH === 'number') {
    const tr = (g.it as Record<string, unknown>[]).find((it) => it.ty === 'tr')
    const sc = ((tr?.s as { k: number[] })?.k[0] ?? 100) / 100
    return [((g.bboxW as number) * sc) / 2, ((g.bboxH as number) * sc) / 2]
  }
  return [60, 60]
}

/** 앵커 오프셋 — 시각적 중심 = 기준위치(xbase) + 이 값. (회전은 근사 무시) */
export function layerCenterOffsetOf(doc: LottieJson, i: number, frame?: number): [number, number] {
  const layer = doc.layers[i] as Record<string, unknown> | undefined
  if (!layer) return [0, 0]
  const sc = layerScaleOf(doc, i, frame)
  const a = (((layer.ks as Record<string, unknown>)?.a as { k?: number[] })?.k as number[]) ?? [0, 0]
  // 씬 참조(프리컴프) — 뷰포트(레이어 w/h) 기준 중심 (회전은 근사 무시, 스케일은 반영)
  if (Number(layer.ty) === 0 && typeof layer.w === 'number')
    return [((layer.w as number) / 2 - a[0]) * sc, (Number(layer.h ?? layer.w) / 2 - a[1]) * sc]
  const asset = (doc.assets as Record<string, unknown>[] | undefined)?.find(
    (x) => x.id === layer.refId,
  )
  if (asset && typeof asset.w === 'number' && !asset.layers)
    return [((asset.w as number) / 2 - a[0]) * sc, ((asset.h as number) / 2 - a[1]) * sc]
  // 셰이프 — 펜 포인트 편집으로 bbox 중심이 그룹 앵커에서 벗어난 만큼(bboxCx/Cy) 보정
  const g = (layer.shapes as Record<string, unknown>[] | undefined)?.[0]
  const cx = Number(g?.bboxCx ?? 0)
  const cy = Number(g?.bboxCy ?? 0)
  return [(cx - a[0]) * sc, (cy - a[1]) * sc]
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
