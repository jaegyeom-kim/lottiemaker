import { useRef, useState } from 'react'
import { useEditor } from '../store'
import { animSpans, normSel, layerColor, tint, type CustomSel } from '../lib/customBuilder'

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
  const { setCustomChannelsLive, commitEdit, setPlaying, setCustomIdx } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
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

  if (!sourceData?.layers.length) return null
  const layers = sourceData.layers
  const idx = Math.min(customIdx, layers.length - 1)
  const OP = sourceData.op // 컴프 길이 — 재생 길이 변경과 무관하게 클립은 절대 프레임
  const sec = (f: number) => ((f / OP) * totalSec).toFixed(2)
  const pct = (f: number) => `${(f / OP) * 100}%`

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
      if (len >= OP - 0.1) {
        // 풀 길이 클립 — 몸통 드래그를 시작 지연으로 해석 (끝 고정)
        let a = Math.max(0, Math.min(OP - 8, d.clipA + df))
        a = Math.max(0, Math.min(OP - 8, snap(a)))
        next.clip = [Math.round(a * 10) / 10, OP]
        setDragInfo(`시작 ${sec(a)}s (끝 고정)`)
      } else {
        let a = Math.max(0, Math.min(OP - len, d.clipA + df))
        const s1 = snap(a)
        const s2 = snap(a + len) - len
        a = Math.abs(s1 - a) <= Math.abs(s2 - a) ? s1 : s2
        a = Math.max(0, Math.min(OP - len, a))
        next.clip = [Math.round(a * 10) / 10, Math.round((a + len) * 10) / 10]
        setDragInfo(`클립 ${sec(a)}s ~ ${sec(a + len)}s`)
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
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    commitEdit()
  }

  const cancelDrag = () => {
    if (!drag.current) return
    drag.current = null
    setDragInfo(null)
    commitEdit()
  }

  const scrubTo = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onScrub(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), false)
  }

  const scrubHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      scrubbing.current = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      scrubTo(e.clientX)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (scrubbing.current) scrubTo(e.clientX)
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!scrubbing.current) return
      scrubbing.current = false
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      onScrub(0, true)
    },
    onPointerCancel: () => {
      if (!scrubbing.current) return
      scrubbing.current = false
      onScrub(0, true)
    },
  }

  return (
    <div className="timeline">
      <div className="timeline__head">
        <span className="timeline__title">타임라인</span>
        <span className="timeline__hint">
          {dragInfo ?? '클립 드래그: 시간 이동 · 모서리: 트림 · 등장/퇴장 바: 길이 · 빈 곳: 스크럽'}
        </span>
      </div>
      <div className="timeline__body timeline__body--multi">
        <div className="timeline__labels">
          <div className="timeline__label timeline__label--ruler" />
          {layers.map((l, li) => (
            <div
              key={li}
              className={`timeline__label timeline__label--row ${li === idx ? 'timeline__label--on' : ''}`}
              title={String(l.nm ?? '')}
              onClick={() => setCustomIdx(li)}
            >
              <span
                className="colordot"
                style={{ background: layerColor(l as Record<string, unknown>, li) }}
              />
              {l.nm ?? `레이어 ${li + 1}`}
            </div>
          ))}
        </div>
        <div className="timeline__tracks" ref={trackRef} {...scrubHandlers}>
          {/* 눈금자 줄 — 스크럽 전용 */}
          <div className="timeline__ruler">
            {[0.25, 0.5, 0.75].map((f) => (
              <span key={f} className="timeline__ticklabel" style={{ left: `${f * 100}%` }}>
                {(f * totalSec).toFixed(2)}s
              </span>
            ))}
          </div>
          {[0.25, 0.5, 0.75].map((f) => (
            <div key={f} className="timeline__tick" style={{ left: `${f * 100}%` }} />
          ))}
          {/* 플레이헤드 */}
          <div
            className="timeline__playhead"
            style={{ left: `${frameFrac * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation()
              scrubbing.current = true
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              scrubTo(e.clientX)
            }}
            onPointerMove={(e) => {
              if (scrubbing.current) scrubTo(e.clientX)
            }}
            onPointerUp={(e) => {
              if (!scrubbing.current) return
              scrubbing.current = false
              ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
              onScrub(0, true)
            }}
            onPointerCancel={() => {
              if (!scrubbing.current) return
              scrubbing.current = false
              onScrub(0, true)
            }}
          >
            <div className="timeline__playhead-head" />
          </div>

          {/* 레이어별 클립 행 */}
          {layers.map((l, li) => {
            const sel = selOf(li)
            const spans = animSpans(sel, OP)
            const clipLen = spans.clipB - spans.clipA
            const segPct = (f: number) => `${(f / clipLen) * 100}%`
            const inOn = sel.in.type > 0
            const loopOn = sel.loop.type > 0
            const outOn = sel.out.type > 0
            const inW = spans.inEnd - spans.inStart
            const outW = spans.clipB - spans.outStart
            const hidden = (l as Record<string, unknown>).hd === true
            const color = layerColor(l as Record<string, unknown>, li)
            return (
              <div
                key={li}
                className={`timeline__track timeline__track--slots ${hidden ? 'timeline__track--hidden' : ''}`}
              >
                <div
                  className={`timeline__clip ${li === idx ? 'timeline__clip--on' : ''}`}
                  style={{
                    left: pct(spans.clipA),
                    width: pct(clipLen),
                    background: tint(color, 0.28),
                    borderColor: li === idx ? undefined : tint(color, 0.75),
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
                      {l.nm ?? `레이어 ${li + 1}`}
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
            )
          })}
        </div>
      </div>
    </div>
  )
}
