import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor } from '../store'
import { setDragCursor } from '../lib/cursor'
import { loadEaseTokens, saveEaseTokens, type EaseToken } from '../lib/easeTokens'
import {
  animSpans, normSel, normKf, kfValueAt, kfChannelKeys, segEaseOf, layerColor, tint,
  kfFallbackValue, EASE_PRESETS, KF_CHANNEL_DEFS, SPRING_PRESETS,
  type CustomSel, type CustomKf, type KfChannel, type Bezier4, type KfSelItem,
} from '../lib/customBuilder'

// 타임라인 바디 높이 — 드래그 리사이즈, 저장/복원
const TL_H_KEY = 'lottiemaker.timeline.h'
const TL_H_DEF = 210
const TL_H_MIN = 120
const TL_H_MAX = 480

function loadTlHeight(): number {
  try {
    const v = Number(localStorage.getItem(TL_H_KEY))
    return Number.isFinite(v) && v >= TL_H_MIN && v <= TL_H_MAX ? v : TL_H_DEF
  } catch {
    return TL_H_DEF
  }
}

/** 키프레임 레이어 트리의 프로퍼티 행 (Figma Motion 방식). */
const KF_CHANNELS = KF_CHANNEL_DEFS

type DragMode = 'move' | 'left' | 'right' | 'in-edge' | 'out-edge'

/**
 * 커스텀 타임라인 — AE 컴포지션처럼 모든 레이어가 행으로 늘어서고,
 * 각 행의 클립을 개별로 밀고(시간 이동) 당긴다(트림). 바를 잡으면 그 레이어가 선택된다.
 * 클립 안: 등장(파랑)·루프(빗금)·퇴장(빨강) 세그먼트 — 세그먼트 드래그로 길이 조절.
 * 빈 곳/눈금자 = 스크럽, 플레이헤드 직접 드래그.
 */
export default function Timeline({
  frameFrac,
  totalSec,
  onScrub,
}: {
  frameFrac: number
  totalSec: number
  onScrub: (frac: number, done: boolean) => void
}) {
  const {
    setCustomChannelsLive, commitEdit, setPlaying, setCustomIdx,
    moveKfClipLive, removeKfChannel, setKfChannel,
    setKfSegEase, setKfSegEaseLive, bakeSpringSegEase,
    setKfSel, moveKfKeysLive,
  } = useEditor()
  const curFrame = useEditor((s) => s.curFrame)
  const kfSel = useEditor((s) => s.kfSel)
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const customIdxs = useEditor((s) => s.customIdxs)
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    li: number
    mode: DragMode
    startX: number
    clipA: number
    clipB: number
    inDur: number
    outDur: number
    pxPerF: number
  } | null>(null)
  const scrubbing = useRef(false)
  const [dragInfo, setDragInfo] = useState<string | null>(null)
  // 키 드래그 — 선택 그룹째 이동. items의 t는 잡은 시점 고정(editBaseline 기준 재적용)
  const kfDrag = useRef<{
    items: KfSelItem[]
    startX: number
    pxPerF: number
    lastDt: number
  } | null>(null)
  // 마키(드래그 박스) 선택 — 프로퍼티 레인 빈 곳에서 시작
  const marquee = useRef<{ sx: number; sy: number } | null>(null)
  const [marqueeBox, setMarqueeBox] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  )
  // 키프레임 레이어는 기본 펼침 — 접은 것만 기억
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  // 바디 높이 — 상단 핸들 드래그로 조절
  const [bodyH, setBodyH] = useState(loadTlHeight)
  const beginHResize = (e: React.PointerEvent) => {
    e.preventDefault()
    setDragCursor('row')
    const startY = e.clientY
    const h0 = bodyH
    const move = (ev: PointerEvent) =>
      setBodyH(Math.max(TL_H_MIN, Math.min(TL_H_MAX, h0 - (ev.clientY - startY))))
    const up = () => {
      setDragCursor(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setBodyH((h) => {
        try {
          localStorage.setItem(TL_H_KEY, String(h))
        } catch {
          // 저장 불가 환경 — 무시
        }
        return h
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const resetH = () => {
    setBodyH(TL_H_DEF)
    try {
      localStorage.setItem(TL_H_KEY, String(TL_H_DEF))
    } catch {
      // 무시
    }
  }
  // 이징 팝업 — 구간(키 fromT → 다음 키)의 채널 이징 편집
  const [easePop, setEasePop] = useState<{
    li: number
    ch: KfChannel
    fromT: number
    x: number
    y: number
  } | null>(null)
  // 대상 키가 사라지면(undo·단축키 이동·삭제) 팝업 상태도 정리 — 고아 방지
  useEffect(() => {
    if (!easePop) return
    const lr = sourceData?.layers[easePop.li] as Record<string, unknown> | undefined
    const xkfP = lr ? normKf(lr.xkf as Partial<CustomKf> | undefined) : null
    const alive = xkfP?.keys.some(
      (k) => Math.abs(k.t - easePop.fromT) < 0.5 && k[easePop.ch] !== undefined,
    )
    if (!alive) setEasePop(null)
  }, [sourceData, easePop])

  if (!sourceData?.layers.length) return null
  const layers = sourceData.layers
  const idx = Math.min(customIdx, layers.length - 1)
  const OP = sourceData.op // 컴프 길이 — 재생 길이 변경과 무관하게 클립은 절대 프레임
  const sec = (f: number) => ((f / OP) * totalSec).toFixed(2)
  const pct = (f: number) => `${(f / OP) * 100}%`

  // 눈금자 — ms 단위 적응형 간격 (Figma Motion 방식)
  const totalMs = totalSec * 1000
  const tickStep =
    [100, 200, 250, 500, 1000, 2000, 5000].find((s) => totalMs / s <= 12) ?? 5000
  const ticks: number[] = []
  for (let m = 0; m <= totalMs - tickStep * 0.4; m += tickStep) ticks.push(m)

  const selOf = (li: number): CustomSel =>
    normSel((layers[li] as Record<string, unknown>).xsel as Partial<CustomSel> | undefined, OP)

  const beginDrag = (e: React.PointerEvent, li: number, mode: DragMode) => {
    e.stopPropagation()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    setPlaying(false) // 편집은 파킹 프레임 기준 (AE 방식)
    setCustomIdx(li) // 잡은 레이어 선택 — 이후 라이브 편집 대상
    const spans = animSpans(selOf(li), OP)
    drag.current = {
      li,
      mode,
      startX: e.clientX,
      clipA: spans.clipA,
      clipB: spans.clipB,
      inDur: spans.inEnd - spans.inStart,
      outDur: spans.clipB - spans.outStart,
      pxPerF: rect.width / OP,
    }
    // 드래그 중 커서 고정 — 클립이 포인터를 늦게 따라와도 깜빡이지 않게
    setDragCursor(mode === 'move' ? 'grabbing' : 'ew')
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const df = (e.clientX - d.startX) / d.pxPerF
    const cur = selOf(d.li)
    // 스냅 — 눈금(¼)·양끝·플레이헤드·다른 레이어 클립 모서리
    const targets = [0, OP * 0.25, OP * 0.5, OP * 0.75, OP, frameFrac * OP]
    layers.forEach((_, oi) => {
      if (oi === d.li) return
      const os = animSpans(selOf(oi), OP)
      targets.push(os.clipA, os.clipB)
    })
    const snap = (v: number) => {
      let best = v
      let bd = 1.8
      for (const g of targets) {
        const dd = Math.abs(v - g)
        if (dd < bd) {
          bd = dd
          best = g
        }
      }
      return best
    }
    const len = d.clipB - d.clipA
    const next = { ...cur }
    if (d.mode === 'move') {
      // 키프레임 레이어의 몸통 이동은 키도 함께 (AE 방식)
      const kfMove = normKf(
        (layers[d.li] as Record<string, unknown>).xkf as Partial<CustomKf> | undefined,
      ).on
      if (len >= OP - 0.1) {
        // 풀 길이 클립 — 몸통 드래그를 시작 지연으로 해석 (끝 고정)
        let a = Math.max(0, Math.min(OP - 8, d.clipA + df))
        a = Math.max(0, Math.min(OP - 8, snap(a)))
        setDragInfo(`시작 ${sec(a)}s (끝 고정)`)
        if (kfMove) {
          moveKfClipLive(Math.round(a * 10) / 10, OP, a - d.clipA)
          return
        }
        next.clip = [Math.round(a * 10) / 10, OP]
      } else {
        let a = Math.max(0, Math.min(OP - len, d.clipA + df))
        const s1 = snap(a)
        const s2 = snap(a + len) - len
        a = Math.abs(s1 - a) <= Math.abs(s2 - a) ? s1 : s2
        a = Math.max(0, Math.min(OP - len, a))
        setDragInfo(`클립 ${sec(a)}s ~ ${sec(a + len)}s`)
        if (kfMove) {
          moveKfClipLive(Math.round(a * 10) / 10, Math.round((a + len) * 10) / 10, a - d.clipA)
          return
        }
        next.clip = [Math.round(a * 10) / 10, Math.round((a + len) * 10) / 10]
      }
    } else if (d.mode === 'left') {
      let a = Math.max(0, Math.min(d.clipB - 8, d.clipA + df))
      a = Math.max(0, Math.min(d.clipB - 8, snap(a)))
      next.clip = [Math.round(a * 10) / 10, d.clipB]
      setDragInfo(`시작 ${sec(a)}s`)
    } else if (d.mode === 'right') {
      let b = Math.min(OP, Math.max(d.clipA + 8, d.clipB + df))
      b = Math.min(OP, Math.max(d.clipA + 8, snap(b)))
      next.clip = [d.clipA, Math.round(b * 10) / 10]
      setDragInfo(`끝 ${sec(b)}s`)
    } else if (d.mode === 'in-edge') {
      const dur = Math.max(4, Math.min(d.clipB - d.outDur - d.clipA, d.inDur + df))
      next.in = { ...cur.in, dur: Math.round(dur * 10) / 10 }
      setDragInfo(`등장 길이 ${sec(dur)}s`)
    } else {
      const dur = Math.max(4, Math.min(d.clipB - d.clipA - d.inDur, d.outDur - df))
      next.out = { ...cur.out, dur: Math.round(dur * 10) / 10 }
      setDragInfo(`퇴장 길이 ${sec(dur)}s`)
    }
    setCustomChannelsLive(next)
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    setDragInfo(null)
    setDragCursor(null)
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    commitEdit()
  }

  const cancelDrag = () => {
    if (!drag.current) return
    drag.current = null
    setDragInfo(null)
    setDragCursor(null)
    commitEdit()
  }

  /** 모든 키프레임 레이어의 키 시각 — ⇧ 스크럽 스냅 대상. */
  const kfSnapTargets = (): number[] => {
    const ts: number[] = []
    for (const l of layers) {
      const x = normKf((l as Record<string, unknown>).xkf as Partial<CustomKf> | undefined)
      if (x.on) for (const k of x.keys) ts.push(k.t)
    }
    return ts
  }

  const scrubTo = (clientX: number, snap = false) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    let f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * OP
    if (snap) {
      // ⇧ — 가까운 키프레임에 흡착 (화면 8px 반경)
      const tol = (8 / rect.width) * OP
      let best: { d: number; t: number } | null = null
      for (const t of kfSnapTargets()) {
        const d = Math.abs(t - f)
        if (d < tol && (!best || d < best.d)) best = { d, t }
      }
      if (best) f = best.t
    }
    onScrub(f / OP, false)
  }

  const sameKf = (a: KfSelItem, li: number, ch: KfChannel, t: number) =>
    a.li === li && a.ch === ch && Math.abs(a.t - t) < 0.5

  /** 마키 종료 — 박스와 교차하는 다이아몬드를 선택으로 (⇧ = 기존 선택에 추가). */
  const finishMarquee = (x0: number, y0: number, x1: number, y1: number, additive: boolean) => {
    const els = trackRef.current?.querySelectorAll('[data-kfd]')
    let L = Math.min(x0, x1)
    let R = Math.max(x0, x1)
    let T = Math.min(y0, y1)
    let B = Math.max(y0, y1)
    // 스크롤로 화면 밖에 있는 다이아몬드는 제외 — 보이는 영역으로 클램프
    const body = trackRef.current?.parentElement
    const br = body?.getBoundingClientRect()
    if (br) {
      L = Math.max(L, br.left)
      R = Math.min(R, br.right)
      T = Math.max(T, br.top)
      B = Math.min(B, br.bottom)
    }
    const items: KfSelItem[] = additive ? [...useEditor.getState().kfSel] : []
    els?.forEach((el) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      if (cx >= L && cx <= R && cy >= T && cy <= B) {
        const [pli, pch, pt] = (el.getAttribute('data-kfd') ?? '').split('|')
        const it = { li: Number(pli), ch: pch as KfChannel, t: Number(pt) }
        if (!items.some((a) => sameKf(a, it.li, it.ch, it.t))) items.push(it)
      }
    })
    setKfSel(items)
  }

  /** ⇧ 스냅과 같은 대상 — 드래그 중 키 스냅용 (선택 자신 제외). */
  const kfDragSnapTargets = (items: KfSelItem[]): number[] => {
    const ts: number[] = [Math.round(frameFrac * OP)] // 플레이헤드
    for (let li = 0; li < layers.length; li++) {
      const x = normKf((layers[li] as Record<string, unknown>).xkf as Partial<CustomKf> | undefined)
      if (!x.on) continue
      for (const k of x.keys) {
        if (!items.some((it) => it.li === li && Math.abs(it.t - k.t) < 0.5)) ts.push(k.t)
      }
    }
    return ts
  }

  /**
   * 키 드래그 시작 — 창 레벨 리스너 사용.
   * (라이브 이동으로 다이아몬드가 리마운트되면 요소 포인터 캡처가 끊기므로 요소에 안 건다)
   */
  const beginKfKeyDrag = (e: React.PointerEvent, items: KfSelItem[], label: string, grabT: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    kfDrag.current = { items, startX: e.clientX, pxPerF: rect.width / OP, lastDt: 0 }
    setDragCursor('ew') // 다이아몬드가 리마운트돼도 커서 유지
    const snapTs = kfDragSnapTargets(items)
    const snapTol = (8 / rect.width) * OP // 화면 8px
    const move = (ev: PointerEvent) => {
      const d = kfDrag.current
      if (!d) return
      let dt = (ev.clientX - d.startX) / d.pxPerF
      // 잡은 키를 플레이헤드·다른 키에 스냅 — ⌘로 해제
      if (!ev.metaKey && !ev.ctrlKey) {
        let best: { diff: number; t: number } | null = null
        for (const t of snapTs) {
          const diff = Math.abs(grabT + dt - t)
          if (diff < snapTol && (!best || diff < best.diff)) best = { diff, t }
        }
        if (best) dt = best.t - grabT
      }
      const applied = moveKfKeysLive(d.items, dt)
      if (applied !== null) d.lastDt = applied // 실제 적용된 오프셋만 신뢰
      setDragInfo(
        d.items.length > 1
          ? `키 ${d.items.length}개 이동`
          : `${label} 키 ${sec(Math.max(0, Math.min(OP, grabT + (applied ?? d.lastDt))))}s`,
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      endKfDrag()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /** 키 그룹 드래그 종료 — 커밋 후 선택을 실제 적용된 오프셋으로 갱신. */
  const endKfDrag = () => {
    const d0 = kfDrag.current
    kfDrag.current = null
    setDragInfo(null)
    setDragCursor(null)
    commitEdit()
    if (!d0) return
    // lastDt는 moveKfKeysLive가 실제로 적용한 값만 담는다 (거부된 틱 제외)
    const d = d0.lastDt
    const s = useEditor.getState()
    const moved = d0.items
      .map((it) => ({ ...it, t: it.t + d }))
      .filter((it) => {
        const lr = s.sourceData?.layers[it.li] as Record<string, unknown> | undefined
        if (!lr) return false
        const x = normKf(lr.xkf as Partial<CustomKf> | undefined)
        return x.keys.some((k) => Math.abs(k.t - it.t) < 0.5 && k[it.ch] !== undefined)
      })
    setKfSel(moved)
  }

  // 스크럽 — 눈금자·플레이헤드 전용 (트랙 빈 곳은 마키 선택)
  const scrubHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (useEditor.getState().kfSel.length) setKfSel([])
      scrubbing.current = true
      setDragCursor('ew') // 플레이헤드가 늦게 따라와도 커서 유지
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      scrubTo(e.clientX, e.shiftKey)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (scrubbing.current) scrubTo(e.clientX, e.shiftKey)
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!scrubbing.current) return
      scrubbing.current = false
      setDragCursor(null)
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      onScrub(0, true)
    },
    onPointerCancel: () => {
      if (!scrubbing.current) return
      scrubbing.current = false
      setDragCursor(null)
      onScrub(0, true)
    },
  }

  // 마키 — 트랙 영역 빈 곳(행 배경·아래 여백) 어디서든 드래그로 키 선택 (AE 방식)
  const marqueeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const t = e.target as HTMLElement
      const empty =
        t === e.currentTarget ||
        t.classList.contains('timeline__track') ||
        t.classList.contains('timeline__trackgroup')
      if (!empty) return
      // ⇧ 마키 = 기존 선택에 추가 — 시작할 때 지우지 않는다
      if (!e.shiftKey && useEditor.getState().kfSel.length) setKfSel([])
      setPlaying(false)
      marquee.current = { sx: e.clientX, sy: e.clientY }
      setDragCursor('cross')
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const m = marquee.current
      if (!m) return
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      setMarqueeBox({
        x: Math.min(m.sx, e.clientX) - rect.left,
        y: Math.min(m.sy, e.clientY) - rect.top,
        w: Math.abs(e.clientX - m.sx),
        h: Math.abs(e.clientY - m.sy),
      })
    },
    onPointerUp: (e: React.PointerEvent) => {
      const m = marquee.current
      if (!m) return
      marquee.current = null
      setMarqueeBox(null)
      setDragCursor(null)
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      finishMarquee(m.sx, m.sy, e.clientX, e.clientY, e.shiftKey)
    },
    onPointerCancel: () => {
      marquee.current = null
      setMarqueeBox(null)
      setDragCursor(null)
    },
  }

  return (
    <div className="timeline">
      {/* 높이 조절 핸들 — 위로 끌면 타임라인이 커진다 */}
      <div
        className="timeline__hresize"
        title="드래그: 타임라인 높이 · 더블클릭: 초기화"
        onPointerDown={beginHResize}
        onDoubleClick={resetH}
      />
      <div className="timeline__head">
        <span className="timeline__title">타임라인</span>
        <span className="timeline__time">
          {String(Math.round(frameFrac * totalMs)).padStart(4, '0')} /{' '}
          {Math.round(totalMs)} ms
        </span>
        {kfSel.length > 0 && (
          <span className="timeline__selbadge">키 {kfSel.length}개 선택 — 드래그 이동 · Delete 삭제</span>
        )}
        <span className="timeline__hint">
          {dragInfo ??
            '빈 곳 드래그: 키 선택 · 눈금자: 스크럽 (⇧ 스냅) · 클립: 이동/트림 · ◇ 더블클릭: 삭제'}
        </span>
      </div>
      <div className="timeline__body timeline__body--multi" style={{ height: bodyH }}>
        <div className="timeline__labels">
          <div className="timeline__label timeline__label--ruler" />
          {layers.map((l, li) => {
            const lr = l as Record<string, unknown>
            const xkfL = normKf(lr.xkf as Partial<CustomKf> | undefined)
            const open = xkfL.on && !collapsed.has(li)
            return (
              <div key={li} className="timeline__labelgroup">
                <div
                  className={`timeline__label timeline__label--row ${
                    li === idx && customIdxs.includes(li) ? 'timeline__label--on' : ''
                  } ${li !== idx && customIdxs.includes(li) ? 'timeline__label--multi' : ''}`}
                  style={
                    customIdxs.includes(li)
                      ? { boxShadow: `inset 2.5px 0 0 ${layerColor(lr, li)}` }
                      : undefined
                  }
                  title={String(l.nm ?? '')}
                  onClick={() => setCustomIdx(li)}
                >
                  {xkfL.on ? (
                    <button
                      className="timeline__twirl"
                      title={open ? '프로퍼티 접기' : '프로퍼티 펼치기'}
                      onClick={(e) => {
                        e.stopPropagation()
                        setCollapsed((prev) => {
                          const n = new Set(prev)
                          if (n.has(li)) n.delete(li)
                          else n.add(li)
                          return n
                        })
                      }}
                    >
                      {open ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="timeline__twirl timeline__twirl--none" />
                  )}
                  <span className="colordot" style={{ background: layerColor(lr, li) }} />
                  {l.nm ?? `레이어 ${li + 1}`}
                </div>
                {open &&
                  KF_CHANNELS.filter(({ ch }) => kfChannelKeys(xkfL, ch).length > 0).map(
                    ({ ch, label }) => {
                    const keys = kfChannelKeys(xkfL, ch)
                    const hasAt = keys.some((k) => Math.abs(k.t - curFrame) < 0.5)
                    return (
                      <div key={ch} className="timeline__label timeline__label--prop">
                        <button
                          className={`timeline__propkey ${hasAt ? 'timeline__propkey--on' : ''}`}
                          title={hasAt ? '재생헤드의 키 제거' : '재생헤드에 키 추가'}
                          onClick={(e) => {
                            e.stopPropagation()
                            setCustomIdx(li)
                            if (hasAt) {
                              removeKfChannel(ch, curFrame)
                            } else {
                              const xb: [number, number] = Array.isArray(lr.xbase)
                                ? [(lr.xbase as number[])[0], (lr.xbase as number[])[1]]
                                : [256, 256]
                              const fb = kfFallbackValue(ch, selOf(li), xb)
                              setKfChannel(ch, curFrame, kfValueAt(xkfL, ch, curFrame, fb))
                            }
                          }}
                        >
                          ◆
                        </button>
                        {label}
                        {keys.length > 0 && <em className="timeline__propcount">{keys.length}</em>}
                      </div>
                    )
                  })}
              </div>
            )
          })}
        </div>
        <div className="timeline__tracks" ref={trackRef} {...marqueeHandlers}>
          {/* 눈금자 줄 — 스크럽 전용, ms 눈금 (Figma Motion 방식) */}
          <div className="timeline__ruler" {...scrubHandlers}>
            {ticks.map((m) => (
              <span key={m} className="timeline__ticklabel" style={{ left: `${(m / totalMs) * 100}%` }}>
                {m}
              </span>
            ))}
          </div>
          {ticks.slice(1).map((m) => (
            <div key={m} className="timeline__tick" style={{ left: `${(m / totalMs) * 100}%` }} />
          ))}
          {/* 플레이헤드 */}
          <div
            className="timeline__playhead"
            style={{ left: `${frameFrac * 100}%` }}
            // 스크럽 로직은 눈금자와 공유 — stopPropagation만 추가 (마키로 안 새게)
            onPointerDown={(e) => {
              e.stopPropagation()
              scrubHandlers.onPointerDown(e)
            }}
            onPointerMove={scrubHandlers.onPointerMove}
            onPointerUp={scrubHandlers.onPointerUp}
            onPointerCancel={scrubHandlers.onPointerCancel}
          >
            <div className="timeline__playhead-head" />
          </div>

          {/* 마키 선택 박스 */}
          {marqueeBox && (
            <div
              className="timeline__marquee"
              style={{
                left: marqueeBox.x,
                top: marqueeBox.y,
                width: marqueeBox.w,
                height: marqueeBox.h,
              }}
            />
          )}

          {/* 레이어별 클립 행 */}
          {layers.map((l, li) => {
            const sel = selOf(li)
            const spans = animSpans(sel, OP)
            const clipLen = spans.clipB - spans.clipA
            const segPct = (f: number) => `${(f / clipLen) * 100}%`
            const xkf = normKf((l as Record<string, unknown>).xkf as Partial<CustomKf> | undefined)
            const kfOn = xkf.on
            const inOn = !kfOn && sel.in.type > 0
            const loopOn = !kfOn && sel.loop.type > 0
            const outOn = !kfOn && sel.out.type > 0
            const inW = spans.inEnd - spans.inStart
            const outW = spans.clipB - spans.outStart
            const hidden = (l as Record<string, unknown>).hd === true
            const color = layerColor(l as Record<string, unknown>, li)
            const isPrimary = li === idx && customIdxs.includes(li)
            const isMulti = li !== idx && customIdxs.includes(li)
            const open = kfOn && !collapsed.has(li)
            return (
              <div key={li} className="timeline__trackgroup">
              <div
                className={`timeline__track timeline__track--slots ${hidden ? 'timeline__track--hidden' : ''} ${
                  isPrimary || isMulti ? 'timeline__track--sel' : ''
                }`}
              >
                <div
                  className={`timeline__clip ${isPrimary ? 'timeline__clip--on' : ''} ${
                    isMulti ? 'timeline__clip--multi' : ''
                  }`}
                  style={{
                    left: pct(spans.clipA),
                    width: pct(clipLen),
                    background: tint(color, isPrimary ? 0.55 : isMulti ? 0.4 : 0.22),
                    borderColor: isPrimary ? '#fff' : tint(color, isMulti ? 0.95 : 0.6),
                    boxShadow: isPrimary ? `0 0 0 1.5px ${tint(color, 0.65)}, 0 0 10px ${tint(color, 0.5)}` : undefined,
                  }}
                  onPointerDown={(e) => beginDrag(e, li, 'move')}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={cancelDrag}
                >
                  {inOn && (
                    <div
                      className="timeline__seg timeline__seg--in timeline__seg--drag"
                      title="드래그: 등장 길이"
                      style={{ left: 0, width: segPct(inW) }}
                      onPointerDown={(e) => beginDrag(e, li, 'in-edge')}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={cancelDrag}
                    >
                      <span className="timeline__barlabel">등장</span>
                    </div>
                  )}
                  {loopOn && spans.outStart - spans.inEnd > 4 && (
                    <div
                      className="timeline__seg timeline__seg--loop"
                      style={{
                        left: segPct(spans.inEnd - spans.clipA),
                        width: segPct(spans.outStart - spans.inEnd),
                      }}
                    >
                      <span className="timeline__barlabel">루프</span>
                    </div>
                  )}
                  {outOn && (
                    <div
                      className="timeline__seg timeline__seg--out timeline__seg--drag"
                      title="드래그: 퇴장 길이"
                      style={{ left: segPct(spans.outStart - spans.clipA), width: segPct(outW) }}
                      onPointerDown={(e) => beginDrag(e, li, 'out-edge')}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={cancelDrag}
                    >
                      <span className="timeline__barlabel">퇴장</span>
                    </div>
                  )}
                  {!inOn && !loopOn && !outOn && (
                    <span className="timeline__barlabel timeline__barlabel--dim">
                      {kfOn
                        ? xkf.keys.length
                          ? `키 ${xkf.keys.length}개${open ? '' : ' — ▸ 펼쳐서 편집'}`
                          : '키프레임 없음'
                        : (l.nm ?? `레이어 ${li + 1}`)}
                    </span>
                  )}
                  <div
                    className="timeline__edge timeline__edge--l"
                    onPointerDown={(e) => beginDrag(e, li, 'left')}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={cancelDrag}
                  />
                  <div
                    className="timeline__edge timeline__edge--r"
                    onPointerDown={(e) => beginDrag(e, li, 'right')}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={cancelDrag}
                  />
                </div>
              </div>
              {/* 프로퍼티 레인 — 키가 있는 채널만 (AE 'U' 방식). 라벨 쪽과 같은 필터로 행 정렬 유지 */}
              {open &&
                KF_CHANNELS.filter(({ ch }) => kfChannelKeys(xkf, ch).length > 0).map(
                  ({ ch, label }) => {
                  const keys = kfChannelKeys(xkf, ch)
                  const first = keys[0]
                  const last = keys[keys.length - 1]
                  return (
                    <div key={ch} className="timeline__track timeline__track--prop">
                      {keys.length >= 2 && (
                        <div
                          className="timeline__proplink"
                          style={{
                            left: pct(first.t),
                            width: `${((last.t - first.t) / OP) * 100}%`,
                          }}
                        />
                      )}
                      {/* 구간 이징 버튼 — 키 사이 중앙의 작대기. 클릭: 커브 팝업 */}
                      {keys.slice(0, -1).map((k, ki) => {
                        const nk = keys[ki + 1]
                        const mid = (k.t + nk.t) / 2
                        const bez = segEaseOf(xkf, k, ch)
                        return (
                          <button
                            key={`e${k.t}`}
                            className="timeline__ease"
                            title={`${label} 이징 (${bez.join(', ')}) — 클릭해서 커브 편집`}
                            style={{ left: pct(mid) }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              setCustomIdx(li)
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setEasePop({ li, ch, fromT: k.t, x: r.left + r.width / 2, y: r.top })
                            }}
                          >
                            <svg width="8" height="8" viewBox="0 0 8 8">
                              <path d="M1 7C3 7 5 1 7 1" stroke="currentColor" fill="none" strokeWidth="1.4" />
                            </svg>
                          </button>
                        )
                      })}
                      {keys.map((k) => {
                        const isSel = kfSel.some((a) => sameKf(a, li, ch, k.t))
                        return (
                          <div
                            key={`${ch}${k.t}`}
                            data-kfd={`${li}|${ch}|${k.t}`}
                            className={`timeline__kf timeline__kf--prop ${isSel ? 'timeline__kf--sel' : ''}`}
                            title={`${label} · ${sec(k.t)}s — 드래그: 이동 (선택은 그룹째) · ⇧클릭: 선택 토글 · 더블클릭: 삭제`}
                            style={{ left: pct(k.t) }}
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              setCustomIdx(li)
                              removeKfChannel(ch, k.t)
                            }}
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              setPlaying(false)
                              setCustomIdx(li)
                              // ⇧클릭 — 선택 토글 (드래그 없음)
                              if (e.shiftKey) {
                                const cur = useEditor.getState().kfSel
                                setKfSel(
                                  isSel
                                    ? cur.filter((a) => !sameKf(a, li, ch, k.t))
                                    : [...cur, { li, ch, t: k.t }],
                                )
                                return
                              }
                              // 선택된 키를 잡으면 그룹째, 아니면 단독 (선택 교체)
                              const items: KfSelItem[] =
                                isSel && kfSel.length > 1 ? kfSel : [{ li, ch, t: k.t }]
                              if (!(isSel && kfSel.length > 1)) setKfSel(items)
                              beginKfKeyDrag(e, items, label, k.t)
                            }}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* 이징 커브 팝업 — 포털 (타임라인 overflow에 안 잘리게) */}
      {easePop &&
        (() => {
          const lr = layers[easePop.li] as Record<string, unknown> | undefined
          if (!lr) return null
          const xkfP = normKf(lr.xkf as Partial<CustomKf> | undefined)
          const key = xkfP.keys.find(
            (k) => Math.abs(k.t - easePop.fromT) < 0.5 && k[easePop.ch] !== undefined,
          )
          if (!key) return null
          const bez = segEaseOf(xkfP, key, easePop.ch)
          return createPortal(
            <EasingPopover
              bez={bez}
              x={easePop.x}
              y={easePop.y}
              chLabel={KF_CHANNELS.find((c) => c.ch === easePop.ch)?.label ?? ''}
              onLive={(b) => setKfSegEaseLive(easePop.ch, easePop.fromT, b)}
              onDragEnd={commitEdit}
              onPreset={(b) => setKfSegEase(easePop.ch, easePop.fromT, b)}
              onSpring={(i) => {
                bakeSpringSegEase(easePop.ch, easePop.fromT, i)
                setEasePop(null) // 구간이 여러 키로 쪼개짐 — 팝업 대상이 사라진다
              }}
              onClose={() => setEasePop(null)}
            />,
            document.body,
          )
        })()}
    </div>
  )
}

/** 이징 커브 편집 팝업 — 프리셋 + 베지어 핸들 드래그 + 수치 입력 (Figma Motion식). */
function EasingPopover({
  bez,
  x,
  y,
  chLabel,
  onLive,
  onDragEnd,
  onPreset,
  onSpring,
  onClose,
}: {
  bez: Bezier4
  x: number
  y: number
  chLabel: string
  onLive: (b: Bezier4) => void
  onDragEnd: () => void
  onPreset: (b: Bezier4) => void
  onSpring: (presetIdx: number) => void
  onClose: () => void
}) {
  const W = 248
  const H = 470 // 토큰·스프링 섹션 포함 실측 높이 근사 — 뷰포트 클램프용
  // 뷰포트 클램프 — 버튼 위쪽 우선, 안 되면 아래
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, x - W / 2))
  const top = y - H - 10 > 8 ? y - H - 10 : Math.min(window.innerHeight - H - 8, y + 18)

  // 커브 영역 — x∈[0,1], y∈[-0.25,1.25] (오버슛 여유)
  const CW = 216
  const CH = 170
  const PAD = 10
  const iw = CW - PAD * 2
  const ih = CH - PAD * 2
  const X = (v: number) => PAD + v * iw
  const Y = (v: number) => PAD + ((1.25 - v) / 1.5) * ih
  const fromPx = (px: number, py: number): [number, number] => [
    Math.max(0, Math.min(1, (px - PAD) / iw)),
    Math.max(-0.25, Math.min(1.25, 1.25 - ((py - PAD) / ih) * 1.5)),
  ]
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<0 | 1 | null>(null)
  const [draft, setDraft] = useState<string | null>(null)

  // Escape = 팝업 닫기 (입력 중이면 각 인풋이 stopPropagation으로 입력 취소만)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // 이징 토큰 — 현재 커브를 이름 붙여 저장, 클릭으로 재적용 (Creator 2.0 Motion Tokens 벤치)
  const [tokens, setTokens] = useState<EaseToken[]>(loadEaseTokens)
  const [naming, setNaming] = useState<string | null>(null)
  const commitToken = (raw: string) => {
    const name = raw.trim() || `토큰 ${tokens.length + 1}`
    const next = [...tokens.filter((t) => t.name !== name), { name, bez: [...bez] as Bezier4 }]
    setTokens(next)
    saveEaseTokens(next)
    setNaming(null)
  }
  const removeToken = (name: string) => {
    const next = tokens.filter((t) => t.name !== name)
    setTokens(next)
    saveEaseTokens(next)
  }

  const isPreset = (p: Bezier4) => p.every((v, i) => Math.abs(v - bez[i]) < 0.005)

  const handleMove = (e: React.PointerEvent) => {
    if (dragging.current === null) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const [nx, ny] = fromPx(e.clientX - rect.left, e.clientY - rect.top)
    const next: Bezier4 = [...bez]
    if (dragging.current === 0) {
      next[0] = Math.round(nx * 100) / 100
      next[1] = Math.round(ny * 100) / 100
    } else {
      next[2] = Math.round(nx * 100) / 100
      next[3] = Math.round(ny * 100) / 100
    }
    onLive(next)
  }

  return (
    <>
      <div className="easepop__backdrop" onClick={onClose} />
      <div className="easepop" style={{ left, top, width: W }}>
        <div className="easepop__head">
          <span>이징 · {chLabel}</span>
          <button className="easepop__close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="knob__chips" style={{ marginBottom: 8 }}>
          {EASE_PRESETS.map((p) => (
            <button
              key={p.label}
              className={`chip ${isPreset(p.bez) ? 'chip--on' : ''}`}
              onClick={() => onPreset(p.bez)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <svg
          ref={svgRef}
          className="easepop__curve"
          width={CW}
          height={CH}
          onPointerMove={handleMove}
          onPointerUp={(e) => {
            if (dragging.current === null) return
            dragging.current = null
            ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
            onDragEnd()
          }}
          onPointerCancel={() => {
            dragging.current = null
            onDragEnd()
          }}
        >
          {/* 0/1 기준선 */}
          <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(0)} className="easepop__grid" />
          <line x1={X(0)} y1={Y(1)} x2={X(1)} y2={Y(1)} className="easepop__grid" />
          {/* 핸들 연결선 */}
          <line x1={X(0)} y1={Y(0)} x2={X(bez[0])} y2={Y(bez[1])} className="easepop__arm" />
          <line x1={X(1)} y1={Y(1)} x2={X(bez[2])} y2={Y(bez[3])} className="easepop__arm" />
          {/* 커브 */}
          <path
            d={`M ${X(0)} ${Y(0)} C ${X(bez[0])} ${Y(bez[1])}, ${X(bez[2])} ${Y(bez[3])}, ${X(1)} ${Y(1)}`}
            className="easepop__path"
          />
          {/* 끝점 */}
          <circle cx={X(0)} cy={Y(0)} r={3} className="easepop__end" />
          <circle cx={X(1)} cy={Y(1)} r={3} className="easepop__end" />
          {/* 드래그 핸들 */}
          {([0, 1] as const).map((hi) => (
            <circle
              key={hi}
              cx={X(bez[hi === 0 ? 0 : 2])}
              cy={Y(bez[hi === 0 ? 1 : 3])}
              r={6}
              className="easepop__handle"
              onPointerDown={(e) => {
                e.stopPropagation()
                dragging.current = hi
                ;(e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId)
              }}
            />
          ))}
        </svg>
        <input
          className="easepop__vals"
          value={draft ?? bez.map((v) => Math.round(v * 100) / 100).join(', ')}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null) {
              const nums = draft.split(/[,\s]+/).map(Number)
              if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
                const b: Bezier4 = [
                  Math.max(0, Math.min(1, nums[0])),
                  Math.max(-2, Math.min(3, nums[1])),
                  Math.max(0, Math.min(1, nums[2])),
                  Math.max(-2, Math.min(3, nums[3])),
                ]
                onPreset(b)
              }
            }
            setDraft(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              if (draft !== null) e.stopPropagation()
              setDraft(null)
            }
          }}
          spellCheck={false}
        />
        <p className="knob__note">핸들을 끌거나 cubic-bezier 값 직접 입력. 이 구간에만 적용.</p>
        {/* 이징 토큰 — 내 커브 저장·재사용, 프로젝트를 넘어 유지 */}
        <div className="knob__head" style={{ marginTop: 8 }}>
          <span className="knob__name">내 토큰</span>
        </div>
        <div className="knob__chips">
          {tokens.map((t) => (
            <button
              key={t.name}
              className={`chip easetoken ${isPreset(t.bez) ? 'chip--on' : ''}`}
              title={t.bez.map((v) => Math.round(v * 100) / 100).join(', ')}
              onClick={() => onPreset(t.bez)}
            >
              {t.name}
              <span
                className="easetoken__x"
                title="토큰 삭제"
                onClick={(e) => {
                  e.stopPropagation()
                  removeToken(t.name)
                }}
              >
                ×
              </span>
            </button>
          ))}
          {naming === null ? (
            <button className="chip" onClick={() => setNaming('')}>
              ＋ 저장
            </button>
          ) : (
            <input
              className="easetoken__name"
              autoFocus
              value={naming}
              placeholder={`토큰 ${tokens.length + 1}`}
              onChange={(e) => setNaming(e.target.value)}
              onBlur={() => setNaming(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitToken(naming)
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setNaming(null)
                }
              }}
              spellCheck={false}
            />
          )}
        </div>
        {/* 스프링 — 단일 베지어로 불가능한 감쇠 진동을 구간 키로 굽는다 (Creator 2.0 벤치) */}
        <div className="knob__head" style={{ marginTop: 8 }}>
          <span className="knob__name">스프링으로 굽기</span>
        </div>
        <div className="knob__chips">
          {SPRING_PRESETS.map((p, i) => (
            <button key={p.label} className="chip" onClick={() => onSpring(i)}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="knob__note">이 구간을 스프링 모션 키들로 대체합니다 — 되돌리기는 ⌘Z.</p>
      </div>
    </>
  )
}
