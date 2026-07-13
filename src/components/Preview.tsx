import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import { durationSec, parseLottie, type LottieJson } from '../lib/lottieUtils'
import { svgToLottie, readImageFile } from '../lib/svgImport'
import type { CustomPayload } from '../lib/customBuilder'
import LottiePlayer from './LottiePlayer'
import MockupView from './MockupView'
import Timeline from './Timeline'

/** 문서에서 레이어 i의 기준 위치 (첫 키프레임 또는 정적 값). */
function layerBaseOf(doc: LottieJson, i: number): [number, number] | null {
  const layer = doc.layers[i] as (Record<string, unknown> & { ks?: unknown }) | undefined
  if (!layer) return null
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

/** 앵커 오프셋 — 시각적 중심 = 기준위치(p) + 이 값. (회전은 근사 무시) */
function layerCenterOffsetOf(doc: LottieJson, i: number): [number, number] {
  const layer = doc.layers[i] as Record<string, unknown> | undefined
  if (!layer) return [0, 0]
  const a = (((layer.ks as Record<string, unknown>)?.a as { k?: number[] })?.k as number[]) ?? [0, 0]
  const asset = (doc.assets as Record<string, unknown>[] | undefined)?.find(
    (x) => x.id === layer.refId,
  )
  // 이미지: 중심 = (w/2, h/2), SVG: 중심 = 원점
  if (asset) return [(asset.w as number) / 2 - a[0], (asset.h as number) / 2 - a[1]]
  return [-a[0], -a[1]]
}

/** 문서에서 레이어 i의 반폭/반높이 — 이미지는 에셋 크기, SVG는 bbox×스케일. */
function layerHalfOf(doc: LottieJson, i: number): [number, number] {
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

export default function Preview() {
  const {
    animationData, playing, speed, loop, bg, replayToken, templateId,
    setPlaying, setSpeed, setLoop, setBg, load, replay, nudgeCustomBase, setCustomIdx,
    addCustomLayer,
  } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const [frame, setFrame] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [seek, setSeek] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [mode, setMode] = useState<'canvas' | 'mockup'>('canvas')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 커스텀 빌더 위치 드래그 — 드래그 중엔 CSS 이동(재로드 없음), 놓을 때 1회 커밋.
  // 스냅: 캔버스 중앙(256)/가장자리(0,512)에 8px 흡착, Alt 누르면 해제.
  const wrapRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{
    x: number; y: number; bx: number; by: number; f: number; hw: number; hh: number
    ox: number; oy: number
  } | null>(null)
  const dragLast = useRef<{ tx: number; ty: number } | null>(null)
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null })
  const [dragCoord, setDragCoord] = useState<{ x: number; y: number } | null>(null)
  const [dragBox, setDragBox] = useState<{ x: number; y: number; hw: number; hh: number } | null>(
    null,
  )
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  // 빈 곳을 누르고 있는 동안 모든 레이어 영역 표시
  const [showAllBoxes, setShowAllBoxes] = useState(false)
  const lastPick = useRef<{ x: number; y: number; pick: number } | null>(null)
  const resizeDrag = useRef<{
    f: number; bx: number; by: number; startSize: number; startDist: number
  } | null>(null)
  // 캔버스 드래그 라이브 반영 — rAF 스로틀 (임베드 이미지 재계산 비용 완화)
  const liveRaf = useRef<number | null>(null)
  const pendingBase = useRef<[number, number] | null>(null)
  const flushLiveBase = () => {
    liveRaf.current = null
    const b = pendingBase.current
    if (b) {
      pendingBase.current = null
      useEditor.getState().setCustomBaseLive(b[0], b[1])
    }
  }

  // 툴 + 뷰포트 (팬/줌)
  const [tool, setTool] = useState<'move' | 'hand'>('move')
  const [zoom, setZoom] = useState(1)
  const [pan, setPanState] = useState({ x: 0, y: 0 })
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const handActive = tool === 'hand'

  // 템플릿 전환 시 뷰포트 리셋
  useEffect(() => {
    setZoom(1)
    setPanState({ x: 0, y: 0 })
    setTool('move')
  }, [templateId])

  // 커스텀: 재생 = 프리뷰 모드 (루프 on), 정지 = 편집 모드 (루프 off)
  const previewing = templateId === '__custom' && playing
  useEffect(() => {
    if (templateId === '__custom') setLoop(playing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, templateId])

  // 단축키: V 이동 / H 핸드 / Space 홀드 임시 핸드 (커스텀 모드에서만)
  useEffect(() => {
    if (templateId !== '__custom') return
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const s = useEditor.getState()
      if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey) setTool('move')
      else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) setTool('hand')
      else if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setZoom(1)
        setPanState({ x: 0, y: 0 })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // 선택 레이어 삭제
        e.preventDefault()
        const n = s.sourceData?.layers.length ?? 0
        if (n) s.removeCustomLayer(Math.min(s.customIdx, n - 1))
      } else if (e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey)) {
        // 복제
        e.preventDefault()
        const n = s.sourceData?.layers.length ?? 0
        if (n) s.duplicateCustomLayer(Math.min(s.customIdx, n - 1))
      } else if (e.key.startsWith('Arrow')) {
        // 방향키 넛지 — 1px, Shift = 10px
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (dx || dy) s.nudgeCustomBase(dx, dy)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [templateId])

  // 휠: ⌘/Ctrl+휠 = 줌 (캔버스 중심 기준), 휠 = 팬 — 비수동 리스너로 페이지 스크롤 차단
  useEffect(() => {
    const el = canvasRef.current
    if (!el || templateId !== '__custom') return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) {
        // 커서 기준 줌 — 커서 아래 지점이 화면에서 고정되도록 팬 보정
        setZoom((z) => {
          const z2 = Math.min(4, Math.max(0.25, z * (1 - e.deltaY * 0.01)))
          const rect = wrapRef.current?.getBoundingClientRect()
          if (rect) {
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            setPanState((p) => ({
              x: p.x + ((z - z2) * (e.clientX - cx)) / z,
              y: p.y + ((z - z2) * (e.clientY - cy)) / z,
            }))
          }
          return z2
        })
      } else {
        setPanState((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [templateId])

  // 선택 박스 — 드래그 중엔 커서 따라, 평소엔 선택 레이어 위치 (sourceData 구독으로 반응)
  // 프리뷰(재생) 중에는 표시하지 않는다
  let selBox: { x: number; y: number; hw: number; hh: number } | null = previewing ? null : dragBox
  if (!selBox && !previewing && templateId === '__custom' && sourceData?.layers.length) {
    const i = Math.min(customIdx, sourceData.layers.length - 1)
    const b = layerBaseOf(sourceData, i)
    if (b) {
      const [hw, hh] = layerHalfOf(sourceData, i)
      const [ox, oy] = layerCenterOffsetOf(sourceData, i)
      selBox = { x: b[0] + ox, y: b[1] + oy, hw, hh }
    }
  }

  // 호버 박스 — 선택될 레이어 미리 표시 (선택된 레이어와 같으면 생략)
  let hoverBox: { x: number; y: number; hw: number; hh: number } | null = null
  if (
    hoverIdx !== null &&
    !dragBox &&
    !previewing &&
    templateId === '__custom' &&
    sourceData?.layers[hoverIdx] &&
    hoverIdx !== Math.min(customIdx, sourceData.layers.length - 1)
  ) {
    const b = layerBaseOf(sourceData, hoverIdx)
    if (b) {
      const [hw, hh] = layerHalfOf(sourceData, hoverIdx)
      const [ox, oy] = layerCenterOffsetOf(sourceData, hoverIdx)
      hoverBox = { x: b[0] + ox, y: b[1] + oy, hw, hh }
    }
  }

  // 레이어 i의 기준 위치/반크기 — 선택·드래그·스냅·히트테스트 공용
  const layerBase = (i: number): [number, number] | null => {
    const s = useEditor.getState()
    if (s.templateId !== '__custom' || !s.sourceData) return null
    return layerBaseOf(s.sourceData, i)
  }

  const layerHalf = (i: number): [number, number] => {
    const s = useEditor.getState()
    return s.sourceData ? layerHalfOf(s.sourceData, i) : [60, 60]
  }

  /** 포인터 아래 모든 레이어 — 위(배열 앞)→아래 순. */
  const hitLayers = (px: number, py: number): number[] => {
    const s = useEditor.getState()
    const n = s.sourceData?.layers.length ?? 0
    const hits: number[] = []
    for (let i = 0; i < n; i++) {
      const b = layerBase(i)
      if (!b || !s.sourceData) continue
      const [hw, hh] = layerHalf(i)
      const [ox, oy] = layerCenterOffsetOf(s.sourceData, i)
      if (Math.abs(px - b[0] - ox) <= hw && Math.abs(py - b[1] - oy) <= hh) hits.push(i)
    }
    return hits
  }

  /**
   * 프로급 선택 — 기본은 최상위 레이어. 같은 자리(4px 내)를 다시 클릭하면
   * 겹친 스택에서 한 단계 아래로 순환 (딥 셀렉트).
   */
  const pickLayer = (px: number, py: number): number | null => {
    const hits = hitLayers(px, py)
    if (!hits.length) return null
    const last = lastPick.current
    let pick = hits[0]
    if (
      last &&
      Math.hypot(px - last.x, py - last.y) < 4 &&
      hits.includes(last.pick) &&
      hits.length > 1
    ) {
      pick = hits[(hits.indexOf(last.pick) + 1) % hits.length]
    }
    lastPick.current = { x: px, y: py, pick }
    return pick
  }

  /** 축 스냅 — 중심점은 중앙/쿼터/가장자리, 외곽 모서리는 중앙/가장자리에 흡착.
   *  snapDist = 캔버스 단위 흡착 거리 (화면 10px 기준 — 줌 배율 반영해서 전달). */
  const snapAxis = (
    t: number,
    half: number,
    snapDist: number,
  ): { shift: number; guide: number } | null => {
    const CENTER_TARGETS = [256, 0, 128, 384, 512]
    const EDGE_TARGETS = [0, 256, 512]
    let best: { d: number; shift: number; guide: number } | null = null
    const consider = (val: number, targets: number[]) => {
      for (const g of targets) {
        const d = Math.abs(val - g)
        if (d < snapDist && (!best || d < best.d)) best = { d, shift: g - val, guide: g }
      }
    }
    consider(t, CENTER_TARGETS)
    consider(t - half, EDGE_TARGETS)
    consider(t + half, EDGE_TARGETS)
    return best
  }

  const onFrame = useCallback((f: number, total: number) => {
    setFrame(f)
    setTotalFrames(total)
  }, [])

  const openFile = (file: File) => {
    file.text().then((text) => {
      try {
        load(parseLottie(text), file.name)
      } catch (e) {
        alert((e as Error).message)
      }
    })
  }

  /** 그래픽 파일이면 커스텀 레이어로 — 드롭 지점에 배치. JSON은 문서 열기. */
  const dropGraphic = async (file: File, clientX: number, clientY: number) => {
    let payload: CustomPayload
    if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
      payload = { kind: 'svg', graphic: svgToLottie(await file.text()) }
    } else {
      payload = { kind: 'image', image: await readImageFile(file) }
    }
    const name = file.name.replace(/\.[^.]+$/, '') || 'graphic'
    const first =
      useEditor.getState().templateId !== '__custom' || !useEditor.getState().sourceData
    // 드롭 지점 → 캔버스 좌표 (세션 생성 전 rect 기준 — 새 세션이면 중앙 유지)
    const rect = wrapRef.current?.getBoundingClientRect()
    addCustomLayer(payload, name)
    if (first) useEditor.getState().setFileName(name)
    if (rect) {
      const f = 512 / rect.width
      const px = Math.max(0, Math.min(512, (clientX - rect.left) * f))
      const py = Math.max(0, Math.min(512, (clientY - rect.top) * f))
      nudgeCustomBase(px - 256, py - 256)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const isGraphic =
      /\.(svg|png|jpe?g|webp)$/i.test(file.name) ||
      /^image\/(svg\+xml|png|jpeg|webp)$/.test(file.type)
    if (isGraphic) {
      dropGraphic(file, e.clientX, e.clientY).catch((err) => alert((err as Error).message))
    } else {
      openFile(file)
    }
  }

  return (
    <div
      className={`preview ${dragOver ? 'preview--drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {animationData && (
        <div className="preview__modebar">
          <div className="segment segment--compact">
            <button
              className={`segment__btn ${mode === 'canvas' ? 'segment__btn--on' : ''}`}
              onClick={() => setMode('canvas')}
            >
              미리보기
            </button>
            <button
              className={`segment__btn ${mode === 'mockup' ? 'segment__btn--on' : ''}`}
              onClick={() => setMode('mockup')}
            >
              사용 예시
            </button>
          </div>
        </div>
      )}

      <div
        ref={canvasRef}
        className={`preview__canvas preview__canvas--${mode === 'mockup' ? 'dark' : bg} ${
          handActive && templateId === '__custom' && mode === 'canvas' ? 'preview__canvas--hand' : ''
        }`}
        onPointerDown={(e) => {
          // 핸드 툴 — 캔버스 어디서든 팬
          if (templateId !== '__custom' || mode !== 'canvas' || !handActive) return
          panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = panDrag.current
          if (!d) return
          setPanState({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
        }}
        onPointerUp={() => {
          panDrag.current = null
        }}
      >
        {templateId === '__custom' && mode === 'canvas' && (
          <div className="canvastools">
            <button
              className={`canvastools__btn ${tool === 'move' ? 'canvastools__btn--on' : ''}`}
              title="이동 툴 (V)"
              onClick={() => setTool('move')}
            >
              ⭢
            </button>
            <button
              className={`canvastools__btn ${handActive ? 'canvastools__btn--on' : ''}`}
              title="핸드 툴 (H)"
              onClick={() => setTool('hand')}
            >
              ✋
            </button>
            <span className="canvastools__zoom">{Math.round(zoom * 100)}%</span>
            <button
              className="canvastools__btn"
              title="100% / 중앙 (⌘0)"
              onClick={() => {
                setZoom(1)
                setPanState({ x: 0, y: 0 })
              }}
            >
              ⊡
            </button>
          </div>
        )}
        {animationData ? (
          mode === 'mockup' ? (
            <MockupView />
          ) : (
            <div
              ref={wrapRef}
              className="preview__lottie preview__lottiewrap"
              style={
                templateId === '__custom'
                  ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }
                  : undefined
              }
            >
              {/* 드래그 이동은 내부 래퍼에만 — 가이드/오버레이는 고정 좌표 유지 */}
              <div ref={innerRef} className="preview__lottiefill">
                <LottiePlayer
                  data={animationData}
                  playing={playing}
                  speed={speed}
                  loop={loop}
                  onFrame={onFrame}
                  seekFrame={seek}
                  replayToken={replayToken}
                  onComplete={() => setPlaying(false)}
                  className="preview__lottiefill"
                />
              </div>
              <span className="canvasbadge">
                {animationData.w} × {animationData.h}
              </span>
              {templateId === '__custom' && (
                <>
                  {guides.v !== null && (
                    <div className="snapguide snapguide--v" style={{ left: `${(guides.v / 512) * 100}%` }}>
                      <span className="snapguide__label">{guides.v}</span>
                    </div>
                  )}
                  {guides.h !== null && (
                    <div className="snapguide snapguide--h" style={{ top: `${(guides.h / 512) * 100}%` }}>
                      <span className="snapguide__label">{guides.h}</span>
                    </div>
                  )}
                  {dragCoord && (
                    <div className="dragcoord">
                      X {Math.round(dragCoord.x)} · Y {Math.round(dragCoord.y)}
                    </div>
                  )}
                  {hoverBox && (
                    <div
                      className="hoverbox"
                      style={{
                        left: `${((hoverBox.x - hoverBox.hw) / 512) * 100}%`,
                        top: `${((hoverBox.y - hoverBox.hh) / 512) * 100}%`,
                        width: `${((hoverBox.hw * 2) / 512) * 100}%`,
                        height: `${((hoverBox.hh * 2) / 512) * 100}%`,
                      }}
                    />
                  )}
                  {selBox && (
                    <div
                      className="selbox"
                      style={{
                        left: `${((selBox.x - selBox.hw) / 512) * 100}%`,
                        top: `${((selBox.y - selBox.hh) / 512) * 100}%`,
                        width: `${((selBox.hw * 2) / 512) * 100}%`,
                        height: `${((selBox.hh * 2) / 512) * 100}%`,
                      }}
                    >
                      {!handActive &&
                        (['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                          <div
                            key={c}
                            className={`selhandle selhandle--${c}`}
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              const rect = wrapRef.current?.getBoundingClientRect()
                              const st = useEditor.getState()
                              const li = Math.min(
                                st.customIdx,
                                (st.sourceData?.layers.length ?? 1) - 1,
                              )
                              const layer = st.sourceData?.layers[li] as
                                | Record<string, unknown>
                                | undefined
                              const startSize =
                                ((layer?.xsel as { size?: number } | undefined)?.size ?? 240)
                              const b = layerBase(li)
                              if (!rect || !b) return
                              resizeDrag.current = {
                                f: 512 / rect.width,
                                bx: b[0], by: b[1],
                                startSize,
                                startDist: Math.max(
                                  8,
                                  Math.hypot(
                                    (e.clientX - rect.left) * (512 / rect.width) - b[0],
                                    (e.clientY - rect.top) * (512 / rect.width) - b[1],
                                  ),
                                ),
                              }
                              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                            }}
                            onPointerMove={(e) => {
                              const d = resizeDrag.current
                              const rect = wrapRef.current?.getBoundingClientRect()
                              if (!d || !rect) return
                              const dist = Math.hypot(
                                (e.clientX - rect.left) * d.f - d.bx,
                                (e.clientY - rect.top) * d.f - d.by,
                              )
                              const px = Math.round(
                                Math.min(480, Math.max(20, (d.startSize * dist) / d.startDist)),
                              )
                              useEditor.getState().setCustomSizeLive(px)
                            }}
                            onPointerUp={(e) => {
                              if (!resizeDrag.current) return
                              resizeDrag.current = null
                              ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                              useEditor.getState().commitEdit()
                            }}
                          />
                        ))}
                    </div>
                  )}
                  {showAllBoxes &&
                    !previewing &&
                    sourceData?.layers.map((_, i) => {
                      const b = layerBaseOf(sourceData, i)
                      if (!b) return null
                      const [hw, hh] = layerHalfOf(sourceData, i)
                      const [cox, coy] = layerCenterOffsetOf(sourceData, i)
                      return (
                        <div
                          key={i}
                          className="allbox"
                          style={{
                            left: `${((b[0] + cox - hw) / 512) * 100}%`,
                            top: `${((b[1] + coy - hh) / 512) * 100}%`,
                            width: `${((hw * 2) / 512) * 100}%`,
                            height: `${((hh * 2) / 512) * 100}%`,
                          }}
                        />
                      )
                    })}
                  {!handActive && (
                    <div
                      className={`customdrag ${hoverIdx !== null || dragBox ? 'customdrag--overlayer' : ''}`}
                      title="클릭: 레이어 선택 (같은 자리 재클릭: 아래 레이어) · 드래그: 이동 (Alt: 스냅 해제)"
                      onPointerDown={(e) => {
                        const rect = wrapRef.current?.getBoundingClientRect()
                        if (!rect) return
                        const f = 512 / rect.width
                        const px = (e.clientX - rect.left) * f
                        const py = (e.clientY - rect.top) * f
                        // 프리뷰 중 클릭 → 편집 모드로 복귀 (정지 + 박스 표시)
                        if (useEditor.getState().playing) setPlaying(false)
                        const hit = pickLayer(px, py)
                        if (hit === null) {
                          // 빈 곳 프레스 — 누르고 있는 동안 모든 레이어 영역 표시
                          setShowAllBoxes(true)
                          e.currentTarget.setPointerCapture(e.pointerId)
                          return
                        }
                        setCustomIdx(hit)
                        setHoverIdx(null)
                        const base = layerBase(hit)
                        if (!base) return
                        const [hw, hh] = layerHalf(hit)
                        const src2 = useEditor.getState().sourceData
                        const [cox, coy] = src2 ? layerCenterOffsetOf(src2, hit) : [0, 0]
                        dragStart.current = {
                          x: e.clientX, y: e.clientY, bx: base[0], by: base[1], f, hw, hh,
                          ox: cox, oy: coy,
                        }
                        dragLast.current = { tx: base[0], ty: base[1] }
                        setDragCoord({ x: base[0], y: base[1] })
                        e.currentTarget.setPointerCapture(e.pointerId)
                      }}
                      onPointerMove={(e) => {
                        const d = dragStart.current
                        if (!d) {
                          // 호버 하이라이트 — 선택될 레이어 미리 표시
                          const rect = wrapRef.current?.getBoundingClientRect()
                          if (!rect) return
                          const f = 512 / rect.width
                          const hits = hitLayers(
                            (e.clientX - rect.left) * f,
                            (e.clientY - rect.top) * f,
                          )
                          setHoverIdx(hits.length ? hits[0] : null)
                          return
                        }
                        let tx = d.bx + (e.clientX - d.x) * d.f
                        let ty = d.by + (e.clientY - d.y) * d.f
                        let gv: number | null = null
                        let gh: number | null = null
                        if (!e.altKey) {
                          // 화면 10px 기준 흡착 — 시각적 중심/모서리 기준 (앵커 오프셋 반영)
                          const snapDist = 10 * d.f
                          const sx = snapAxis(tx + d.ox, d.hw, snapDist)
                          if (sx) { tx += sx.shift; gv = sx.guide }
                          const sy = snapAxis(ty + d.oy, d.hh, snapDist)
                          if (sy) { ty += sy.shift; gh = sy.guide }
                        }
                        setGuides({ v: gv, h: gh })
                        setDragCoord({ x: tx, y: ty })
                        setDragBox({ x: tx + d.ox, y: ty + d.oy, hw: d.hw, hh: d.hh })
                        dragLast.current = { tx, ty }
                        // AE식 라이브 미리보기 — 파킹 프레임 기준으로 실시간 갱신
                        pendingBase.current = [tx, ty]
                        if (liveRaf.current === null)
                          liveRaf.current = requestAnimationFrame(flushLiveBase)
                      }}
                      onPointerLeave={() => {
                        if (!dragStart.current) setHoverIdx(null)
                      }}
                      onPointerUp={(e) => {
                        setShowAllBoxes(false)
                        const d = dragStart.current
                        const last = dragLast.current
                        dragStart.current = null
                        dragLast.current = null
                        setGuides({ v: null, h: null })
                        setDragCoord(null)
                        setDragBox(null)
                        e.currentTarget.releasePointerCapture(e.pointerId)
                        if (liveRaf.current !== null) {
                          cancelAnimationFrame(liveRaf.current)
                          liveRaf.current = null
                        }
                        if (!d || !last) return
                        // 마지막 위치 반영 후 히스토리 1회 커밋
                        useEditor.getState().setCustomBaseLive(last.tx, last.ty)
                        useEditor.getState().commitEdit()
                      }}
                    />
                  )}
                </>
              )}
            </div>
          )
        ) : (
          <div className="preview__empty">
            <p className="preview__empty-title">로티를 선택하거나 파일을 끌어다 놓으세요</p>
            <p className="preview__empty-sub">왼쪽 템플릿 클릭 · JSON 드래그앤드롭</p>
            <button className="btn btn--secondary" onClick={() => fileInputRef.current?.click()}>
              JSON 파일 열기
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) openFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {animationData && (
        <div className="playbar">
          <button
            className="btn btn--icon"
            onClick={() => setPlaying(!playing)}
            title={playing ? '일시정지 (Space)' : '재생 (Space)'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="btn btn--icon" onClick={replay} title="처음부터 재생 (루프 끄면 1회 재생)">
            ⟲
          </button>

          {mode === 'canvas' ? (
            <>
              <input
                className="playbar__scrub"
                type="range"
                min={0}
                max={Math.max(1, totalFrames)}
                step={0.01}
                value={frame}
                onChange={(e) => {
                  setPlaying(false)
                  setSeek(Number(e.target.value))
                }}
                // 포인터(마우스/터치/펜)와 키보드 조작 종료 모두에서 시크 모드 해제
                onPointerUp={() => setSeek(null)}
                onKeyUp={() => setSeek(null)}
              />
              <span className="playbar__time">
                {Math.round(frame)} / {Math.round(totalFrames)}f · {durationSec(animationData).toFixed(1)}s
              </span>
            </>
          ) : (
            <span className="playbar__spacer" />
          )}

          <div className="playbar__group">
            {[0.25, 0.5, 1, 1.5, 2].map((s) => (
              <button
                key={s}
                className={`chip ${speed === s ? 'chip--on' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>

          <button className={`chip ${loop ? 'chip--on' : ''}`} onClick={() => setLoop(!loop)}>
            루프
          </button>

          {mode === 'canvas' && (
            <div className="playbar__group">
              {(['checker', 'dark', 'light'] as const).map((b) => (
                <button
                  key={b}
                  className={`bgdot bgdot--${b} ${bg === b ? 'bgdot--on' : ''}`}
                  onClick={() => setBg(b)}
                  title={`배경: ${b}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {templateId === '__custom' && mode === 'canvas' && animationData && (
        <Timeline
          frameFrac={totalFrames ? frame / totalFrames : 0}
          totalSec={durationSec(animationData)}
          onScrub={(frac, done) => {
            if (done) {
              setSeek(null)
            } else {
              setPlaying(false)
              setSeek(frac * Math.max(1, totalFrames))
            }
          }}
        />
      )}
    </div>
  )
}
