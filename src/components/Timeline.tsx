import { useRef, useState } from 'react'
import { useEditor } from '../store'
import {
  CUSTOM_OP,
  DEFAULT_SEL,
  nativePosDur,
  nativeScaleDur,
  nativeFadeDur,
  type CustomSel,
} from '../lib/customBuilder'

type WinKey = 'posWin' | 'scaleWin' | 'fadeWin'

/**
 * 커스텀 빌더 타임라인 — 선택 레이어의 포지션/스케일/오퍼시티 액션 구간을
 * 프리미어처럼 밀고(바 드래그) 당겨서(모서리 트림) 순서를 만든다.
 * 빈 트랙/눈금 클릭·드래그 = 스크럽, 바 이동·트림은 눈금/타 채널 모서리에 스냅.
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
  const { setCustomChannelsLive, commitEdit, setPlaying } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    key: WinKey
    mode: 'move' | 'left' | 'right'
    startX: number
    st: number
    dur: number
    pxPerF: number
  } | null>(null)
  const scrubbing = useRef(false)
  const [dragInfo, setDragInfo] = useState<[number, number] | null>(null)

  if (!sourceData?.layers.length) return null
  const idx = Math.min(customIdx, sourceData.layers.length - 1)
  const layer = sourceData.layers[idx] as Record<string, unknown> & { nm?: string }
  const xsel: CustomSel = { ...DEFAULT_SEL, ...((layer.xsel as Partial<CustomSel>) ?? {}) }

  const chans: { key: WinKey; label: string; native: number }[] = [
    { key: 'posWin', label: '포지션', native: nativePosDur(xsel.pos) },
    { key: 'scaleWin', label: '스케일', native: nativeScaleDur(xsel) },
    { key: 'fadeWin', label: '오퍼시티', native: nativeFadeDur(xsel) },
  ]

  const winOf = (key: WinKey, native: number): [number, number] =>
    (xsel[key] as [number, number] | undefined) ?? [0, native]

  const sec = (f: number) => ((f / CUSTOM_OP) * totalSec).toFixed(2)

  /** 스냅 대상 — 눈금(¼) + 양끝 + 다른 채널 모서리 + 플레이헤드. */
  const snapTargets = (except: WinKey): number[] => {
    const t = [0, CUSTOM_OP * 0.25, CUSTOM_OP * 0.5, CUSTOM_OP * 0.75, CUSTOM_OP,
      frameFrac * CUSTOM_OP]
    for (const c of chans) {
      if (c.key === except || !c.native) continue
      const [s, d] = winOf(c.key, c.native)
      t.push(s, s + d)
    }
    return t
  }

  const snap = (v: number, targets: number[], dist = 1.8): number => {
    let best = v
    let bd = dist
    for (const g of targets) {
      const d = Math.abs(v - g)
      if (d < bd) {
        bd = d
        best = g
      }
    }
    return best
  }

  const beginDrag = (
    e: React.PointerEvent,
    key: WinKey,
    mode: 'move' | 'left' | 'right',
    native: number,
  ) => {
    e.stopPropagation()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    // 재생 중 편집 시작 → 일시정지 (AE 방식 — 파킹 프레임 기준 라이브 미리보기)
    setPlaying(false)
    const [st, dur] = winOf(key, native)
    drag.current = { key, mode, startX: e.clientX, st, dur, pxPerF: rect.width / CUSTOM_OP }
    setDragInfo([st, dur])
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const df = (e.clientX - d.startX) / d.pxPerF
    const targets = snapTargets(d.key)
    let st = d.st
    let dur = d.dur
    if (d.mode === 'move') {
      st = Math.max(0, Math.min(CUSTOM_OP - dur, d.st + df))
      // 시작·끝 모서리 중 가까운 쪽 스냅
      const s1 = snap(st, targets)
      const s2 = snap(st + dur, targets) - dur
      if (Math.abs(s1 - st) <= Math.abs(s2 - st)) st = s1
      else st = s2
      st = Math.max(0, Math.min(CUSTOM_OP - dur, st))
    } else if (d.mode === 'left') {
      let newSt = Math.max(0, Math.min(d.st + d.dur - 4, d.st + df))
      newSt = Math.max(0, Math.min(d.st + d.dur - 4, snap(newSt, targets)))
      dur = d.dur + (d.st - newSt)
      st = newSt
    } else {
      let end = d.st + Math.max(4, Math.min(CUSTOM_OP - d.st, d.dur + df))
      end = Math.min(CUSTOM_OP, Math.max(d.st + 4, snap(end, targets)))
      dur = end - d.st
    }
    const win: [number, number] = [Math.round(st * 10) / 10, Math.round(dur * 10) / 10]
    setDragInfo(win)
    setCustomChannelsLive({ ...xsel, [d.key]: win })
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    setDragInfo(null)
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    commitEdit()
  }

  // 빈 영역 클릭/드래그 = 스크럽
  const scrubTo = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onScrub(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), false)
  }

  return (
    <div className="timeline">
      <div className="timeline__head">
        <span className="timeline__title">타임라인 — {layer.nm ?? '레이어'}</span>
        <span className="timeline__hint">
          {dragInfo
            ? `시작 ${sec(dragInfo[0])}s · 길이 ${sec(dragInfo[1])}s`
            : '바 드래그: 시점 이동 · 모서리: 길이 · 빈 곳: 스크럽'}
        </span>
      </div>
      <div className="timeline__body">
        <div className="timeline__labels">
          <div className="timeline__label timeline__label--ruler" />
          {chans.map((c) => (
            <div key={c.key} className="timeline__label">
              {c.label}
            </div>
          ))}
        </div>
        <div
          className="timeline__tracks"
          ref={trackRef}
          onPointerDown={(e) => {
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
        >
          {/* 눈금자 줄 — 스크럽 전용 (AE 타임 룰러) */}
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
          {/* 플레이헤드 — 머리를 잡고 직접 드래그 가능 */}
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
          >
            <div className="timeline__playhead-head" />
          </div>
          {chans.map((c) => {
            const active = c.native > 0
            const [st, dur] = winOf(c.key, c.native)
            return (
              <div key={c.key} className="timeline__track">
                {active ? (
                  <div
                    className="timeline__bar"
                    style={{
                      left: `${(st / CUSTOM_OP) * 100}%`,
                      width: `${(dur / CUSTOM_OP) * 100}%`,
                    }}
                    onPointerDown={(e) => beginDrag(e, c.key, 'move', c.native)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                  >
                    <div
                      className="timeline__edge timeline__edge--l"
                      onPointerDown={(e) => beginDrag(e, c.key, 'left', c.native)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                    />
                    <div
                      className="timeline__edge timeline__edge--r"
                      onPointerDown={(e) => beginDrag(e, c.key, 'right', c.native)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                    />
                  </div>
                ) : (
                  <span className="timeline__empty">—</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
