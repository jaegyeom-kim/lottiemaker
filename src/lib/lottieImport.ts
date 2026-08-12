// 로티 JSON → 커스텀 레이어 변환 — 레이어 트랜스폼 키프레임(p/s/r/o)을 xkf로 가져온다.
// 지원: 셰이프(ty4)·이미지(ty2)·솔리드(ty1). 프리컴프/텍스트/널은 건너뜀.
// 시간은 60fps 기준으로 환산, 좌표는 512 캔버스로 스케일. 셰이프 내부 애니메이션
// (패스 모프·트림·색)은 shapes에 그대로 실려 유지된다 — 레이어 트랜스폼만 xkf로.
import { DEFAULT_SEL, findTrimShape, type Bezier4, type KfKey, type CustomKf, type CustomSel } from './customBuilder'
import type { LottieJson } from './lottieUtils'

const CANVAS = 512
const OUR_FR = 60

export interface LottieImportResult {
  layers: Record<string, unknown>[]
  assets: Record<string, unknown>[]
  /** 60fps 환산 컴포지션 길이 (30~360f 클램프). */
  op: number
  warnings: string[]
  skipped: number
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const arr = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(Number) : fin(v) ? [v] : []

interface RawKf {
  t: number
  v: number[]
  e?: Bezier4
  hold?: boolean
  /** 공간 접선 존재 (위치 채널) — 곡선 경로 힌트. */
  spatial?: boolean
}

/** {a,k} 프로퍼티 → 정적값 또는 키 목록. 마지막 키의 s 누락(구포맷)은 이전 값 승계. */
function readProp(prop: unknown): { st?: number[]; keys?: RawKf[] } | null {
  const p = prop as { a?: number; k?: unknown } | undefined
  if (!p || p.k === undefined) return null
  if (!p.a || !Array.isArray(p.k) || !(p.k as unknown[]).some((x) => typeof x === 'object' && x !== null))
    return { st: arr(p.k) }
  const kfs = p.k as Record<string, unknown>[]
  const keys: RawKf[] = []
  let prevV: number[] | null = null
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i]
    if (!fin(kf.t)) continue
    const v: number[] | null = kf.s !== undefined ? arr(kf.s) : prevV
    if (!v || !v.length) continue
    prevV = v
    let e: Bezier4 | undefined
    let hold = false
    if (kf.h === 1) {
      hold = true
    } else if (kf.o && kf.i && i < kfs.length - 1) {
      const gx = (s: unknown): number => {
        const t = (s as { x?: unknown }).x
        return Array.isArray(t) ? Number(t[0]) : Number(t)
      }
      const gy = (s: unknown): number => {
        const t = (s as { y?: unknown }).y
        return Array.isArray(t) ? Number(t[0]) : Number(t)
      }
      const x1 = gx(kf.o)
      const y1 = gy(kf.o)
      const x2 = gx(kf.i)
      const y2 = gy(kf.i)
      if ([x1, y1, x2, y2].every(fin))
        e = [clamp(x1, 0, 1), clamp(y1, -2, 3), clamp(x2, 0, 1), clamp(y2, -2, 3)]
    }
    const spatial =
      (Array.isArray(kf.to) && (kf.to as number[]).some((n) => Math.abs(Number(n)) > 0.01)) ||
      (Array.isArray(kf.ti) && (kf.ti as number[]).some((n) => Math.abs(Number(n)) > 0.01))
    keys.push({ t: Number(kf.t), v, e, hold, spatial })
  }
  if (!keys.length) return null
  if (keys.length === 1) return { st: keys[0].v }
  return { keys }
}

/** 분리 좌표(p.s=true) — x/y 개별 트랙을 시각 합집합에서 선형 샘플로 병합. */
function readSplitPosition(prop: Record<string, unknown>): { st?: number[]; keys?: RawKf[] } | null {
  const rx = readProp(prop.x)
  const ry = readProp(prop.y)
  if (!rx || !ry) return null
  if (rx.st && ry.st) return { st: [rx.st[0], ry.st[0]] }
  const evalAt = (r: { st?: number[]; keys?: RawKf[] }, t: number): number => {
    if (r.st) return r.st[0]
    const ks = r.keys!
    if (t <= ks[0].t) return ks[0].v[0]
    if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v[0]
    for (let i = 0; i < ks.length - 1; i++) {
      if (t >= ks[i].t && t <= ks[i + 1].t) {
        const f = (t - ks[i].t) / Math.max(0.001, ks[i + 1].t - ks[i].t)
        return ks[i].v[0] + (ks[i + 1].v[0] - ks[i].v[0]) * f
      }
    }
    return ks[0].v[0]
  }
  const times = [...new Set([...(rx.keys ?? []).map((k) => k.t), ...(ry.keys ?? []).map((k) => k.t)])].sort(
    (a, b) => a - b,
  )
  return { keys: times.map((t) => ({ t, v: [evalAt(rx, t), evalAt(ry, t)] })) }
}

// ── 부모 링크 해석 — 정적 체인은 정확 합성, 애니메이션 체인은 시간 샘플 베이크 ──

/** cubic-bezier 이징 y(f) — x(u)=f를 뉴턴 반복으로 풀어 y(u). */
function bezY(e: Bezier4, f: number): number {
  if (f <= 0) return 0
  if (f >= 1) return 1
  const [x1, y1, x2, y2] = e
  const cx = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u
  const dcx = (u: number) =>
    3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2)
  let u = f
  for (let i = 0; i < 8; i++) {
    const d = dcx(u)
    if (Math.abs(d) < 1e-6) break
    u -= (cx(u) - f) / d
    u = clamp(u, 0, 1)
  }
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u
}

type PropRead = { st?: number[]; keys?: RawKf[] } | null

/** 프로퍼티를 t(레이어 로컬 프레임)에서 평가 — 이징·홀드 반영. */
function evalProp(r: PropRead, t: number, dflt: number[]): number[] {
  if (!r) return dflt
  if (r.st) return r.st
  const ks = r.keys!
  if (t <= ks[0].t) return ks[0].v
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i]
    const b = ks[i + 1]
    if (t >= a.t && t <= b.t) {
      if (a.hold) return a.v
      const f = (t - a.t) / Math.max(0.0001, b.t - a.t)
      const g = a.e ? bezY(a.e, f) : f
      return a.v.map((v, d) => v + ((b.v[d] ?? b.v[0]) - v) * g)
    }
  }
  return dflt
}

type Mat = [number, number, number, number, number, number] // a b c d tx ty

const matMul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const matApply = (m: Mat, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

interface TR {
  p: PropRead
  s: PropRead
  r: PropRead
  a: PropRead
  st: number
  sr: number
  split: boolean
  raw: Record<string, unknown>
}

function readTR(l: Record<string, unknown>): TR {
  const ks = (l.ks as Record<string, unknown> | undefined) ?? {}
  const pProp = ks.p as Record<string, unknown> | undefined
  const split = pProp?.s === true
  return {
    p: split ? readSplitPosition(pProp!) : readProp(pProp),
    s: readProp(ks.s),
    r: readProp(ks.r),
    a: readProp(ks.a),
    st: Number(l.st ?? 0),
    sr: Number(l.sr ?? 1) || 1,
    split,
    raw: l,
  }
}

const trStatic = (tr: TR) => !tr.p?.keys && !tr.s?.keys && !tr.r?.keys && !tr.a?.keys

/** 레이어 트랜스폼 행렬 — tSrc는 소스 comp 프레임 (로컬 시간으로 환산해 평가). */
function trMatrixAt(tr: TR, tSrc: number): Mat {
  const tl = (tSrc - tr.st) / tr.sr
  const p = evalProp(tr.p, tl, [0, 0])
  const s = evalProp(tr.s, tl, [100, 100])
  const r = ((evalProp(tr.r, tl, [0])[0] ?? 0) * Math.PI) / 180
  const a = evalProp(tr.a, tl, [0, 0])
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const sx = (s[0] ?? 100) / 100
  const sy = (s[1] ?? s[0] ?? 100) / 100
  // T(p) · R(r) · S(s) · T(-a)
  const m: Mat = [cos * sx, sin * sx, -sin * sy, cos * sy, p[0] ?? 0, p[1] ?? 0]
  return matMul(m, [1, 0, 0, 1, -(a[0] ?? 0), -(a[1] ?? 0)])
}

/** 부모 체인(직계→루트) 합성 행렬. */
function chainMatrixAt(chain: TR[], tSrc: number): Mat {
  let m: Mat = [1, 0, 0, 1, 0, 0]
  for (const anc of chain) m = matMul(trMatrixAt(anc, tSrc), m)
  return m
}

/** TR에 컨텍스트(자기 comp → 루트 comp) 시간 매핑 부여 — 프리컴프 중첩용.
 *  로티는 레이어 트랜스폼 키를 comp 시간으로 평가한다 (offsetTime 상쇄) —
 *  레이어 자신의 st/sr은 자식 컴프 내용만 시프트하므로 여기서 쓰지 않는다. */
const remapTR = (tr: TR, stOff: number, srMul: number): TR => ({
  ...tr,
  st: stOff,
  sr: srMul,
})

/** 평탄화된 레이어 레코드 — 프리컴프 트리를 부모 체인+시간 리맵으로 인라인. */
interface FlatRec {
  l: Record<string, unknown>
  chain: TR[]
  /** 컨텍스트 시간 매핑 — 이 레이어의 comp 시간 → 루트 comp 시간: t*sr + st. */
  st: number
  sr: number
  /** 레이어 자신의 st (comp 시간) — ty0 자식 컴프 오프셋 출력용. */
  lst: number
  clipA: number
  clipB: number
  /** 프리컴프 정적 불투명도 곱 (0~1). */
  oMul: number
}

/** 레이어 트리 평탄화 — ty0 프리컴프를 재귀 인라인. 셰이프/이미지/솔리드만 수집. */
function flattenLayers(
  layerArr: Record<string, unknown>[],
  assetsById: Map<string, Record<string, unknown>>,
  ctx: { chain: TR[]; stOff: number; srMul: number; clipA: number; clipB: number; oMul: number; depth: number },
  warnings: Set<string>,
  counters: { skipped: number },
  descend = true,
): FlatRec[] {
  const out: FlatRec[] = []
  const byIndLocal = new Map<number, Record<string, unknown>>()
  for (const l of layerArr) byIndLocal.set(Number(l.ind), l)

  const chainFor = (l: Record<string, unknown>): TR[] => {
    const chain: TR[] = []
    let cur = l
    const seen = new Set<number>()
    while (cur.parent !== undefined && cur.parent !== null) {
      const pl = byIndLocal.get(Number(cur.parent))
      if (!pl || seen.has(Number(cur.parent))) break
      seen.add(Number(cur.parent))
      chain.push(remapTR(readTR(pl), ctx.stOff, ctx.srMul))
      cur = pl
    }
    return [...chain, ...ctx.chain]
  }

  for (const l of layerArr) {
    const ty = Number(l.ty)
    // 자식 컴프 내용의 시간 오프셋 (하강용) — 트랜스폼 키는 comp 시간이라 여기 안 쓴다
    const childSt = ctx.stOff + Number(l.st ?? 0) * ctx.srMul
    const childSr = (Number(l.sr ?? 1) || 1) * ctx.srMul
    // 레이어 ip/op는 로컬 comp 프레임 → 바깥 시간축으로
    const clipA = Math.max(ctx.clipA, Number(l.ip ?? 0) * ctx.srMul + ctx.stOff)
    const clipB = Math.min(ctx.clipB, Number(l.op ?? Infinity) * ctx.srMul + ctx.stOff)
    if (clipB <= clipA) continue // 화면에 안 나옴
    if (l.hd === true) continue

    if (ty === 0) {
      // 씬 모드 — 내리지 않고 참조 레이어 레코드로 승격
      if (!descend) {
        out.push({
          l, chain: chainFor(l), st: ctx.stOff, sr: ctx.srMul,
          lst: Number(l.st ?? 0), clipA, clipB, oMul: ctx.oMul,
        })
        continue
      }
      // 프리컴프 — 내부 레이어를 이 레이어의 트랜스폼을 부모로 달아 인라인
      const comp = assetsById.get(String(l.refId))
      const inner = comp?.layers as Record<string, unknown>[] | undefined
      if (!inner || ctx.depth >= 5) {
        counters.skipped++
        if (ctx.depth >= 5) warnings.add('프리컴프 중첩이 너무 깊음 — 일부 생략')
        continue
      }
      if (l.tm !== undefined) warnings.add('타임 리맵(tm)은 미지원 — 선형 재생으로 대체')
      const trPre = remapTR(readTR(l), ctx.stOff, ctx.srMul)
      // 프리컴프 자체 불투명도 — 정적이면 곱, 애니메이션이면 첫 값 근사
      const oProp = readProp(((l.ks as Record<string, unknown> | undefined) ?? {}).o)
      let oMul = ctx.oMul
      if (oProp?.st) oMul *= clamp(oProp.st[0], 0, 100) / 100
      else if (oProp?.keys) {
        oMul *= clamp(oProp.keys[0].v[0], 0, 100) / 100
        warnings.add('프리컴프 불투명도 애니메이션은 첫 값으로 근사')
      }
      out.push(
        ...flattenLayers(
          inner,
          assetsById,
          {
            chain: [trPre, ...chainFor(l)],
            stOff: childSt,
            srMul: childSr,
            clipA,
            clipB,
            oMul,
            depth: ctx.depth + 1,
          },
          warnings,
          counters,
        ),
      )
      continue
    }
    if (ty !== 4 && ty !== 2 && ty !== 1) {
      if (ty !== 3) {
        // 널은 부모 전용이라 조용히 통과, 텍스트 등만 카운트
        counters.skipped++
        warnings.add('텍스트 등 미지원 레이어는 건너뜀')
      }
      continue
    }
    out.push({
      l, chain: chainFor(l), st: ctx.stOff, sr: ctx.srMul,
      lst: Number(l.st ?? 0), clipA, clipB, oMul: ctx.oMul,
    })
  }
  return out
}

/**
 * 셰이프 내부 애니메이션(트림·패스 모프·색 키 등) 시간 재매핑 — 재귀 워크.
 * 모든 {a:1, k:[{t}]} 프로퍼티의 키 시각에 map을 적용한다 (fps 환산 + 평탄화 오프셋).
 */
function rescaleShapeTimes(node: unknown, map: (t: number) => number): void {
  if (Array.isArray(node)) {
    for (const item of node) rescaleShapeTimes(item, map)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (
    obj.a === 1 &&
    Array.isArray(obj.k) &&
    obj.k.length &&
    typeof (obj.k[0] as Record<string, unknown>)?.t === 'number'
  ) {
    for (const kf of obj.k as { t: number }[]) kf.t = Math.round(map(kf.t) * 100) / 100
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') rescaleShapeTimes(v, map)
  }
}

/** 16진 솔리드 색 → 로티 색 배열. */
function hexColor(sc: unknown): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(sc ?? ''))
  if (!m) return [0.8, 0.8, 0.8, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]
}
/** 변환 컨텍스트 — 스코프(메인/씬)별 수집기 + 좌표·시간 환산 상수. */
interface ConvCtx {
  layers: Record<string, unknown>[]
  assets: Record<string, unknown>[]
  srcAssets: Record<string, unknown>[]
  warnings: Set<string>
  counter: { skipped: number }
  fr: number
  /** 소스 comp 길이 (소스 프레임) — 베이크 샘플 상한. */
  srcOp: number
  tScale: number
  ip0: number
  op: number
  k: number
  offX: number
  offY: number
  /** 씬 모드 — ty0 refId → 씬 id (null = 씬 아님/도달 불가). */
  sceneIdOf?: (refId: string) => string | null
}

/** 평탄화 레코드들을 커스텀 레이어로 변환 — 메인/씬 공용 코어. */
function convertRecs(recs: FlatRec[], C: ConvCtx): void {
  for (const rec of recs) {
    const l = rec.l
    const ty = Number(l.ty)
    if (Array.isArray(l.masksProperties) && l.masksProperties.length)
      C.warnings.add('마스크(masksProperties)는 지원 안 함 — 해당 효과는 제외됨')

    const st = rec.st
    const sr = rec.sr
    const T = (t: number) => clamp(Math.round((t * sr + st - C.ip0) * C.tScale * 10) / 10, 0, C.op)

    const tr: TR = { ...readTR(l), st, sr }
    let pR = tr.p
    let sR = tr.s
    let rR = tr.r
    const aR = tr.a
    let oR = readProp(((l.ks as Record<string, unknown> | undefined) ?? {}).o)
    // 프리컴프 불투명도 곱
    if (rec.oMul !== 1) {
      if (oR?.st) oR = { st: [oR.st[0] * rec.oMul] }
      else if (oR?.keys)
        oR = { keys: oR.keys.map((kf) => ({ ...kf, v: [kf.v[0] * rec.oMul] })) }
      else oR = { st: [100 * rec.oMul] }
    }

    // ── 부모 링크 해석 — 평탄화가 체인 구성 (자기 부모 + 프리컴프 + 바깥 부모) ──
    const chain: TR[] = rec.chain
    let rotOff = 0
    let sMul = 1
    if (chain.length && chain.every(trStatic)) {
      // 정적 체인 — 행렬 합성으로 정확 변환 (이징 그대로 보존)
      const M = chainMatrixAt(chain, 0)
      rotOff = chain.reduce((acc, anc) => acc + (evalProp(anc.r, 0, [0])[0] ?? 0), 0)
      sMul = chain.reduce((acc, anc) => acc * ((evalProp(anc.s, 0, [100])[0] ?? 100) / 100), 1)
      const mapPt = (v: number[]): number[] => {
        const [x, y] = matApply(M, v[0] ?? 0, v[1] ?? 0)
        return [x, y]
      }
      if (pR?.st) pR = { st: mapPt(pR.st) }
      else if (pR?.keys) pR = { keys: pR.keys.map((kf) => ({ ...kf, v: mapPt(kf.v) })) }
    } else if (chain.length) {
      // 움직이는 체인 — 소스 comp 시간축에서 월드 트랜스폼 샘플 베이크
      C.warnings.add('움직이는 부모 링크 — 트랜스폼을 키로 베이크함 (이징 단순화)')
      const t0 = Math.max(C.ip0, rec.clipA)
      const t1 = Math.min(C.srcOp, rec.clipB)
      const times = new Set<number>([t0, t1])
      const addKeyTimes = (trx: TR) => {
        for (const rprop of [trx.p, trx.s, trx.r, trx.a]) {
          for (const kf of rprop?.keys ?? []) {
            const ts = kf.t * trx.sr + trx.st
            if (ts >= t0 && ts <= t1) times.add(ts)
          }
        }
      }
      addKeyTimes(tr)
      chain.forEach(addKeyTimes)
      // 회전/스케일 애니메이션은 사이가 휘어진다 — 0.1초 간격 보간 샘플 (총 90개 상한)
      const curvy = chain.some((anc) => anc.r?.keys || anc.s?.keys || anc.a?.keys)
      const gap = curvy ? Math.max(1, C.fr / 10) : Math.max(1, C.fr / 4)
      let ts = [...times].sort((a, b) => a - b)
      const filled: number[] = []
      for (let i = 0; i < ts.length; i++) {
        filled.push(ts[i])
        if (i < ts.length - 1) {
          let from = ts[i]
          while (ts[i + 1] - from > gap && filled.length < 90) {
            from += gap
            filled.push(Math.round(from * 100) / 100)
          }
        }
      }
      ts = filled.slice(0, 90)
      const localT = (tSrc: number) => (tSrc - tr.st) / tr.sr
      const samples = ts.map((tSrc) => {
        const M = chainMatrixAt(chain, tSrc)
        const pL = evalProp(tr.p, localT(tSrc), [0, 0])
        const pW = matApply(M, pL[0] ?? 0, pL[1] ?? 0)
        const rW =
          (evalProp(tr.r, localT(tSrc), [0])[0] ?? 0) +
          chain.reduce((acc, anc) => acc + (evalProp(anc.r, (tSrc - anc.st) / anc.sr, [0])[0] ?? 0), 0)
        const sW =
          (evalProp(tr.s, localT(tSrc), [100])[0] ?? 100) *
          chain.reduce((acc, anc) => acc * ((evalProp(anc.s, (tSrc - anc.st) / anc.sr, [100])[0] ?? 100) / 100), 1)
        return { tSrc, pW, rW, sW }
      })
      const range = (vals: number[]) => Math.max(...vals) - Math.min(...vals)
      // 베이크 키의 t는 addCh의 T()가 되돌리도록 로컬 시간으로 저장
      const toLocalKf = (get: (s: (typeof samples)[number]) => number[]): RawKf[] =>
        samples.map((s2) => ({ t: localT(s2.tSrc), v: get(s2) }))
      if (range(samples.map((s2) => s2.pW[0])) > 0.1 || range(samples.map((s2) => s2.pW[1])) > 0.1)
        pR = { keys: toLocalKf((s2) => [s2.pW[0], s2.pW[1]]) }
      else pR = { st: [samples[0].pW[0], samples[0].pW[1]] }
      if (range(samples.map((s2) => s2.rW)) > 0.05) rR = { keys: toLocalKf((s2) => [s2.rW]) }
      else rR = { st: [samples[0].rW] }
      if (range(samples.map((s2) => s2.sW)) > 0.1) sR = { keys: toLocalKf((s2) => [s2.sW]) }
      else sR = { st: [samples[0].sW] }
    }

    // 정적 체인 배율(sMul)은 s에 합성 — 키가 있으면 키 값에, 없으면 아래 래퍼 접기로
    if (sMul !== 1 && sR?.keys)
      sR = { keys: sR.keys.map((kf) => ({ ...kf, v: kf.v.map((x) => x * sMul) })) }
    // 정적 스케일은 래퍼에 접어 넣는다 (엔진의 s 채널 기본이 100이라서)
    const sStatic = (sR?.st ? (sR.st[0] / 100) * sMul : 1)
    // 비균등 정적 스케일(sx≠sy)은 래퍼에 축별로 접는다 — s 채널은 균등만 지원
    const syStatic = (sR?.st ? ((sR.st[1] ?? sR.st[0]) / 100) * sMul : 1)
    const kk = C.k * (sR?.keys ? 1 : sStatic)
    const kky = C.k * (sR?.keys ? 1 : syStatic)
    if (sR?.keys && sR.keys.some((kf) => Math.abs((kf.v[0] ?? 100) - (kf.v[1] ?? kf.v[0] ?? 100)) > 0.5))
      C.warnings.add('비균등 스케일 애니메이션은 X축 기준으로 근사')

    // 키 병합 (같은 t는 채널 합침)
    const keyMap = new Map<number, KfKey>()
    const upsert = (t: number): KfKey => {
      const rt = Math.round(t * 10) / 10
      let key = keyMap.get(rt)
      if (!key) {
        key = { t: rt }
        keyMap.set(rt, key)
      }
      return key
    }
    let anyHold = false
    let anySpatial = false
    const addCh = (
      r: { keys?: RawKf[] } | null,
      ch: 'p' | 's' | 'r' | 'o',
      map: (v: number[]) => number | [number, number],
    ) => {
      if (!r?.keys) return
      for (const kf of r.keys) {
        const key = upsert(T(kf.t))
        ;(key as unknown as Record<string, unknown>)[ch] = map(kf.v)
        if (kf.e) key.e = { ...(key.e ?? {}), [ch]: kf.e }
        if (kf.hold) anyHold = true
        if (kf.spatial) anySpatial = true
      }
    }
    addCh(pR, 'p', (v) => [
      Math.round((v[0] * C.k + C.offX) * 10) / 10,
      Math.round(((v[1] ?? 0) * C.k + C.offY) * 10) / 10,
    ])
    addCh(sR, 's', (v) => Math.round(v[0] * 10) / 10)
    addCh(rR, 'r', (v) => Math.round((v[0] + rotOff) * 10) / 10)
    addCh(oR, 'o', (v) => clamp(Math.round(v[0]), 0, 100))
    if (anyHold) C.warnings.add('홀드 키프레임은 미지원 — 보간으로 대체됨')

    const keys = [...keyMap.values()].sort((a, b) => a.t - b.t)
    const base: [number, number] = pR?.st
      ? [pR.st[0] * C.k + C.offX, (pR.st[1] ?? 0) * C.k + C.offY]
      : keys.find((key) => key.p)?.p ?? [256, 256]

    const aStatic = aR?.st ?? (aR?.keys ? aR.keys[0].v : [0, 0])
    if (aR?.keys) C.warnings.add('앵커 애니메이션은 미지원 — 첫 값 고정')

    const xsel: CustomSel = structuredClone(DEFAULT_SEL)
    xsel.rotation = rR?.st ? Math.round((rR.st[0] + rotOff) * 10) / 10 : 0
    xsel.opacity = oR?.st ? clamp(Math.round(oR.st[0]), 0, 100) : 100
    // 클립 — 평탄화가 프리컴프 창과 교차 계산해 둠 (바깥 comp 시간축)
    const clipA = clamp(Math.round((rec.clipA - C.ip0) * C.tScale), 0, C.op)
    const clipB = clamp(Math.round((Math.min(rec.clipB, C.srcOp) - C.ip0) * C.tScale), 0, C.op)
    xsel.clip = [Math.min(clipA, clipB), Math.max(clipA, clipB, Math.min(clipA + 1, C.op))]

    const xkf: CustomKf = { on: keys.length > 0, ease: 0, smooth: anySpatial, keys }

    // 트랙 매트 보존 — 소스(td)는 lottie-web이 자동 숨김, 소비자(tt/tp)는 클리핑
    const matte: Record<string, unknown> = {}
    if (l.td !== undefined) matte.td = l.td
    if (l.tt !== undefined) matte.tt = l.tt
    if (l.tp !== undefined) matte.tp = l.tp
    if (typeof l.ind === 'number') matte.ind = l.ind

    const common = {
      ...matte,
      ddd: 0,
      sr: 1,
      st: 0,
      nm: String(l.nm ?? '레이어'),
      xbase: [Math.round(base[0] * 10) / 10, Math.round(base[1] * 10) / 10],
      xsel,
      xkf,
      ip: 0,
      op: C.op,
    }

    // 씬 참조 레이어 (프리컴프 보존 모드) — 표준 로티 프리컴프로 남긴다
    if (ty === 0 && C.sceneIdOf) {
      const sceneId = C.sceneIdOf(String(l.refId ?? ''))
      if (!sceneId) {
        C.counter.skipped++
        continue
      }
      // 씬 내용은 자체적으로 k 스케일됨 — 뷰포트만 k, 스케일 채널은 원값 유지
      const wv = Math.max(4, Math.round(Number(l.w ?? 512) * C.k))
      const hv = Math.max(4, Math.round(Number(l.h ?? 512) * C.k))
      if (!sR?.keys && Math.abs(sStatic - syStatic) > 0.005)
        C.warnings.add('씬 참조의 비균등 스케일은 X축 기준으로 근사')
      if (!sR?.keys && Math.abs(sStatic - 1) > 0.001) {
        // 접을 셰이프 래퍼가 없다 — 단일 s 키(=정적 값)로 보존
        keys.push({ t: 0, s: Math.round(sStatic * 1000) / 10 })
        xkf.on = true
      }
      xsel.size = Math.max(wv, hv)
      C.layers.push({
        ...common,
        ty: 0,
        refId: sceneId,
        w: wv,
        h: hv,
        // 자식 컴프 타임라인 오프셋 — 로티 의미론: st는 자식 내용만 시프트
        st: Math.round((rec.lst * sr + st - C.ip0) * C.tScale),
        ks: {
          a: { a: 0, k: [aStatic[0] * C.k, (aStatic[1] ?? 0) * C.k, 0] },
          p: { a: 0, k: [...common.xbase, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
      })
      continue
    }

    if (ty === 2) {
      // 이미지 — 에셋 동반 (외부 경로는 로드 안 될 수 있음)
      const asset = C.srcAssets.find((a) => a.id === l.refId)
      if (!asset) {
        C.counter.skipped++
        C.warnings.add('에셋 없는 이미지 레이어는 건너뜀')
        continue
      }
      const w = Number(asset.w ?? 100)
      const h = Number(asset.h ?? 100)
      const isData = typeof asset.p === 'string' && (asset.p as string).startsWith('data:')
      if (!isData) C.warnings.add('외부 이미지 경로는 표시가 안 될 수 있음 (임베드 아님)')
      const newAsset = {
        ...structuredClone(asset),
        nw: w,
        nh: h,
        w: Math.max(1, Math.round(w * kk)),
        h: Math.max(1, Math.round(h * kky)),
      }
      C.assets.push(newAsset)
      xsel.size = Math.max(Math.round(Math.max(w * kk, h * kky)), 4)
      C.layers.push({
        ...common,
        ty: 2,
        refId: asset.id,
        ks: {
          a: { a: 0, k: [aStatic[0] * kk, (aStatic[1] ?? 0) * kky, 0] },
          p: { a: 0, k: [...common.xbase, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
      })
      continue
    }

    // 셰이프/솔리드 — 솔리드는 사각형 그룹으로 변환
    let shapes: unknown[]
    if (ty === 1) {
      const sw = Number(l.sw ?? 100)
      const sh = Number(l.sh ?? 100)
      shapes = [
        {
          ty: 'gr',
          nm: 'solid',
          it: [
            { ty: 'rc', d: 1, s: { a: 0, k: [sw, sh] }, p: { a: 0, k: [sw / 2, sh / 2] }, r: { a: 0, k: 0 } },
            { ty: 'fl', c: { a: 0, k: hexColor(l.sc) }, o: { a: 0, k: 100 } },
            {
              ty: 'tr',
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
          ],
          bboxMax: Math.max(sw, sh),
          bboxW: sw,
          bboxH: sh,
        },
      ]
      xsel.size = Math.round(Math.max(sw, sh) * kk)
    } else {
      shapes = structuredClone(l.shapes ?? []) as unknown[]
      // 셰이프 내부 키(트림 등)는 자기 comp 시간 — 루트 60fps 시간축으로 재매핑
      if (Math.abs(C.tScale - 1) > 1e-9 || Math.abs(sr - 1) > 1e-9 || Math.abs(st) > 1e-9 || C.ip0)
        rescaleShapeTimes(shapes, (t) => (t * sr + st - C.ip0) * C.tScale)
      // 첫 트림(tm)의 s/e 애니메이션 → 편집 가능한 xkf 트림 채널로 승격 (시간은 위에서 이미 환산)
      {
        const tm = findTrimShape(shapes)
        if (tm) {
          for (const [prop, ch] of [['s', 'ts'], ['e', 'te']] as const) {
            const r = readProp(tm[prop])
            if (!r?.keys) continue
            for (const kf of r.keys) {
              const rt = Math.round(kf.t * 10) / 10
              let key = keys.find((k) => Math.abs(k.t - rt) < 0.5)
              if (!key) {
                key = { t: rt }
                keys.push(key)
              }
              ;(key as unknown as Record<string, unknown>)[ch] =
                Math.round(clamp(kf.v[0] ?? 0, 0, 100) * 10) / 10
              if (kf.e) key.e = { ...(key.e ?? {}), [ch]: kf.e }
            }
          }
          keys.sort((a, b) => a.t - b.t)
        }
      }
    }
    // 512 캔버스 스케일 래퍼 (kk ≠ 1일 때) — 축별 (비균등 정적 스케일 폴드)
    if (Math.abs(kk - 1) > 0.001 || Math.abs(kky - 1) > 0.001) {
      shapes = [
        {
          ty: 'gr',
          nm: 'import-scale',
          it: [
            ...(shapes as Record<string, unknown>[]),
            {
              ty: 'tr',
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [kk * 100, kky * 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
          ],
          ...(ty === 1
            ? {
                bboxMax: (shapes[0] as Record<string, unknown>).bboxMax,
                bboxW: (shapes[0] as Record<string, unknown>).bboxW,
                bboxH: (shapes[0] as Record<string, unknown>).bboxH,
              }
            : {}),
        },
      ]
    }
    C.layers.push({
      ...common,
      ty: 4,
      shapes,
      ks: {
        a: { a: 0, k: [aStatic[0] * kk, (aStatic[1] ?? 0) * kky, 0] },
        p: { a: 0, k: [...common.xbase, 0] },
        s: { a: 0, k: [100, 100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      },
    })
  }
}

/** 로티 문서 → 커스텀 레이어 세트 (프리컴프 평탄화 모드). */
export function convertLottieToCustom(src: LottieJson): LottieImportResult {
  const warnings = new Set<string>()
  const srcAssets = (src.assets as Record<string, unknown>[] | undefined) ?? []
  const fr = src.fr || 30
  const tScale = OUR_FR / fr
  const ip0 = src.ip || 0
  const op = Math.round(clamp((src.op - ip0) * tScale, 30, 360))
  if ((src.op - ip0) * tScale > 360) warnings.add('6초 초과 — 컴포지션이 6초로 잘렸습니다')
  const k = CANVAS / Math.max(src.w || CANVAS, src.h || CANVAS)
  const offX = (CANVAS - (src.w || CANVAS) * k) / 2
  const offY = (CANVAS - (src.h || CANVAS) * k) / 2
  const assetsById = new Map<string, Record<string, unknown>>()
  for (const a of srcAssets) assetsById.set(String(a.id), a)
  const counter = { skipped: 0 }
  const recs = flattenLayers(
    src.layers as Record<string, unknown>[],
    assetsById,
    { chain: [], stOff: 0, srMul: 1, clipA: ip0, clipB: src.op, oMul: 1, depth: 0 },
    warnings,
    counter,
  )
  const C: ConvCtx = {
    layers: [], assets: [], srcAssets, warnings, counter, fr, srcOp: src.op, tScale, ip0, op, k, offX, offY,
  }
  convertRecs(recs, C)
  warnings.delete('')
  return { layers: C.layers, assets: C.assets, op, warnings: [...warnings], skipped: counter.skipped }
}

/** 씬 하나 — id는 문서 내 comp 에셋 id, layers는 커스텀 레이어. */
export interface SceneConv {
  id: string
  name: string
  layers: Record<string, unknown>[]
  /** 씬 자체 타임라인 길이(우리 프레임) — 래퍼 st/sr 때문에 루트 op보다 길 수 있다. */
  op: number
  /** 씬 뷰포트 (참조 래퍼 w/h × k) — 컴프 진입 시 캔버스 크기. */
  w: number
  h: number
}

export interface LottieScenesResult {
  main: Record<string, unknown>[]
  scenes: SceneConv[]
  assets: Record<string, unknown>[]
  op: number
  warnings: string[]
  skipped: number
}

/** 로티 문서에 프리컴프가 있는지 — 임포트 모드 분기용. */
export function hasPrecomps(src: LottieJson): boolean {
  const assetsById = new Map(
    (((src.assets as Record<string, unknown>[] | undefined) ?? [])).map((a) => [String(a.id), a]),
  )
  return (src.layers as Record<string, unknown>[]).some(
    (l) => Number(l.ty) === 0 && assetsById.get(String(l.refId))?.layers !== undefined,
  )
}

/** 로티 문서 → 씬 보존 변환 (LottieFiles Creator 방식) — 프리컴프가 씬이 된다. */
export function convertLottieToScenes(src: LottieJson): LottieScenesResult {
  const warnings = new Set<string>()
  const srcAssets = (src.assets as Record<string, unknown>[] | undefined) ?? []
  const fr = src.fr || 30
  const tScale = OUR_FR / fr
  const ip0 = src.ip || 0
  const op = Math.round(clamp((src.op - ip0) * tScale, 30, 360))
  if ((src.op - ip0) * tScale > 360) warnings.add('6초 초과 — 컴포지션이 6초로 잘렸습니다')
  const k = CANVAS / Math.max(src.w || CANVAS, src.h || CANVAS)
  const offX = (CANVAS - (src.w || CANVAS) * k) / 2
  const offY = (CANVAS - (src.h || CANVAS) * k) / 2
  const assetsById = new Map<string, Record<string, unknown>>()
  for (const a of srcAssets) assetsById.set(String(a.id), a)

  // 도달 가능한 comp 에셋 → 씬 (BFS, 최대 24)
  const sceneIds = new Map<string, string>()
  const sceneWH = new Map<string, { w: number; h: number }>()
  const order: string[] = []
  const visit = (layerArr: Record<string, unknown>[]) => {
    for (const l of layerArr) {
      if (Number(l.ty) !== 0) continue
      const rid = String(l.refId ?? '')
      const comp = assetsById.get(rid)
      if (!comp?.layers || sceneIds.has(rid)) continue
      if (sceneIds.size >= 24) {
        warnings.add('씬이 너무 많음 — 24개까지만 가져옴')
        continue
      }
      sceneIds.set(rid, `xsc_${sceneIds.size + 1}`)
      sceneWH.set(rid, { w: Number(l.w ?? 512), h: Number(l.h ?? 512) })
      order.push(rid)
      visit(comp.layers as Record<string, unknown>[])
    }
  }
  visit(src.layers as Record<string, unknown>[])

  const counter = { skipped: 0 }
  const imgAssets: Record<string, unknown>[] = []
  const sceneIdOf = (rid: string) => sceneIds.get(rid) ?? null
  const convertScope = (layerArr: Record<string, unknown>[], root: boolean) => {
    // 씬은 자식 comp 시간축 — 래퍼 st/sr로 루트 창(op) 밖 프레임을 참조할 수 있어
    // 루트 op로 클램프하면 내용이 통째로 잘린다. 자식 레이어 실제 길이 기준.
    const scopeSrcOp = root
      ? src.op
      : Math.max(src.op, ...layerArr.map((l) => Number(l.op ?? src.op)))
    const scopeIp0 = root ? ip0 : 0
    const scopeOp = root
      ? op
      : Math.round(clamp((scopeSrcOp - scopeIp0) * tScale, 30, 2400))
    const C: ConvCtx = {
      layers: [], assets: imgAssets, srcAssets, warnings, counter, fr, srcOp: scopeSrcOp,
      tScale, ip0: scopeIp0, op: scopeOp, k, offX: root ? offX : 0, offY: root ? offY : 0, sceneIdOf,
    }
    const recs = flattenLayers(
      layerArr, assetsById,
      { chain: [], stOff: 0, srMul: 1, clipA: scopeIp0, clipB: scopeSrcOp, oMul: 1, depth: 0 },
      warnings, counter, false,
    )
    convertRecs(recs, C)
    return { layers: C.layers, op: scopeOp }
  }
  const mainConv = convertScope(src.layers as Record<string, unknown>[], true)
  const main = mainConv.layers
  const scenes: SceneConv[] = order.map((rid) => {
    const conv = convertScope((assetsById.get(rid)!.layers as Record<string, unknown>[]) ?? [], false)
    const wh = sceneWH.get(rid) ?? { w: 512, h: 512 }
    return {
      id: sceneIds.get(rid)!,
      name: String(assetsById.get(rid)?.nm ?? rid),
      layers: conv.layers,
      op: conv.op,
      w: Math.max(16, Math.round(wh.w * k)),
      h: Math.max(16, Math.round(wh.h * k)),
    }
  })
  // 이미지 에셋 중복 제거 (메인/씬에서 같은 에셋 참조)
  const seen = new Set<string>()
  const assets = imgAssets.filter((a) => {
    const id = String(a.id)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  warnings.delete('')
  return { main, scenes, assets, op, warnings: [...warnings], skipped: counter.skipped }
}
