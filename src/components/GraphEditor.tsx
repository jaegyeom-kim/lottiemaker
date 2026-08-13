import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor } from '../store'
import { t } from '../lib/i18n'
import {
  normKf, kfChannelKeys, segEaseOf, KF_CHANNEL_DEFS,
  type CustomKf, type KfChannel, type Bezier4, type KfKey,
} from '../lib/customBuilder'

/** 커브 복사/붙여넣기 클립보드 — 세션 내 공유. */
let easeClipboard: Bezier4 | null = null

/** cubic-bezier(x1,y1,x2,y2)에서 x(시간 진행) → y(값 진행) — 이진 탐색. */
function bezY(bez: Bezier4, x: number): number {
  const [x1, y1, x2, y2] = bez
  const cx = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u
  const cy = (u: number) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (cx(mid) < x) lo = mid
    else hi = mid
  }
  return cy((lo + hi) / 2)
}

/** 눈금 간격 — 1/2/5 × 10^n 중 목표에 가장 가까운 값. */
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-9))))
  for (const m of [1, 2, 5, 10]) if (rough <= m * pow) return m * pow
  return 10 * pow
}

const PRESETS: { key: string; label: string; bez: Bezier4 }[] = [
  { key: 'easy', label: '이지 이즈', bez: [0.42, 0, 0.58, 1] },
  { key: 'in', label: '이즈 인', bez: [0.42, 0, 1, 1] },
  { key: 'out', label: '이즈 아웃', bez: [0, 0, 0.58, 1] },
  { key: 'linear', label: '리니어', bez: [0, 0, 1, 1] },
]

const W = 640
const H = 300
const PAD = { l: 44, r: 16, t: 14, b: 24 }
const PLOT_W = W - PAD.l - PAD.r
const PLOT_H = H - PAD.t - PAD.b

interface View {
  t0: number
  t1: number
  v0: number
  v1: number
}

/**
 * 그래프 에디터 (C4D F-커브 방식 내비게이션) — 독립 플로팅 창.
 * 휠 = 줌(커서 기준, ⇧시간축만 ⌥값축만) · 빈 곳 드래그 = 팬 · F = 선택 구간 맞춤 · H = 전체 맞춤.
 */
export default function GraphEditor({ onClose }: { onClose: () => void }) {
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const curFrame = useEditor((s) => s.curFrame)
  const { setKfSegEaseLive, commitEdit } = useEditor()

  const layer = sourceData?.layers[customIdx] as Record<string, unknown> | undefined
  const xkf: CustomKf = normKf(layer?.xkf as Partial<CustomKf> | undefined)
  const OP = Number(sourceData?.op ?? 240)

  const channels = KF_CHANNEL_DEFS.filter(({ ch }) => ch !== 'pk' && kfChannelKeys(xkf, ch).length >= 2)
  const [chSel, setChSel] = useState<KfChannel | null>(null)
  const ch: KfChannel | null =
    chSel && channels.some((c) => c.ch === chSel) ? chSel : (channels[0]?.ch ?? null)
  const [selTs, setSelTs] = useState<number[]>([])
  // 모듈 클립보드는 상태가 아니라서 복사 직후 리렌더가 필요
  const [, setClipTick] = useState(0)

  // ── 뷰 도메인 (null = 전체 맞춤) ──
  const [view, setView] = useState<View | null>(null)

  // 떠 있는 창 — 헤더 드래그로 이동 (배경은 계속 조작 가능)
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, (window.innerWidth - (W + 150)) / 2),
    y: Math.max(12, (window.innerHeight - (H + 100)) / 3),
  }))
  const winDrag = useRef<{ dx: number; dy: number } | null>(null)
  const beginWinDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    winDrag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const moveWinDrag = (e: React.PointerEvent) => {
    if (!winDrag.current) return
    setPos({
      x: Math.min(Math.max(-W + 80, e.clientX - winDrag.current.dx), window.innerWidth - 80),
      y: Math.min(Math.max(0, e.clientY - winDrag.current.dy), window.innerHeight - 40),
    })
  }
  const endWinDrag = () => {
    winDrag.current = null
  }

  // ── 데이터/뷰 좌표계 ──
  const keys = ch ? kfChannelKeys(xkf, ch) : []
  const dims = ch === 'p' ? 2 : 1
  const val = (k: KfKey, d: number) => (ch === 'p' ? (k.p as [number, number])[d] : (k[ch!] as number))

  const fit: View = useMemo(() => {
    if (!keys.length) return { t0: 0, t1: OP, v0: 0, v1: 100 }
    let tMin = Infinity
    let tMax = -Infinity
    let vMin = Infinity
    let vMax = -Infinity
    for (const k of keys) {
      tMin = Math.min(tMin, k.t)
      tMax = Math.max(tMax, k.t)
      for (let d = 0; d < dims; d++) {
        vMin = Math.min(vMin, val(k, d))
        vMax = Math.max(vMax, val(k, d))
      }
    }
    if (tMax - tMin < 2) {
      tMin -= 1
      tMax += 1
    }
    if (vMax - vMin < 1e-6) {
      vMin -= 1
      vMax += 1
    }
    const pt = (tMax - tMin) * 0.08
    const pv = (vMax - vMin) * 0.1
    return { t0: tMin - pt, t1: tMax + pt, v0: vMin - pv, v1: vMax + pv }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xkf, ch, OP])

  const dom = view ?? fit
  const X = (frame: number) => PAD.l + ((frame - dom.t0) / (dom.t1 - dom.t0)) * PLOT_W
  const Y = (v: number) => H - PAD.b - ((v - dom.v0) / (dom.v1 - dom.v0)) * PLOT_H
  const invX = (px: number) => dom.t0 + ((px - PAD.l) / PLOT_W) * (dom.t1 - dom.t0)
  const invY = (py: number) => dom.v0 + ((H - PAD.b - py) / PLOT_H) * (dom.v1 - dom.v0)

  // ── 커브/키/눈금 ──
  const graph = useMemo(() => {
    if (!ch || !keys.length) return null
    const series: { color: string; d: string; dots: { x: number; y: number; t: number }[] }[] = []
    const colors = dims === 2 ? ['#3182f6', '#b06ef7'] : ['#3182f6'] // X=가이드 파랑, Y=보라
    for (let d = 0; d < dims; d++) {
      let path = ''
      const dots: { x: number; y: number; t: number }[] = []
      keys.forEach((k, i) => {
        dots.push({ x: X(k.t), y: Y(val(k, d)), t: k.t })
        if (i === keys.length - 1) return
        const nk = keys[i + 1]
        const bez = segEaseOf(xkf, k, ch)
        for (let s = 0; s <= 32; s++) {
          const u = s / 32
          const fx = k.t + (nk.t - k.t) * u
          const fy = val(k, d) + (val(nk, d) - val(k, d)) * bezY(bez, u)
          path += `${path ? 'L' : 'M'}${X(fx).toFixed(1)},${Y(fy).toFixed(1)}`
        }
      })
      series.push({ color: colors[d], d: path, dots })
    }
    // 눈금 — 도메인 기반 nice step
    const xStep = niceStep((dom.t1 - dom.t0) / 8)
    const xticks: { x: number; label: string }[] = []
    for (let f = Math.ceil(dom.t0 / xStep) * xStep; f <= dom.t1 + 1e-9; f += xStep)
      xticks.push({ x: X(f), label: String(Math.round(f)) })
    const yStep = niceStep((dom.v1 - dom.v0) / 5)
    const yticks: { y: number; label: string }[] = []
    for (let v = Math.ceil(dom.v0 / yStep) * yStep; v <= dom.v1 + 1e-9; v += yStep)
      yticks.push({
        y: Y(v),
        label: Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10),
      })
    return { series, xticks, yticks }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xkf, ch, OP, dom.t0, dom.t1, dom.v0, dom.v1])

  const selKeys = keys.filter((k) => selTs.some((t0) => Math.abs(k.t - t0) < 0.5))
  const selKey = selKeys.length === 1 ? selKeys[0] : null
  // 이징 적용 대상 구간 = 선택 키 중 다음 키가 있는 것들
  const easeTargets = selKeys.filter((k) => keys.indexOf(k) < keys.length - 1)
  const canEase = easeTargets.length > 0
  const applyBez = (bez: Bezier4) => {
    if (!ch || !easeTargets.length) return
    // 여러 구간이어도 언두 1회 — 라이브로 전부 적용 후 커밋
    for (const k of easeTargets) setKfSegEaseLive(ch, k.t, bez)
    commitEdit()
  }

  // ── 프레이밍 (C4D H/F) ──
  const frameAll = () => setView(null)
  const frameSelected = () => {
    if (!selKeys.length) return
    // 단일 키 선택이면 그 구간(다음 키까지), 다중이면 선택 범위
    const scope =
      selKeys.length === 1 && canEase
        ? [selKeys[0], keys[keys.indexOf(selKeys[0]) + 1]]
        : selKeys
    let tMin = Infinity
    let tMax = -Infinity
    let vMin = Infinity
    let vMax = -Infinity
    for (const k of scope) {
      tMin = Math.min(tMin, k.t)
      tMax = Math.max(tMax, k.t)
      for (let d = 0; d < dims; d++) {
        vMin = Math.min(vMin, val(k, d))
        vMax = Math.max(vMax, val(k, d))
      }
    }
    if (tMax - tMin < 1) {
      tMin -= 1
      tMax += 1
    }
    if (vMax - vMin < 1e-6) {
      vMin -= 1
      vMax += 1
    }
    const pt = Math.max((tMax - tMin) * 0.15, 0.5)
    const pv = (vMax - vMin) * 0.25
    setView({ t0: tMin - pt, t1: tMax + pt, v0: vMin - pv, v1: vMax + pv })
  }

  // 단축키 — 창 떠 있는 동안 H(전체)/F(선택).
  // 리스너는 마운트 시 1회만 등록 (매 렌더 재등록하면 같은 이벤트 디스패치 중
  // 다른 핸들러발 리렌더가 아직 호출 안 된 이 리스너를 제거해버린다) — ref로 최신 클로저 참조.
  const frameAllRef = useRef(frameAll)
  frameAllRef.current = frameAll
  const frameSelectedRef = useRef(frameSelected)
  frameSelectedRef.current = frameSelected
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'Escape') {
        // 다른 핸들러(펜 취소 등)가 이미 소비한 Esc는 무시
        if (e.defaultPrevented) return
        onCloseRef.current()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault()
        frameAllRef.current()
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        frameSelectedRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── SVG 좌표 ──
  const svgRef = useRef<SVGSVGElement>(null)
  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) * W) / rect.width,
      y: ((e.clientY - rect.top) * H) / rect.height,
    }
  }

  // ── 휠 줌 (커서 기준) — React onWheel은 passive라 ref로 non-passive 부착 ──
  const domRef = useRef({ view, fit })
  domRef.current = { view, fit }
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const pt = svgPoint(e)
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const d = domRef.current.view ?? domRef.current.fit
      const tc = d.t0 + ((pt.x - PAD.l) / PLOT_W) * (d.t1 - d.t0)
      const vc = d.v0 + ((H - PAD.b - pt.y) / PLOT_H) * (d.v1 - d.v0)
      const zoomT = !e.altKey // ⌥ = 값축만
      const zoomV = !e.shiftKey // ⇧ = 시간축만
      const spanT = Math.max(1, Math.min((d.t1 - d.t0) * (zoomT ? f : 1), OP * 20))
      const spanV = Math.max(1e-3, (d.v1 - d.v0) * (zoomV ? f : 1))
      const rT = (tc - d.t0) / (d.t1 - d.t0)
      const rV = (vc - d.v0) / (d.v1 - d.v0)
      setView({
        t0: tc - spanT * rT,
        t1: tc + spanT * (1 - rT),
        v0: vc - spanV * rV,
        v1: vc + spanV * (1 - rV),
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 마키 선택 (빈 곳 드래그 = 키프레임 러버밴드) ──
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const marqueeRef = useRef<{ x0: number; y0: number; add: boolean } | null>(null)
  const beginMarquee = (e: React.PointerEvent) => {
    const el = e.target as Element
    // 키/핸들(라인 포함) 위에서는 마키 시작 안 함
    if (el.classList.contains('gepanel__key') || el.closest('.gepanel__handles')) return
    const pt = svgPoint(e)
    marqueeRef.current = { x0: pt.x, y0: pt.y, add: e.shiftKey }
    setMarquee({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const moveMarquee = (e: React.PointerEvent) => {
    if (!marqueeRef.current) return
    const pt = svgPoint(e)
    setMarquee({ x0: marqueeRef.current.x0, y0: marqueeRef.current.y0, x1: pt.x, y1: pt.y })
  }
  const endMarquee = () => {
    if (!marqueeRef.current || !marquee) {
      marqueeRef.current = null
      setMarquee(null)
      return
    }
    const xA = Math.min(marquee.x0, marquee.x1)
    const xB = Math.max(marquee.x0, marquee.x1)
    const yA = Math.min(marquee.y0, marquee.y1)
    const yB = Math.max(marquee.y0, marquee.y1)
    const tiny = xB - xA < 3 && yB - yA < 3
    const hit: number[] = []
    if (tiny) {
      // 클릭 — 근접 키(8px) 있으면 픽, 없으면 해제
      const cx = (xA + xB) / 2
      const cy = (yA + yB) / 2
      let best: { t: number; d2: number } | null = null
      for (const k of keys)
        for (let d = 0; d < dims; d++) {
          const dx = X(k.t) - cx
          const dy = Y(val(k, d)) - cy
          const d2 = dx * dx + dy * dy
          if (d2 <= 64 && (!best || d2 < best.d2)) best = { t: k.t, d2 }
        }
      if (best) hit.push(best.t)
    } else {
      for (const k of keys)
        for (let d = 0; d < dims; d++) {
          const x = X(k.t)
          const y = Y(val(k, d))
          if (x >= xA && x <= xB && y >= yA && y <= yB) {
            hit.push(k.t)
            break
          }
        }
    }
    setSelTs((prev) => {
      if (tiny && !hit.length) return []
      if (marqueeRef.current?.add) {
        const merged = new Set(prev)
        for (const t0 of hit) merged.add(t0)
        return [...merged]
      }
      return hit
    })
    marqueeRef.current = null
    setMarquee(null)
  }

  // ── 베지어 핸들 드래그 ──
  const handleDrag = useRef<{ which: 0 | 1; bez: Bezier4 } | null>(null)
  const seg = useMemo(() => {
    if (!selKey || !canEase || !ch) return null
    const i = keys.indexOf(selKey)
    const nk = keys[i + 1]
    const v0 = val(selKey, 0)
    const v1 = val(nk, 0)
    const bez = segEaseOf(xkf, selKey, ch)
    const px = (u: number) => X(selKey.t + (nk.t - selKey.t) * u)
    const py = (w: number) => Y(v0 + (v1 - v0) * w)
    return {
      k: selKey, nk, v0, v1, bez,
      p0: { x: X(selKey.t), y: Y(v0) },
      p3: { x: X(nk.t), y: Y(v1) },
      c1: { x: px(bez[0]), y: py(bez[1]) },
      c2: { x: px(bez[2]), y: py(bez[3]) },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, canEase, ch, xkf, dom.t0, dom.t1, dom.v0, dom.v1])

  const beginHandle = (e: React.PointerEvent, which: 0 | 1) => {
    if (!seg || !ch) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    handleDrag.current = { which, bez: [...seg.bez] as Bezier4 }
  }
  const moveHandle = (e: React.PointerEvent) => {
    if (!handleDrag.current || !seg || !ch || !selKey) return
    e.stopPropagation()
    const pt = svgPoint(e)
    const frame = invX(pt.x)
    const u = Math.max(0.001, Math.min(0.999, (frame - seg.k.t) / (seg.nk.t - seg.k.t)))
    const vAt = invY(pt.y)
    const dv = seg.v1 - seg.v0
    // 평평한 구간은 뷰 값 범위 기준으로 환산 (0 나눗셈 방지)
    const denom = Math.abs(dv) > 1e-6 ? dv : dom.v1 - dom.v0 || 1
    const w = Math.max(-3, Math.min(4, (vAt - seg.v0) / denom))
    const bez: Bezier4 = [...handleDrag.current.bez] as Bezier4
    if (handleDrag.current.which === 0) {
      bez[0] = Math.round(u * 1000) / 1000
      bez[1] = Math.round(w * 1000) / 1000
    } else {
      bez[2] = Math.round(u * 1000) / 1000
      bez[3] = Math.round(w * 1000) / 1000
    }
    handleDrag.current.bez = bez
    setKfSegEaseLive(ch, selKey.t, bez)
  }
  const endHandle = () => {
    if (!handleDrag.current) return
    handleDrag.current = null
    commitEdit()
  }

  return createPortal(
    <div className="gepanel gepanel--float" style={{ left: pos.x, top: pos.y }}>
      <div
        className="gepanel__head gepanel__head--drag"
        onPointerDown={beginWinDrag}
        onPointerMove={moveWinDrag}
        onPointerUp={endWinDrag}
        onPointerCancel={endWinDrag}
      >
        <strong>{t('그래프 에디터')}</strong>
        <span className="gepanel__navhint">
          {t('휠: 줌 (⇧시간·⌥값) · 드래그: 키 선택 · F: 선택 맞춤 · H: 전체')}
        </span>
        <button className="gepanel__close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="gepanel__body">
        <div className="gepanel__props">
          <div className="gepanel__propstitle">{t('프로퍼티')}</div>
          {channels.length === 0 ? (
            <p className="panel__hint">{t('키프레임 있는 레이어를 선택하세요')}</p>
          ) : (
            channels.map(({ ch: c, label }) => (
              <button
                key={c}
                className={`gepanel__prop ${c === ch ? 'gepanel__prop--on' : ''}`}
                onClick={() => {
                  setChSel(c)
                  setSelTs([])
                  setView(null)
                }}
              >
                ◆ {t(label)}
                <span className="gepanel__count">{kfChannelKeys(xkf, c).length}</span>
              </button>
            ))
          )}
        </div>
        <svg
          ref={svgRef}
          className="gepanel__graph"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          onPointerDown={beginMarquee}
          onPointerMove={moveMarquee}
          onPointerUp={endMarquee}
          onPointerCancel={endMarquee}
        >
          <defs>
            <clipPath id="ge-plot">
              <rect x={PAD.l} y={PAD.t} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          </defs>
          {/* 그리드 */}
          {graph?.yticks.map((tk, i) => (
            <g key={`y${i}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={tk.y} y2={tk.y} className="gepanel__grid" />
              <text x={PAD.l - 6} y={tk.y + 3} className="gepanel__tick" textAnchor="end">
                {tk.label}
              </text>
            </g>
          ))}
          {graph?.xticks.map((tk, i) => (
            <g key={`x${i}`}>
              <line x1={tk.x} x2={tk.x} y1={PAD.t} y2={H - PAD.b} className="gepanel__grid" />
              <text x={tk.x} y={H - PAD.b + 14} className="gepanel__tick" textAnchor="middle">
                {tk.label}
              </text>
            </g>
          ))}
          {/* 재생헤드 */}
          {graph && curFrame >= dom.t0 && curFrame <= dom.t1 && (
            <line
              x1={X(curFrame)}
              x2={X(curFrame)}
              y1={PAD.t}
              y2={H - PAD.b}
              className="gepanel__playhead"
            />
          )}
          {/* 커브 + 키 — 플롯 영역으로 클리핑 (밖으로 나간 키가 다른 UI를 가리지 않게) */}
          <g clipPath="url(#ge-plot)">
          {graph?.series.map((sr, si) => (
            <g key={si}>
              <path d={sr.d} fill="none" stroke={sr.color} strokeWidth={1.6} />
              {sr.dots.map((dt) => (
                <rect
                  key={dt.t}
                  x={dt.x - 4}
                  y={dt.y - 4}
                  width={8}
                  height={8}
                  transform={`rotate(45 ${dt.x} ${dt.y})`}
                  className={`gepanel__key ${selTs.some((t0) => Math.abs(dt.t - t0) < 0.5) ? 'gepanel__key--sel' : ''}`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setSelTs((prev) =>
                      e.shiftKey
                        ? prev.some((t0) => Math.abs(t0 - dt.t) < 0.5)
                          ? prev.filter((t0) => Math.abs(t0 - dt.t) >= 0.5)
                          : [...prev, dt.t]
                        : [dt.t],
                    )
                  }}
                />
              ))}
            </g>
          ))}
          {/* 베지어 핸들 — 선택 구간 (드래그로 이징 조절) */}
          {seg && (
            <g className="gepanel__handles" clipPath="url(#ge-plot)">
              <line x1={seg.p0.x} y1={seg.p0.y} x2={seg.c1.x} y2={seg.c1.y} />
              <line x1={seg.p3.x} y1={seg.p3.y} x2={seg.c2.x} y2={seg.c2.y} />
              {([0, 1] as const).map((which) => {
                const c = which === 0 ? seg.c1 : seg.c2
                return (
                  <circle
                    key={which}
                    cx={c.x}
                    cy={c.y}
                    r={5.5}
                    className="gepanel__handle"
                    onPointerDown={(e) => beginHandle(e, which)}
                    onPointerMove={moveHandle}
                    onPointerUp={endHandle}
                    onPointerCancel={endHandle}
                  />
                )
              })}
            </g>
          )}
          </g>
          {/* 마키 러버밴드 */}
          {marquee && (
            <rect
              x={Math.min(marquee.x0, marquee.x1)}
              y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)}
              height={Math.abs(marquee.y1 - marquee.y0)}
              className="gepanel__marquee"
            />
          )}
          {!graph && (
            <text x={W / 2} y={H / 2} className="gepanel__empty" textAnchor="middle">
              {t('키프레임 있는 레이어를 선택하세요')}
            </text>
          )}
        </svg>
      </div>
      <div className="gepanel__foot">
        <button className="gepanel__btn" title={t('전체 맞춤 (H)')} onClick={frameAll}>
          ⤢ {t('전체')}
        </button>
        <button
          className="gepanel__btn"
          disabled={!selKeys.length}
          title={t('선택 구간 맞춤 (F)')}
          onClick={frameSelected}
        >
          ⌖ {t('선택')}
        </button>
        <span className="gepanel__sep" />
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className="gepanel__btn"
            disabled={!canEase}
            title={`cubic-bezier(${p.bez.join(', ')})`}
            onClick={() => applyBez(p.bez)}
          >
            {t(p.label)}
          </button>
        ))}
        <span className="gepanel__sep" />
        <button
          className="gepanel__btn"
          disabled={!canEase}
          onClick={() => {
            if (ch && selKey) {
              easeClipboard = segEaseOf(xkf, selKey, ch)
              setClipTick((n) => n + 1)
            }
          }}
        >
          {t('커브 복사')}
        </button>
        <button
          className="gepanel__btn"
          disabled={!canEase || !easeClipboard}
          onClick={() => easeClipboard && applyBez(easeClipboard)}
        >
          {t('커브 붙여넣기')}
        </button>
        <span className="gepanel__hint">
          {canEase
            ? selKeys.length > 1
              ? t('프리셋/붙여넣기가 선택한 {n}개 구간에 적용됩니다').replace('{n}', String(easeTargets.length))
              : t('핸들 드래그로 커브 조절 — 프리셋은 구간에 적용')
            : t('드래그 또는 클릭으로 키를 선택하세요')}
        </span>
      </div>
    </div>,
    document.body,
  )
}
