import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor } from '../store'
import { durationSec, parseLottie, type LottieJson } from '../lib/lottieUtils'
import { svgToLottie, readImageFile } from '../lib/svgImport'
import {
  layerHalfOf, layerCenterOffsetOf, layerColor, tint, normKf, kfValueAt,
  kfChannelKeys, normSel, animSpans,
  type CustomPayload, type CustomKf, type CustomSel, type KfChannel,
} from '../lib/customBuilder'
import LottiePlayer from './LottiePlayer'
import MockupView from './MockupView'
import Timeline from './Timeline'
import AnchorControls from './AnchorControls'

/** 문서에서 레이어 i의 기준 위치 (첫 키프레임 또는 정적 값). atFrame = 키프레임 모드 보간 시각. */
function layerBaseOf(doc: LottieJson, i: number, atFrame?: number): [number, number] | null {
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

export default function Preview() {
  const {
    animationData, playing, speed, loop, bg, replayToken, templateId,
    setPlaying, setSpeed, setLoop, setBg, load, replay, setCustomIdx,
    addCustomLayer,
  } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const customIdxs = useEditor((s) => s.customIdxs)
  // 전역 작업 모드 (템플릿/커스텀) — 아래 로컬 mode(canvas/mockup)와 다른 값
  const appMode = useEditor((s) => s.mode)
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
  // 앵커 팝오버 — 선택 박스 옆 픽토그램 클릭으로 토글
  const [anchorPop, setAnchorPop] = useState(false)
  useEffect(() => {
    setAnchorPop(false)
  }, [customIdx, templateId])
  const setCurFrame = useEditor((s) => s.setCurFrame)
  const jumpToken = useEditor((s) => s.jumpToken)
  // 재생 중 실제 프레임 — 단축키가 파킹값 대신 눈에 보이는 프레임을 쓰도록
  const frameRef = useRef(0)
  // 진행 중인 점프 목표 — 낡은 시크 에코가 curFrame을 되감는 것 방지
  const pendingJump = useRef<number | null>(null)
  // 파킹 프레임 → 스토어 — 키프레임 모드 자동 키가 찍히는 시각 (재생 중엔 갱신 안 함)
  useEffect(() => {
    if (playing) return
    const f = Math.round(frame)
    if (pendingJump.current !== null) {
      if (f !== pendingJump.current) return // 점프 도착 전의 낡은 프레임 에코 무시
      pendingJump.current = null
    }
    setCurFrame(f)
  }, [playing, frame, setCurFrame])
  // 키 탐색(◀/▶)의 재생헤드 이동 요청 소비
  useEffect(() => {
    if (!jumpToken) return
    pendingJump.current = jumpToken.f
    setPlaying(false)
    setSeek(jumpToken.f)
    const id = setTimeout(() => setSeek(null), 60)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToken])
  const lastPick = useRef<{ x: number; y: number; pick: number } | null>(null)
  const resizeDrag = useRef<{
    f: number; bx: number; by: number; startSize: number; startDist: number
    ox: number; oy: number
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
  const zoomRef = useRef(1)
  zoomRef.current = zoom
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
      if (e.key === 'Escape') {
        setAnchorPop(false)
        if (s.kfSel.length) s.setKfSel([]) // 타임라인 키 선택 해제
        // 진행 중인 드래그/리사이즈 취소 — 시작 시점으로 복원 (PS Esc)
        if (dragStart.current || resizeDrag.current) {
          dragStart.current = null
          dragLast.current = null
          resizeDrag.current = null
          setGuides({ v: null, h: null })
          setDragCoord(null)
          setDragBox(null)
          if (liveRaf.current !== null) {
            cancelAnimationFrame(liveRaf.current)
            liveRaf.current = null
          }
          s.cancelEdit()
        }
      }
      else if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey) setTool('move')
      else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) setTool('hand')
      else if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setZoom(1)
        setPanState({ x: 0, y: 0 })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        // 타임라인 키 선택이 있으면 키 삭제, 아니면 선택 레이어 삭제
        if (s.kfSel.length) s.removeKfKeys(s.kfSel)
        else if (s.customIdxs.length) s.removeCustomLayers(s.customIdxs)
      } else if (e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey)) {
        // 복제 — 선택이 있을 때만 (빈 곳 클릭으로 해제된 상태에서 보이지 않는 레이어 편집 방지)
        e.preventDefault()
        const n = s.sourceData?.layers.length ?? 0
        if (n && s.customIdxs.length) s.duplicateCustomLayer(Math.min(s.customIdx, n - 1))
      } else if (e.key.startsWith('Arrow')) {
        // 방향키 넛지 — 1px, Shift = 10px. 리핏 동안 라이브, 키 떼면 히스토리 1회
        e.preventDefault()
        if (!s.customIdxs.length) return
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (dx || dy) {
          const layer = s.sourceData?.layers[
            Math.min(s.customIdx, (s.sourceData?.layers.length ?? 1) - 1)
          ] as Record<string, unknown> | undefined
          const xb = layer?.xbase as number[] | undefined
          if (xb) s.setCustomBaseLive(xb[0] + dx, xb[1] + dy)
        }
      } else if (
        !e.metaKey &&
        !e.ctrlKey &&
        s.sourceData &&
        // 드래그/라이브 편집 세션 중엔 발동 금지 — 열린 editBaseline을 되감거나 오염시킴
        !dragStart.current &&
        !resizeDrag.current &&
        !s.editBaseline
      ) {
        // ── AE식 타임라인 단축키 ─────────────────────────────
        const op = s.sourceData.op
        const hasSel = s.customIdxs.length > 0
        const li = Math.min(s.customIdx, s.sourceData.layers.length - 1)
        const layer = s.sourceData.layers[li] as Record<string, unknown> | undefined
        const xkf = normKf(layer?.xkf as Partial<CustomKf> | undefined)
        const xsel = normSel(layer?.xsel as Partial<CustomSel> | undefined, op)
        const spans = animSpans(xsel, op)
        const len = spans.clipB - spans.clipA
        const key = e.key.toLowerCase()
        // 유효 재생헤드 — 재생 중엔 눈에 보이는 프레임 (파킹값은 낡았음)
        const cur = s.playing ? Math.round(frameRef.current) : s.curFrame

        // 프레임 스텝 — PgUp/PgDn (Shift = 10f). AE와 동일
        if (e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault()
          const d = (e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 10 : 1)
          s.jumpTo(Math.max(0, Math.min(op, cur + d)))
        }
        // 컴프 시작/끝 — Home/End
        else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault()
          s.jumpTo(e.key === 'Home' ? 0 : op)
        }
        // J/K — 이전/다음 키프레임으로 (선택된 키프레임 레이어에 키가 있으면 그 레이어, 아니면 전체)
        else if ((key === 'j' || key === 'k') && !e.altKey) {
          e.preventDefault()
          const pool: number[] = []
          if (hasSel && xkf.on && xkf.keys.length) {
            for (const k of xkf.keys) pool.push(k.t)
          } else {
            for (const l of s.sourceData.layers) {
              const x = normKf((l as Record<string, unknown>).xkf as Partial<CustomKf> | undefined)
              if (x.on) for (const k of x.keys) pool.push(k.t)
            }
          }
          if (!pool.length) return
          pool.sort((a, b) => a - b)
          const t =
            key === 'j'
              ? [...pool].reverse().find((v) => v < cur - 0.5)
              : pool.find((v) => v > cur + 0.5)
          if (t !== undefined) s.jumpTo(t)
        }
        // I/O — 선택 레이어 인/아웃 포인트로
        else if ((key === 'i' || key === 'o') && !e.altKey && layer && hasSel) {
          e.preventDefault()
          s.jumpTo(key === 'i' ? spans.clipA : spans.clipB)
        }
        // [ / ] — 클립을 재생헤드에 맞춰 이동 (AE: 인/아웃 포인트를 CTI로). 키프레임도 동반
        else if (
          (e.code === 'BracketLeft' || e.code === 'BracketRight') &&
          !e.altKey &&
          layer &&
          hasSel
        ) {
          e.preventDefault()
          if (e.repeat) return
          const a =
            e.code === 'BracketLeft'
              ? Math.max(0, Math.min(op - len, cur))
              : Math.max(0, Math.min(op - len, cur - len))
          if (Math.abs(a - spans.clipA) < 0.01) return
          s.jumpTo(cur) // 일시정지 + 파킹 — 편집 기준 프레임 고정
          if (xkf.on) {
            s.moveKfClipLive(a, a + len, a - spans.clipA)
            s.commitEdit()
          } else {
            s.setCustomChannels({ ...xsel, clip: [a, a + len] })
          }
        }
        // ⌥[ / ⌥] — 재생헤드까지 트림 (키는 제자리, AE와 동일)
        else if (
          (e.code === 'BracketLeft' || e.code === 'BracketRight') &&
          e.altKey &&
          layer &&
          hasSel
        ) {
          e.preventDefault()
          if (e.repeat) return
          const clip: [number, number] =
            e.code === 'BracketLeft'
              ? [Math.max(0, Math.min(cur, spans.clipB - 8)), spans.clipB]
              : [spans.clipA, Math.min(op, Math.max(cur, spans.clipA + 8))]
          // 변화 없으면 히스토리 오염 방지
          if (Math.abs(clip[0] - spans.clipA) < 0.01 && Math.abs(clip[1] - spans.clipB) < 0.01)
            return
          s.jumpTo(cur)
          s.setCustomChannels({ ...xsel, clip })
        }
        // ⌥P/S/R/T — 재생헤드에 채널 키 토글 (AE: Option+P = 위치 키). 키프레임 모드 전용
        else if (
          e.altKey &&
          (e.code === 'KeyP' || e.code === 'KeyS' || e.code === 'KeyR' || e.code === 'KeyT') &&
          xkf.on &&
          layer &&
          hasSel
        ) {
          e.preventDefault()
          if (e.repeat) return
          const ch: KfChannel =
            e.code === 'KeyP' ? 'p' : e.code === 'KeyS' ? 's' : e.code === 'KeyR' ? 'r' : 'o'
          s.jumpTo(cur) // 키가 찍히는 프레임을 눈에 보이는 프레임으로 고정
          const has = kfChannelKeys(xkf, ch).some((k) => Math.abs(k.t - cur) < 0.5)
          if (has) {
            s.removeKfChannel(ch, cur)
          } else {
            const xb: [number, number] = Array.isArray(layer.xbase)
              ? [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
              : [256, 256]
            const fb: number | [number, number] =
              ch === 'p' ? xb : ch === 's' ? 100 : ch === 'r' ? xsel.rotation : xsel.opacity
            s.setKfChannel(ch, cur, kfValueAt(xkf, ch, cur, fb))
          }
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) useEditor.getState().commitEdit()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [templateId])

  // 휠: ⌘/Ctrl+휠 = 줌 (캔버스 중심 기준), 휠 = 팬 — 비수동 리스너로 페이지 스크롤 차단
  useEffect(() => {
    const el = canvasRef.current
    if (!el || templateId !== '__custom') return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) {
        // 커서 기준 줌 — 커서 아래 지점이 화면에서 고정되도록 팬 보정.
        // setState 업데이터 안에서 다른 setState 호출 금지 (StrictMode 이중 실행 시 보정 2배)
        const z = zoomRef.current
        const z2 = Math.min(4, Math.max(0.25, z * (1 - e.deltaY * 0.01)))
        const rect = wrapRef.current?.getBoundingClientRect()
        if (rect && z2 !== z) {
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          setPanState((p) => ({
            x: p.x + ((z - z2) * (e.clientX - cx)) / z,
            y: p.y + ((z - z2) * (e.clientY - cy)) / z,
          }))
        }
        setZoom(z2)
      } else {
        setPanState((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [templateId])

  const idxClamped =
    sourceData?.layers.length ? Math.min(customIdx, sourceData.layers.length - 1) : 0

  // 선택 박스 — 드래그 중엔 커서 따라, 평소엔 선택 레이어 위치 (sourceData 구독으로 반응)
  // 프리뷰(재생) 중·선택 해제 상태에는 표시하지 않는다
  const hasSelection = customIdxs.length > 0
  let selBox: { x: number; y: number; hw: number; hh: number } | null =
    previewing || !hasSelection ? null : dragBox
  if (!selBox && !previewing && hasSelection && templateId === '__custom' && sourceData?.layers.length) {
    const i = Math.min(customIdx, sourceData.layers.length - 1)
    const b = layerBaseOf(sourceData, i, Math.round(frame))
    if (b) {
      const [hw, hh] = layerHalfOf(sourceData, i)
      const [ox, oy] = layerCenterOffsetOf(sourceData, i)
      selBox = { x: b[0] + ox, y: b[1] + oy, hw, hh }
    }
  }
  // 주/보조 선택 박스 스트로크 = 레이어 라벨 컬러
  const primaryColor =
    sourceData?.layers[idxClamped] !== undefined
      ? layerColor(sourceData.layers[idxClamped] as Record<string, unknown>, idxClamped)
      : '#5B8DEF'

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
    const b = layerBaseOf(sourceData, hoverIdx, Math.round(frame))
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
    return layerBaseOf(s.sourceData, i, s.curFrame)
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
      // 숨김 레이어는 클릭/호버 대상에서 제외 (패널에서는 선택 가능)
      if ((s.sourceData?.layers[i] as Record<string, unknown> | undefined)?.hd) continue
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
    frameRef.current = f
    setFrame(f)
    setTotalFrames(total)
  }, [])

  const openFile = (file: File) => {
    file.text().then((text) => {
      try {
        // 프로젝트 세이브 파일 (.lmproj.json) — 세션 복원
        const maybe = JSON.parse(text) as { app?: string; v?: number; sourceData?: unknown }
        if (maybe?.app === 'lottiemaker' && maybe.v === 1 && maybe.sourceData) {
          const s = useEditor.getState()
          // 히스토리 유무가 아니라 작업공간이 비어있지 않으면 확인 — 복원 직후 세션도 보호
          if (
            s.animationData &&
            !window.confirm('현재 작업을 프로젝트 파일 내용으로 교체할까요?')
          )
            return
          s.restoreSession(maybe as Parameters<typeof s.restoreSession>[0])
          return
        }
      } catch {
        // JSON 파싱 실패 → 아래 parseLottie가 에러 메시지 처리
      }
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
    let at: [number, number] | undefined
    if (rect) {
      const f = 512 / rect.width
      at = [
        Math.max(0, Math.min(512, (clientX - rect.left) * f)),
        Math.max(0, Math.min(512, (clientY - rect.top) * f)),
      ]
    }
    addCustomLayer(payload, name, at)
    if (first) useEditor.getState().setFileName(name)
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
      // 그래픽 업로드는 커스텀 전용 — 템플릿 모드에선 확인 후 전환 (템플릿 작업은 보관됨)
      const s = useEditor.getState()
      if (s.mode !== 'custom') {
        if (!window.confirm('그래픽 업로드는 커스텀 기능입니다. 커스텀으로 전환할까요?\n(템플릿 작업은 그대로 보관됩니다)'))
          return
        s.setMode('custom')
      }
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
        // 배경 옵션(체커 등)은 아트보드 내부에만 — 바깥은 항상 페이스트보드
        className={`preview__canvas ${mode === 'mockup' ? 'preview__canvas--dark' : 'preview__canvas--board'} ${
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
        onPointerCancel={() => {
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
              className={`preview__lottie preview__lottiewrap preview__lottiewrap--${bg}`}
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
                  {selBox && !dragBox && (
                    <>
                      <button
                        className="anchorbtn"
                        title="앵커 포인트 조절"
                        style={{
                          left: `${((selBox.x + selBox.hw) / 512) * 100}%`,
                          top: `${((selBox.y - selBox.hh) / 512) * 100}%`,
                          transform: `translate(4px, -100%) scale(${1 / zoom})`,
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          setAnchorPop((v) => !v)
                        }}
                      >
                        ⌖
                      </button>
                      {anchorPop &&
                        (() => {
                          // 포털 + 화면 좌표 — 캔버스 overflow에 안 잘리고 항상 전부 보이게
                          const rect = wrapRef.current?.getBoundingClientRect()
                          if (!rect) return null
                          const W = 292
                          const H = 220
                          let px = rect.left + ((selBox.x + selBox.hw) / 512) * rect.width + 8
                          let py = rect.top + ((selBox.y - selBox.hh) / 512) * rect.height + 26
                          px = Math.max(8, Math.min(window.innerWidth - W - 8, px))
                          py = Math.max(8, Math.min(window.innerHeight - H - 8, py))
                          return createPortal(
                            <div
                              className="anchorpop anchorpop--fixed"
                              style={{ left: px, top: py }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <AnchorControls />
                            </div>,
                            document.body,
                          )
                        })()}
                    </>
                  )}
                  {!previewing &&
                    customIdxs
                      .filter((i) => i !== idxClamped && sourceData?.layers[i])
                      .map((i) => {
                        const b = layerBaseOf(sourceData!, i, Math.round(frame))
                        if (!b) return null
                        const [hw2, hh2] = layerHalfOf(sourceData!, i)
                        const [ox2, oy2] = layerCenterOffsetOf(sourceData!, i)
                        const mc = layerColor(sourceData!.layers[i] as Record<string, unknown>, i)
                        return (
                          <div
                            key={`m${i}`}
                            className="selbox selbox--multi"
                            style={{
                              left: `${((b[0] + ox2 - hw2) / 512) * 100}%`,
                              top: `${((b[1] + oy2 - hh2) / 512) * 100}%`,
                              width: `${((hw2 * 2) / 512) * 100}%`,
                              height: `${((hh2 * 2) / 512) * 100}%`,
                              borderColor: mc,
                            }}
                          />
                        )
                      })}
                  {selBox && (
                    <div
                      className="selbox"
                      style={{
                        left: `${((selBox.x - selBox.hw) / 512) * 100}%`,
                        top: `${((selBox.y - selBox.hh) / 512) * 100}%`,
                        width: `${((selBox.hw * 2) / 512) * 100}%`,
                        height: `${((selBox.hh * 2) / 512) * 100}%`,
                        borderColor: primaryColor,
                        boxShadow: `0 0 0 1px ${tint(primaryColor, 0.35)}`,
                      }}
                    >
                      {!handActive &&
                        (['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                          <div
                            key={c}
                            className={`selhandle selhandle--${c}`}
                            style={{ transform: `scale(${1 / zoom})`, borderColor: primaryColor }}
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
                              if (!rect || !b || !selBox) return
                              // 반대 모서리(월드) — 기본 리사이즈의 고정점 (PS 방식)
                              const sx = c.includes('w') ? 1 : -1
                              const sy = c.includes('n') ? 1 : -1
                              const opp: [number, number] = [
                                selBox.x + sx * selBox.hw,
                                selBox.y + sy * selBox.hh,
                              ]
                              resizeDrag.current = {
                                f: 512 / rect.width,
                                bx: b[0], by: b[1],
                                startSize,
                                ox: opp[0] - b[0], oy: opp[1] - b[1],
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
                              let px = Math.round(
                                Math.min(480, Math.max(40, (d.startSize * dist) / d.startDist)),
                              )
                              if (e.shiftKey) px = Math.round(px / 10) * 10 // Shift = 10px 스냅
                              const stt = useEditor.getState()
                              stt.setCustomSizeLive(px)
                              if (!e.altKey) {
                                // 기본: 반대 모서리 고정 — 크기 배율만큼 기준점 이동으로 보정.
                                // Alt: 중심(앵커) 기준 — 기준점 고정.
                                const k = px / d.startSize
                                stt.setCustomBaseLive(
                                  d.bx + (1 - k) * d.ox,
                                  d.by + (1 - k) * d.oy,
                                )
                              }
                            }}
                            onPointerUp={(e) => {
                              if (!resizeDrag.current) return
                              resizeDrag.current = null
                              ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                              useEditor.getState().commitEdit()
                            }}
                            onPointerCancel={() => {
                              resizeDrag.current = null
                              useEditor.getState().commitEdit()
                            }}
                          />
                        ))}
                    </div>
                  )}
                  {showAllBoxes &&
                    !previewing &&
                    sourceData?.layers.map((_, i) => {
                      const b = layerBaseOf(sourceData, i, Math.round(frame))
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
                      title="드래그: 이동 · Shift: 축 잠금 · Alt+드래그: 복제 · ⌘: 스냅 해제 · Esc: 취소"
                      onPointerDown={(e) => {
                        const rect = wrapRef.current?.getBoundingClientRect()
                        if (!rect) return
                        const f = 512 / rect.width
                        const px = (e.clientX - rect.left) * f
                        const py = (e.clientY - rect.top) * f
                        setAnchorPop(false)
                        // 프리뷰 중 클릭 → 편집 모드로 복귀 (정지 + 박스 표시)
                        if (useEditor.getState().playing) setPlaying(false)
                        let hit = pickLayer(px, py)
                        if (hit === null) {
                          // 빈 곳 클릭 = 선택 해제 + 누르고 있는 동안 전체 영역 표시
                          useEditor.getState().deselectCustom()
                          setShowAllBoxes(true)
                          e.currentTarget.setPointerCapture(e.pointerId)
                          return
                        }
                        // Shift/⌘+클릭 = 다중 선택 토글 (드래그 시작 안 함)
                        if (e.shiftKey || e.metaKey || e.ctrlKey) {
                          useEditor.getState().toggleCustomSel(hit)
                          return
                        }
                        // Alt+드래그 = 복제해서 이동 (PS 방식) — 오프셋 없이 제자리 복제
                        if (e.altKey) {
                          useEditor.getState().duplicateCustomLayer(hit, 0)
                          hit = Math.min(hit, (useEditor.getState().sourceData?.layers.length ?? 1) - 1)
                          setCustomIdx(hit)
                        } else if (useEditor.getState().customIdxs.includes(hit)) {
                          // 이미 다중 선택에 포함 — 선택 유지한 채 그룹 드래그, 주 선택만 교체
                          useEditor.setState({ customIdx: hit })
                        } else {
                          setCustomIdx(hit)
                        }
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
                        // Shift = 수평/수직 축 잠금 (지배적인 축만)
                        if (e.shiftKey) {
                          if (Math.abs(tx - d.bx) >= Math.abs(ty - d.by)) ty = d.by
                          else tx = d.bx
                        }
                        let gv: number | null = null
                        let gh: number | null = null
                        if (!(e.metaKey || e.ctrlKey)) {
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
                      onPointerCancel={() => {
                        // 제스처 중단 — 스턱 드래그 방지, 진행분은 커밋
                        setShowAllBoxes(false)
                        dragStart.current = null
                        dragLast.current = null
                        setGuides({ v: null, h: null })
                        setDragCoord(null)
                        setDragBox(null)
                        if (liveRaf.current !== null) {
                          cancelAnimationFrame(liveRaf.current)
                          liveRaf.current = null
                        }
                        useEditor.getState().commitEdit()
                      }}
                    />
                  )}
                </>
              )}
            </div>
          )
        ) : (
          appMode === 'custom' ? (
            <div className="preview__empty">
              <p className="preview__empty-title">그래픽을 끌어다 놓아 커스텀을 시작하세요</p>
              <p className="preview__empty-sub">
                SVG/PNG/JPG/WebP · 왼쪽 커스텀 패널에서도 업로드 가능 · 프로젝트 파일(.lmproj.json) 드롭 시 복원
              </p>
              <button className="btn btn--secondary" onClick={() => fileInputRef.current?.click()}>
                파일 열기
              </button>
            </div>
          ) : (
            <div className="preview__empty">
              <p className="preview__empty-title">왼쪽에서 템플릿을 선택하세요</p>
              <p className="preview__empty-sub">
                로티 JSON · 프로젝트 파일(.lmproj.json)을 끌어다 놓아도 열립니다
              </p>
              <button className="btn btn--secondary" onClick={() => fileInputRef.current?.click()}>
                JSON 파일 열기
              </button>
            </div>
          )
        )}
        <input
          ref={fileInputRef}
          type="file"
          // 커스텀 모드에선 그래픽도 열 수 있다 — 빈 화면 안내 문구와 일치
          accept={
            appMode === 'custom'
              ? '.json,application/json,.svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg,.webp,image/webp'
              : '.json,application/json'
          }
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const isGraphic =
              /\.(svg|png|jpe?g|webp)$/i.test(f.name) ||
              /^image\/(svg\+xml|png|jpeg|webp)$/.test(f.type)
            if (isGraphic && useEditor.getState().mode === 'custom') {
              // 좌표 없이 열면 캔버스 중앙 배치
              const cx = wrapRef.current?.getBoundingClientRect()
              dropGraphic(
                f,
                cx ? cx.left + cx.width / 2 : 0,
                cx ? cx.top + cx.height / 2 : 0,
              ).catch((err) => alert((err as Error).message))
            } else {
              openFile(f)
            }
          }}
        />
      </div>

      {animationData && (
        <div className="playbar">
          <button
            className="btn btn--icon playbar__play"
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
                  pendingJump.current = null // 수동 스크럽 — 점프 에코 억제 해제
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
          // 랩 직전 frame이 total을 살짝 넘을 수 있음 — 플레이헤드가 트랙 밖으로 못 나가게 클램프
          frameFrac={Math.min(
            1,
            (totalFrames || animationData.op - animationData.ip) > 0
              ? frame / (totalFrames || animationData.op - animationData.ip)
              : 0,
          )}
          totalSec={durationSec(animationData)}
          onScrub={(frac, done) => {
            if (done) {
              setSeek(null)
            } else {
              pendingJump.current = null // 수동 스크럽 — 점프 에코 억제 해제
              setPlaying(false)
              // 문서 기준 프레임 수 — 플레이어가 아직 보고 전이어도 스크럽 동작
              const frames = Math.max(1, animationData.op - animationData.ip)
              setSeek(frac * frames)
            }
          }}
        />
      )}
    </div>
  )
}
