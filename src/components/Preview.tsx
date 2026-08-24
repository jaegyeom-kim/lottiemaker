import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditor } from '../store'
import { t } from '../lib/i18n'
import {
  CursorIcon, HandIcon, SquareIcon, CircleIcon, TriangleIcon, StarIcon, LineIcon, PenIcon, AnchorTargetIcon,
  PlayIcon, PauseIcon, ReplayIcon, FitIcon, LayersIcon, SceneIcon,
} from './icons'
import { durationSec, parseLottie, type LottieJson } from '../lib/lottieUtils'
import { svgToLottie, readImageFile } from '../lib/svgImport'
import { TextDialog } from './TextControls'
import {
  layerHalfOf, layerAabbOf, layerBaseOf, layerRotationOf, normKf, kfValueAt, pathKAt,
  kfChannelKeys, normSel, animSpans, kfFallbackValue,
  type CustomPayload, type CustomKf, type CustomSel, type KfChannel,
} from '../lib/customBuilder'
import LottiePlayer from './LottiePlayer'
import type { AnimationItem } from 'lottie-web/build/player/lottie_svg'
import MockupView from './MockupView'
import Timeline from './Timeline'
import {
  buildShapeSvg, buildPenSvg, penPathD, shapeGhostPoints, togglePenHandles, STROKE_W,
  type DrawTool, type PenPt,
} from '../lib/drawTools'
import { readDotLottie } from '../lib/dotlottie'

export default function Preview() {
  const {
    animationData, playing, speed, loop, bg, replayToken, templateId,
    setPlaying, setSpeed, setLoop, setBg, load, replay, setCustomIdx,
    addCustomLayer,
  } = useEditor()
  // 캔버스 논리 크기 — 씬 진입 시 컴프 뷰포트로 바뀐다 (AE 방식)
  const cw = Number(animationData?.w ?? 512)
  const ch = Number(animationData?.h ?? 512)
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  // 패스 애니메이션 편집 — 스크럽 시 현재 프레임의 보간 형태로 pathEdit 갱신용
  const editCurFrame = useEditor((s) => s.curFrame)
  const customIdxs = useEditor((s) => s.customIdxs)
  // 씬(컴포지션) 목록 — 문서의 xscene comp 에셋에서 파생
  const activeScene = useEditor((s) => s.activeScene)
  const sceneTabs = (() => {
    const as = (sourceData?.assets as Record<string, unknown>[] | undefined) ?? []
    return as
      .filter((a) => a.xscene === true && a.id !== '__main')
      .map((a) => ({ id: String(a.id), name: String(a.nm ?? a.id) }))
  })()
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
  const dragStart = useRef<{
    x: number; y: number; bx: number; by: number; f: number; hw: number; hh: number
    ox: number; oy: number
    /** 다른 레이어의 스냅 타깃 (중앙·양끝) — 그랩 시점에 1회 수집 (스마트 가이드). */
    lx: number[]; ly: number[]
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
  // 캔버스 마키(러버밴드) 다중 선택 — 빈 곳/페이스트보드 드래그, ⇧ = 기존 선택에 추가 (AE 방식)
  const selMarquee = useRef<{ x0: number; y0: number; base: number[] } | null>(null)
  const [selMarqueeBox, setSelMarqueeBox] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  const marqueeBegin = (px: number, py: number, additive: boolean) => {
    selMarquee.current = {
      x0: px,
      y0: py,
      base: additive ? [...useEditor.getState().customIdxs] : [],
    }
    if (!additive) useEditor.getState().deselectCustom()
    setShowAllBoxes(true)
  }

  const marqueeMove = (clientX: number, clientY: number) => {
    const mq = selMarquee.current
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!mq || !rect) return
    const f = cw / rect.width
    const px = (clientX - rect.left) * f
    const py = (clientY - rect.top) * f
    if (Math.abs(px - mq.x0) < 3 && Math.abs(py - mq.y0) < 3) return
    const x0 = Math.min(mq.x0, px)
    const y0 = Math.min(mq.y0, py)
    const x1 = Math.max(mq.x0, px)
    const y1 = Math.max(mq.y0, py)
    setSelMarqueeBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    const s2 = useEditor.getState()
    const doc2 = s2.sourceData
    if (!doc2) return
    const hits: number[] = []
    doc2.layers.forEach((lyr, i) => {
      if ((lyr as Record<string, unknown>).hd === true) return
      const b = layerBase(i)
      if (!b) return
      const { half, offset } = layerAabbOf(doc2, i, Math.round(frameRef.current))
      const cx = b[0] + offset[0]
      const cy = b[1] + offset[1]
      if (cx + half[0] >= x0 && cx - half[0] <= x1 && cy + half[1] >= y0 && cy - half[1] <= y1)
        hits.push(i)
    })
    s2.setCustomSelList([...mq.base, ...hits])
  }

  const marqueeEnd = () => {
    selMarquee.current = null
    setSelMarqueeBox(null)
  }
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
  // ⌘V 통합 처리 — 클립보드에 이미지가 있으면 레이어로 붙여넣기(Creator 2.0 벤치),
  // 아니면 내부 키프레임 클립보드를 재생헤드에 붙여넣기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      const s = useEditor.getState()
      if (s.mode !== 'custom') return
      let imgFile: File | null = null
      for (const it of e.clipboardData?.items ?? []) {
        if (it.type.startsWith('image/')) {
          imgFile = it.getAsFile()
          break
        }
      }
      if (imgFile) {
        e.preventDefault()
        const name = imgFile.name?.replace(/\.[^.]+$/, '') || t('붙여넣은 이미지')
        const done = (payload: CustomPayload) => useEditor.getState().addCustomLayer(payload, name)
        if (imgFile.type === 'image/svg+xml') {
          imgFile
            .text()
            .then((txt) => done({ kind: 'svg', graphic: svgToLottie(txt) }))
            .catch((err) => alert((err as Error).message))
        } else {
          readImageFile(imgFile)
            .then((image) => done({ kind: 'image', image }))
            .catch((err) => alert((err as Error).message))
        }
        return
      }
      // 이미지 없음 → 내부 키프레임 붙여넣기 (클립보드 비어 있으면 no-op)
      s.pasteKfAt(s.curFrame)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

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
    /** 오버레이 릴리즈 커밋용 — 마지막 크기/Alt 여부, 대상 레이어, 그랩 시점 박스. */
    li: number; lastPx: number; lastAlt: boolean
    cx: number; cy: number; hw: number; hh: number
  } | null>(null)
  // 캔버스 드래그 라이브 반영 — rAF 스로틀 (오버레이 폴백 경로)
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

  // ── 드래그 이동 오버레이 — 재구축 없이 렌더된 레이어 <g>에 translate ──
  // 매 틱 인스턴스 파괴+재구축(틱당 55~77ms 롱태스크)이 편집 버벅임의 원인.
  // 드래그 중엔 lottie 내부 요소에 직접 translate, 릴리즈에 store 1회 커밋.
  const lottieInst = useRef<AnimationItem | null>(null)
  const dragOverlay = useRef<Map<Element, string> | null>(null)
  /** 렌더된 레이어 <g>에 임의 변환 프리픽스 — only 지정 시 그 레이어만, 아니면 다중 선택 전체. */
  const applyXformOverlay = (xf: string, only?: number): boolean => {
    const inst = lottieInst.current as unknown as {
      renderer?: { elements?: ({ layerElement?: SVGGElement } | null | undefined)[] }
    } | null
    const els = inst?.renderer?.elements
    if (!els?.length) return false
    const st = useEditor.getState()
    const n = st.sourceData?.layers.length ?? 0
    const sel = [...new Set(only !== undefined ? [only] : st.customIdxs)].filter(
      (i) =>
        i >= 0 &&
        i < n &&
        (st.sourceData?.layers[i] as Record<string, unknown> | undefined)?.xlock !== true,
    )
    if (!sel.length) return false
    if (!dragOverlay.current) dragOverlay.current = new Map()
    let applied = 0
    for (const i of sel) {
      const el = els[i]?.layerElement
      if (!el) continue
      // 재구축(alt 복제 직후 등)으로 el이 바뀌면 새로 원본 캡처 — 지연 캡처
      if (!dragOverlay.current.has(el))
        dragOverlay.current.set(el, el.getAttribute('transform') ?? '')
      const orig = dragOverlay.current.get(el)!
      el.setAttribute('transform', `${xf}${orig ? ` ${orig}` : ''}`)
      applied++
    }
    return applied > 0
  }
  const applyMoveOverlay = (dx: number, dy: number): boolean =>
    applyXformOverlay(`translate(${dx} ${dy})`)
  /** restore=true(취소)면 원본 transform 복원, 커밋 경로면 재구축이 대체하므로 그대로 둔다. */
  const clearMoveOverlay = (restore: boolean) => {
    if (!dragOverlay.current) return
    if (restore) {
      for (const [el, orig] of dragOverlay.current) {
        if (orig) el.setAttribute('transform', orig)
        else el.removeAttribute('transform')
      }
    }
    dragOverlay.current = null
  }

  // 텍스트 추가 다이얼로그 (드로잉 툴바 T)
  const [textDlg, setTextDlg] = useState(false)

  // 어니언 스킨 토글 — 전후 프레임 고스트 (일시정지·비편집 중에만 렌더)
  const [onion, setOnion] = useState(() => {
    try {
      return localStorage.getItem('lottiemaker.onion') === '1'
    } catch {
      return false
    }
  })
  const toggleOnion = () => {
    setOnion((v) => {
      try {
        localStorage.setItem('lottiemaker.onion', v ? '0' : '1')
      } catch {
        // 저장 불가 환경 — 무시
      }
      return !v
    })
  }
  // 라이브 편집 중엔 고스트 숨김 — 매 틱 로티 인스턴스 재생성 방지
  const liveEditing = useEditor((s) => s.editBaseline !== null)

  // 툴 + 뷰포트 (팬/줌) — 드로잉 툴은 Figma 단축키 (R/E/L/P)
  const [tool, setTool] = useState<'move' | 'hand' | 'anchor' | DrawTool>('move')
  const toolRef = useRef(tool)
  toolRef.current = tool
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom
  const [pan, setPanState] = useState({ x: 0, y: 0 })
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const handActive = tool === 'hand'
  const drawTool: DrawTool | null =
    tool !== 'move' && tool !== 'hand' && tool !== 'anchor' ? tool : null

  // ── 드로잉 상태 — 박스 드래그(도형) + 펜 포인트 ──
  const [drawDrag, setDrawDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [penPts, setPenPts] = useState<PenPt[]>([])
  const penPtsRef = useRef(penPts)
  penPtsRef.current = penPts
  const [penHover, setPenHover] = useState<[number, number] | null>(null)
  const penHandleIdx = useRef<number | null>(null)
  // 펜 = 그리는 즉시 실제 레이어 (일러스트레이터 방식) — 2점부터 생성, 이후 라이브 갱신
  const penCreated = useRef(false)
  // 고스트 앵커/핸들 드래그 — kind: 앵커 이동 | 나가는 핸들 | 들어오는 핸들
  // pull = ⌥드래그로 코너 앵커에서 핸들 뽑기 (AE 포인트 변환 툴)
  const ghostDrag = useRef<{
    kind: 'anchor' | 'ho' | 'hi' | 'pull'
    idx: number
    moved: boolean
    alt: boolean
    add?: boolean
    group?: { idxs: number[]; starts: [number, number][]; from: [number, number] } | null
  } | null>(null)
  // 펜 포인트 선택 — AE식 다중 (⇧클릭 토글 · 선택 후 빈 곳 드래그 = 포인트 마키)
  const [penSels, setPenSels] = useState<number[]>([])
  const setPenSel = (i: number | null) => setPenSels(i === null ? [] : [i])
  const togglePenSel = (i: number) =>
    setPenSels((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
  // ⌥ 홀드 — 펜 앵커 위 커서를 '포인트 변환'으로 (CSS는 모디파이어를 못 본다)
  const [penAlt, setPenAlt] = useState(false)
  useEffect(() => {
    if (templateId !== '__custom') return
    const dn = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setPenAlt(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setPenAlt(false)
    }
    const blur = () => setPenAlt(false)
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', dn)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [templateId])
  const penSelsRef = useRef(penSels)
  penSelsRef.current = penSels
  // 포인트 마키 (편집 모드 — 선택이 있을 때 빈 곳 드래그)
  const pointMarquee = useRef<{ x0: number; y0: number; add: boolean } | null>(null)
  const [pmBox, setPmBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  // 완성된 패스 재편집 (일러 직접 선택) — 포인트는 셰이프 로컬 좌표, 표시용 로컬→캔버스 행렬
  const [pathEdit, setPathEdit] = useState<{ li: number; pts: PenPt[]; closed: boolean } | null>(null)
  const pathEditRef = useRef(pathEdit)
  pathEditRef.current = pathEdit
  const [editM, setEditM] = useState<DOMMatrix | null>(null)
  const editMRef = useRef(editM)
  editMRef.current = editM
  const editDrag = useRef<{
    kind: 'anchor' | 'ho' | 'hi' | 'pull'
    idx: number
    moved: boolean
    add: boolean // ⇧ — 클릭 해석 시 토글
    group: { idxs: number[]; starts: [number, number][]; from: [number, number] } | null
  } | null>(null)

  /** 레이어가 펜 편집 가능(단일 sh)한지 — 로컬 포인트 추출. */
  const penEditTarget = (li: number): { pts: PenPt[]; closed: boolean } | null => {
    const st = useEditor.getState()
    const layer = st.sourceData?.layers[li] as Record<string, unknown> | undefined
    if (!layer || Number(layer.ty) !== 4 || layer.xlock === true) return null
    const shapes = layer.shapes as Record<string, unknown>[] | undefined
    if (!shapes || shapes.length !== 1) return null
    const found: Record<string, unknown>[] = []
    const walk = (items?: Record<string, unknown>[]) => {
      for (const it of items ?? []) {
        if (it.ty === 'sh') found.push(it)
        else if (it.ty === 'gr') walk(it.it as Record<string, unknown>[])
      }
    }
    walk((shapes[0] as Record<string, unknown>).it as Record<string, unknown>[])
    if (found.length !== 1) return null
    // 패스 애니메이션(pk) 레이어 — 현재 프레임의 보간 형태를 편집 대상으로
    const xkfP = normKf(layer.xkf as Partial<CustomKf> | undefined)
    const animK = pathKAt(xkfP, Math.round(st.curFrame))
    const k =
      animK ??
      ((found[0].ks as Record<string, unknown> | undefined)?.k as
        | { v: [number, number][]; i: [number, number][]; o: [number, number][]; c?: boolean }
        | undefined)
    if (!Array.isArray(k?.v) || k.v.length < 2) return null
    const z = (pt?: [number, number]) => !pt || (Math.abs(pt[0]) < 1e-6 && Math.abs(pt[1]) < 1e-6)
    return {
      closed: !!k.c,
      pts: k.v.map((pv, j) => ({
        p: [pv[0], pv[1]] as [number, number],
        ho: z(k.o[j]) ? null : ([k.o[j][0], k.o[j][1]] as [number, number]),
        hi: z(k.i[j]) ? null : ([k.i[j][0], k.i[j][1]] as [number, number]),
      })),
    }
  }

  const penPtsToK = (pts: PenPt[], closed: boolean) => ({
    v: pts.map((pp) => [Math.round(pp.p[0] * 100) / 100, Math.round(pp.p[1] * 100) / 100] as [number, number]),
    o: pts.map((pp) => (pp.ho ? ([pp.ho[0], pp.ho[1]] as [number, number]) : ([0, 0] as [number, number]))),
    i: pts.map((pp) => (pp.hi ? ([pp.hi[0], pp.hi[1]] as [number, number]) : ([0, 0] as [number, number]))),
    c: closed,
  })

  // 펜 툴 + 새 드로잉 없음 + 선택 레이어가 단일 패스 → 편집 모드 진입/갱신
  useEffect(() => {
    if (templateId !== '__custom' || tool !== 'pen' || penPts.length) {
      if (pathEditRef.current) setPathEdit(null)
      return
    }
    if (editDrag.current) return // 드래그 중 데이터 에코로 리로드 금지
    const n = sourceData?.layers.length ?? 0
    if (!n) {
      setPathEdit(null)
      return
    }
    const li = Math.min(customIdx, n - 1)
    const target = penEditTarget(li)
    setPathEdit(target ? { li, ...target } : null)
    setPenSel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, tool, customIdx, sourceData, penPts.length, editCurFrame])

  // 로컬→캔버스 행렬 — 렌더된 path의 CTM에서 (레이어/그룹 트랜스폼 전부 흡수)
  useEffect(() => {
    if (!pathEdit) {
      if (editMRef.current) setEditM(null)
      return
    }
    const raf = requestAnimationFrame(() => {
      const wrap = wrapRef.current
      const svg = wrap?.querySelector('svg')
      const v0 = pathEdit.pts[0]?.p
      if (!wrap || !svg || !v0) return
      let el: SVGPathElement | null = null
      // 1순위: 레이어 인덱스로 직접 매핑 — d 좌표 매칭은 첫 앵커를 끄는 동안
      // (DOM이 재구축 전이라) 어긋나서 행렬이 끊긴다
      const inst = lottieInst.current as unknown as {
        renderer?: { elements?: ({ layerElement?: SVGGElement } | null | undefined)[] }
      } | null
      const layerG = inst?.renderer?.elements?.[pathEdit.li]?.layerElement
      if (layerG?.isConnected) el = layerG.querySelector('path')
      if (!el) {
        // 폴백: 첫 앵커 좌표로 d 매칭
        for (const cand of Array.from(svg.querySelectorAll('path'))) {
          const m = (cand.getAttribute('d') ?? '').match(/M\s*(-?[\d.]+)[ ,](-?[\d.]+)/)
          if (m && Math.abs(Number(m[1]) - v0[0]) < 0.6 && Math.abs(Number(m[2]) - v0[1]) < 0.6) {
            el = cand as SVGPathElement
            break
          }
        }
      }
      const ctm = el?.getScreenCTM()
      if (!ctm) {
        setEditM(null)
        return
      }
      const rect = wrap.getBoundingClientRect()
      const f = cw / rect.width
      setEditM(new DOMMatrix().scale(f).translate(-rect.left, -rect.top).multiply(DOMMatrix.fromMatrix(ctm)))
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathEdit, zoom, pan, animationData])

  /** 화면 좌표 → 캔버스 좌표 (512 기준, 줌은 rect가 이미 반영). */
  const toCanvasPt = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width < 1) return null
    const f = cw / rect.width
    const clamp = (v: number) => Math.max(-1024, Math.min(1536, v))
    return [clamp((e.clientX - rect.left) * f), clamp((e.clientY - rect.top) * f)]
  }

  const TOOL_NAMES: Record<DrawTool, string> = {
    rect: '사각형', ellipse: '원형', polygon: '삼각형', star: '별', line: '선', pen: '패스',
  }

  const commitDrawnShape = (dd: { x0: number; y0: number; x1: number; y1: number }) => {
    const dt = toolRef.current
    if (dt === 'move' || dt === 'hand' || dt === 'anchor' || dt === 'pen') return
    const w = Math.abs(dd.x1 - dd.x0)
    const h = Math.abs(dd.y1 - dd.y0)
    if (w < 3 && h < 3) return // 클릭만 한 것 — 무시
    const svg = buildShapeSvg(dt, w, h, dt === 'line' ? { dx: dd.x1 - dd.x0, dy: dd.y1 - dd.y0 } : undefined)
    const size = dt === 'line' ? Math.max(w, h) + STROKE_W + 2 : Math.max(w, h)
    // 도형 메타 태깅 — properties에서 크기/라운드 리빌드 (line은 방향 정보 없어 제외)
    const xshape =
      dt === 'rect' || dt === 'ellipse' || dt === 'polygon' || dt === 'star'
        ? { tool: dt, w: Math.max(4, Math.round(w)), h: Math.max(4, Math.round(h)), r: 0 }
        : undefined
    useEditor
      .getState()
      .addCustomLayer(
        { kind: 'svg', graphic: svgToLottie(svg) },
        t(TOOL_NAMES[dt]),
        [(dd.x0 + dd.x1) / 2, (dd.y0 + dd.y1) / 2],
        size,
        xshape,
      )
    setTool('move') // Figma처럼 만들고 나면 이동 툴로
  }

  /** 펜 경로를 실제 레이어에 반영 — 2점부터 생성, 이후 라이브 교체 (일러 방식). */
  const syncPenLayer = (pts: PenPt[], closed = false) => {
    const built = buildPenSvg(pts, closed)
    if (!built) return
    const payload: CustomPayload = { kind: 'svg', graphic: svgToLottie(built.svg) }
    const s = useEditor.getState()
    if (!penCreated.current) {
      s.addCustomLayer(payload, t('패스'), built.center, built.size)
      penCreated.current = true
    } else {
      s.replaceCustomGraphicLive(payload, built.center, built.size)
    }
  }

  /** 펜 종료 — 그린 만큼 레이어로 확정 (Esc·Enter·툴 전환·닫기 전부 여기로). */
  const finishPen = (close: boolean, ptsOverride?: PenPt[]) => {
    const pts = ptsOverride ?? penPtsRef.current
    setPenPts([])
    setPenHover(null)
    setPenSel(null)
    penHandleIdx.current = null
    ghostDrag.current = null
    const created = penCreated.current
    penCreated.current = false
    setTool('move') // 직접 종료 시 이동 툴로 — switchTool 경유면 뒤이어 목표 툴로 덮임
    if (pts.length < 2) {
      // 점 하나뿐 — 레이어가 없으니 조용히 정리
      return
    }
    syncPenLayerFinal(pts, close, created)
  }
  const syncPenLayerFinal = (pts: PenPt[], close: boolean, created: boolean) => {
    const built = buildPenSvg(pts, close)
    if (!built) return
    const payload: CustomPayload = { kind: 'svg', graphic: svgToLottie(built.svg) }
    const s = useEditor.getState()
    if (created) {
      s.replaceCustomGraphicLive(payload, built.center, built.size)
      // 스트로크 전체 = 언두 1회 (addCustomLayer가 이미 push) — 중간 상태로 되돌지 않게
      s.squashEdit()
    } else {
      s.addCustomLayer(payload, t('패스'), built.center, built.size)
    }
  }

  /** 그리는 중 마지막 앵커 제거 — Backspace/⌘Z 공용 (일러 방식). */
  const popPenPoint = () => {
    const s = useEditor.getState()
    const rest = penPtsRef.current.slice(0, -1)
    setPenSel(null)
    setPenPts(rest)
    if (rest.length >= 2) syncPenLayer(rest)
    else if (penCreated.current && s.customIdxs.length) {
      // 점 1개 이하 — 생성했던 라이브 레이어 제거
      s.cancelEdit()
      s.removeCustomLayers([Math.min(s.customIdx, (s.sourceData?.layers.length ?? 1) - 1)])
      penCreated.current = false
    }
  }

  /** 툴 전환 — 펜 진행 중이면 그린 만큼 레이어로 확정하고 전환 (일러: 오브젝트 유지). */
  const switchTool = (next: typeof tool) => {
    if (toolRef.current === 'pen' && penPtsRef.current.length) {
      finishPen(false)
    }
    setDrawDrag(null)
    setTool(next)
  }

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
      const el = t as HTMLInputElement | null
      if (!el) return false
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true
      // 슬라이더/체크박스 포커스가 단축키(⌘Z 등)를 삼키지 않게 — 텍스트 입력만 차단
      return el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type)
    }
    // 펜 드로잉 중 ⌘Z = 마지막 앵커 취소 (일러) — 스토어 언두로 새면 그리던
    // 레이어/포인트 상태가 어긋난다. 등록 순서와 무관하게 App 전역 언두보다
    // 먼저 잡히도록 캡처 페이즈 사용. ⇧⌘Z(리두)는 드로잉 중 무시.
    const penUndoCapture = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      if (toolRef.current !== 'pen' || !penPtsRef.current.length) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.shiftKey) popPenPoint()
    }
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const s = useEditor.getState()
      if (e.key === 'Escape') {
        // 이동 드래그 진행 중 — 오버레이 복원하고 드래그 중단 (store 무변경)
        if (dragStart.current) {
          e.preventDefault()
          clearMoveOverlay(true)
          dragStart.current = null
          dragLast.current = null
          setGuides({ v: null, h: null })
          setDragCoord(null)
          setDragBox(null)
          return
        }
        // 마키 진행 중 취소 — Esc 소비 표시 (그래프 에디터 닫힘 방지)
        if (selMarquee.current) {
          e.preventDefault()
          selMarquee.current = null
          setSelMarqueeBox(null)
          return
        }
        // 펜 진행 중 Esc = 그린 만큼 레이어로 확정하고 펜 종료 (일러 방식)
        if (penPtsRef.current.length) {
          e.preventDefault()
          finishPen(false)
          return
        }
        if (toolRef.current !== 'move' && toolRef.current !== 'hand') {
          setDrawDrag(null)
          setTool('move')
          return
        }
        if (s.kfSel.length) s.setKfSel([]) // 타임라인 키 선택 해제
        // 진행 중인 드래그/리사이즈 취소 — 시작 시점으로 복원 (PS Esc)
        if (dragStart.current || resizeDrag.current) {
          dragStart.current = null
          dragLast.current = null
          resizeDrag.current = null
          clearMoveOverlay(false) // 복원은 cancelEdit 재구축이 대체 — 맵만 정리
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
      else if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey) switchTool('move')
      else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) switchTool('hand')
      else if (e.key.toLowerCase() === 'y' && !e.metaKey && !e.ctrlKey) switchTool('anchor')
      // 드로잉 툴 — AE 배치: G = 펜, Q = 도형 순환 (P/S/R/T는 AE 채널 공개)
      else if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) switchTool('pen')
      else if (e.key.toLowerCase() === 'q' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const cycle: DrawTool[] = ['rect', 'ellipse', 'polygon', 'star', 'line']
        const cur = cycle.indexOf(toolRef.current as DrawTool)
        switchTool(cycle[(cur + 1) % cycle.length])
      }
      // AE 채널 공개 — P/S/R/T 솔로 토글, ⇧ = 추가, U = 키 있는 채널 전부
      else if (
        !e.metaKey && !e.ctrlKey && !e.altKey &&
        ['p', 's', 'r', 't', 'u'].includes(e.key.toLowerCase()) &&
        s.customIdxs.length
      ) {
        e.preventDefault()
        const k = e.key.toLowerCase()
        const spec = k === 't' ? 'o' : k === 'u' ? 'u' : (k as 'p' | 's' | 'r')
        s.revealChannels(s.customIdxs, spec, e.shiftKey)
      }
      else if (e.key === 'Enter' && toolRef.current === 'pen' && penPtsRef.current.length >= 2) {
        e.preventDefault()
        finishPen(false)
      }
      else if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setZoom(1)
        setPanState({ x: 0, y: 0 })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        // 펜 진행 중 — 마지막 앵커 삭제 (일러 방식). 레이어 삭제로 새면 그리던 패스가 날아간다
        // 완성 패스 편집 중 — 선택 앵커 삭제 (최소 2점 유지)
        if (toolRef.current === 'pen' && !penPtsRef.current.length && pathEditRef.current) {
          const pe = pathEditRef.current
          const sels = penSelsRef.current.filter((i) => i < pe.pts.length)
          // 선택 전부 삭제 — 최소 2점은 남겨야 패스 유지
          if (sels.length && pe.pts.length - sels.length >= 2) {
            const pts = pe.pts.filter((_, i) => !sels.includes(i))
            setPathEdit({ ...pe, pts })
            setPenSel(null)
            s.setPenPathLive(pe.li, penPtsToK(pts, pe.closed))
            s.commitEdit()
          }
          return
        }
        if (toolRef.current === 'pen' && penPtsRef.current.length) {
          // 선택 앵커가 있으면 그 점, 없으면 마지막 점
          const sels = penSelsRef.current.filter((i) => i < penPtsRef.current.length)
          if (sels.length) {
            const rest = penPtsRef.current.filter((_, i) => !sels.includes(i))
            setPenSel(null)
            setPenPts(rest)
            if (rest.length >= 2) syncPenLayer(rest)
            else if (penCreated.current && s.customIdxs.length) {
              s.cancelEdit()
              s.removeCustomLayers([Math.min(s.customIdx, (s.sourceData?.layers.length ?? 1) - 1)])
              penCreated.current = false
            }
          } else {
            popPenPoint()
          }
          return
        }
        // 타임라인 키 선택이 있으면 키 삭제, 아니면 선택 레이어 삭제
        if (s.kfSel.length) s.removeKfKeys(s.kfSel)
        else if (s.customIdxs.length) s.removeCustomLayers(s.customIdxs)
      } else if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey)) {
        // ⌘A = 전체 선택 / ⇧⌘A = 선택 해제 (AE)
        e.preventDefault()
        if (e.shiftKey) s.deselectCustom()
        else {
          const n = s.sourceData?.layers.length ?? 0
          if (n) s.setCustomSelList(Array.from({ length: n }, (_, i) => i))
        }
      } else if (e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey)) {
        // 복제 — 선택이 있을 때만 (빈 곳 클릭으로 해제된 상태에서 보이지 않는 레이어 편집 방지)
        e.preventDefault()
        const n = s.sourceData?.layers.length ?? 0
        if (n && s.customIdxs.length) s.duplicateCustomLayer(Math.min(s.customIdx, n - 1))
      } else if (e.key.toLowerCase() === 'c' && (e.metaKey || e.ctrlKey) && s.kfSel.length) {
        // 선택 키프레임 복사 (AE ⌘C) — 붙여넣기는 window paste 이벤트에서 처리
        e.preventDefault()
        s.copyKfSel()
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        // 타임라인 키 선택이 있으면 ←/→ = 키 시간 넛지 (AE 방식, 1f / ⇧10f)
        if (s.kfSel.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          const df = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)
          s.nudgeKfSel(df)
          return
        }
        // 방향키 넛지 — 1px, Shift = 10px. 리핏 동안 라이브, 키 떼면 히스토리 1회
        if (!s.customIdxs.length) return
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (dx || dy) {
          // 델타 이동 — kf p키 레이어에서 xbase 절대값으로 가면 현재 프레임
          // 시각 위치에서 xbase+step으로 텔레포트한다 (nudge는 kf 자동 키 처리 내장)
          s.nudgeCustomBase(dx, dy)
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
            s.setKfChannel(ch, cur, kfValueAt(xkf, ch, cur, kfFallbackValue(ch, xsel, xb)))
          }
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) useEditor.getState().commitEdit()
    }
    window.addEventListener('keydown', penUndoCapture, true)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', penUndoCapture, true)
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
  // 앵커 포인트 툴 — 드래그로 xsel.anchor 이동 (그래픽 제자리, withCustomAnchor가 보정)
  const anchorDrag = useRef(false)
  const applyAnchorDrag = (pt: [number, number]) => {
    const st = useEditor.getState()
    if (!st.sourceData?.layers.length) return
    const li = Math.min(st.customIdx, st.sourceData.layers.length - 1)
    const layer = st.sourceData.layers[li] as Record<string, unknown>
    if (layer.xlock === true) return
    const xsel = normSel(layer.xsel as Partial<CustomSel> | undefined, st.sourceData.op)
    const base = layerBaseOf(st.sourceData, li, Math.round(frameRef.current))
    const [hw, hh] = layerHalfOf(st.sourceData, li, Math.round(frameRef.current))
    if (!base || hw < 0.5 || hh < 0.5) return
    // 앵커 월드 = base — 커서와의 차를 무회전 로컬로 돌려 분율 증분
    // (회전은 프레임 인지 — kf r 키 레이어에서 xsel.rotation은 폴백일 뿐)
    const rot = (layerRotationOf(st.sourceData, li, Math.round(frameRef.current)) * Math.PI) / 180
    const dx = pt[0] - base[0]
    const dy = pt[1] - base[1]
    const lx = dx * Math.cos(-rot) - dy * Math.sin(-rot)
    const ly = dx * Math.sin(-rot) + dy * Math.cos(-rot)
    const [ax, ay] = xsel.anchor ?? [0.5, 0.5]
    st.setCustomAnchorLive(ax + lx / (hw * 2), ay + ly / (hh * 2))
  }

  let anchorPt: [number, number] | null = null
  let selBox: { x: number; y: number; hw: number; hh: number } | null =
    previewing || !hasSelection ? null : dragBox
  if (!selBox && !previewing && hasSelection && templateId === '__custom' && sourceData?.layers.length) {
    const i = Math.min(customIdx, sourceData.layers.length - 1)
    const b = layerBaseOf(sourceData, i, Math.round(frame))
    if (b) {
      const { half, offset } = layerAabbOf(sourceData, i, Math.round(frame))
      selBox = { x: b[0] + offset[0], y: b[1] + offset[1], hw: half[0], hh: half[1] }
      anchorPt = b // 앵커 월드 좌표 = 레이어 포지션
    }
  }
  // 모션 패스 (기본 내장) — 주 선택 키프레임 레이어의 위치 키 경로 (AE 스타일)
  const motionPath = (() => {
    if (templateId !== '__custom' || previewing || !sourceData?.layers.length) return null
    const lr = sourceData.layers[idxClamped] as Record<string, unknown> | undefined
    const xkf = normKf(lr?.xkf as Partial<CustomKf> | undefined)
    if (!xkf.on) return null
    const pk = kfChannelKeys(xkf, 'p')
    if (pk.length < 2) return null
    const fb = pk[0].p as [number, number]
    // 프레임 점 — 2f 간격 샘플, 이징에 따라 점 간격이 속도를 보여준다
    const dots: [number, number][] = []
    const t0 = pk[0].t
    const t1 = pk[pk.length - 1].t
    for (let f = t0; f <= t1; f += 2) dots.push(kfValueAt(xkf, 'p', f, fb) as [number, number])
    // 곡선 경로 d + 공간 탄젠트 핸들 — 수동(pto/pti) 우선, smooth는 Catmull-Rom 폴백
    const pts = pk.map((k) => k.p as [number, number])
    const cr = (j: number): [number, number] => {
      const p0 = pts[Math.max(0, j - 1)]
      const p2 = pts[Math.min(pts.length - 1, j + 1)]
      return [(p2[0] - p0[0]) / 2, (p2[1] - p0[1]) / 2]
    }
    let d = `M ${pts[0][0]} ${pts[0][1]}`
    const handles: {
      t: number
      which: 'pto' | 'pti'
      base: [number, number]
      off: [number, number]
      manual: boolean
    }[] = []
    for (let i = 0; i < pk.length - 1; i++) {
      const a = pk[i]
      const b = pk[i + 1]
      const pa = pts[i]
      const pb = pts[i + 1]
      let to = a.pto ?? null
      let ti = b.pti ?? null
      if (xkf.smooth) {
        if (!to) {
          const m = cr(i)
          to = [m[0] / 3, m[1] / 3]
        }
        if (!ti) {
          const m = cr(i + 1)
          ti = [-m[0] / 3, -m[1] / 3]
        }
      }
      d += ` C ${pa[0] + (to?.[0] ?? 0)} ${pa[1] + (to?.[1] ?? 0)} ${pb[0] + (ti?.[0] ?? 0)} ${pb[1] + (ti?.[1] ?? 0)} ${pb[0]} ${pb[1]}`
      // 핸들 표시 오프셋 — 탄젠트 없으면(직선) 세그먼트 방향 20%로 시드 (0길이는 못 잡음)
      const dist = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1
      const dir: [number, number] = [(pb[0] - pa[0]) / dist, (pb[1] - pa[1]) / dist]
      const seed = Math.min(40, dist * 0.2)
      handles.push({
        t: a.t, which: 'pto', base: pa,
        off: to ?? [dir[0] * seed, dir[1] * seed], manual: !!to,
      })
      handles.push({
        t: b.t, which: 'pti', base: pb,
        off: ti ?? [-dir[0] * seed, -dir[1] * seed], manual: !!ti,
      })
    }
    return {
      keys: pk.map((k) => ({ t: k.t, p: k.p as [number, number] })),
      d,
      handles,
      dots,
      cur: kfValueAt(xkf, 'p', Math.round(frame), fb) as [number, number],
      firstT: pk[0].t,
      lastT: pk[pk.length - 1].t,
    }
  })()

  // ── 그라디언트 라인 (피그마) — 선택 레이어의 gf 끝점을 캔버스에서 직접 드래그 ──
  const [gradM, setGradM] = useState<DOMMatrix | null>(null)
  const gradDrag = useRef<{
    which: 's' | 'e' | 'stop'
    li: number
    moved: boolean
    /** stop 드래그용 — 그랩 시점 스톱 목록(hex 포함)과 대상 인덱스, 로컬 s/e. */
    stopIdx?: number
    stops?: { t: number; hex: string }[]
    ls?: [number, number]
    le?: [number, number]
  } | null>(null)
  const gradIdx = Math.min(customIdx, (sourceData?.layers.length ?? 1) - 1)
  /** 선택 레이어의 gf 페인터 — {s, e, from, to, radial} (없으면 null). */
  const gradInfo = (() => {
    if (templateId !== '__custom' || previewing || tool !== 'move' || drawTool) return null
    const lr = sourceData?.layers[gradIdx] as Record<string, unknown> | undefined
    const group = (lr?.shapes as Record<string, unknown>[] | undefined)?.[0]
    if (!group?.it) return null
    let gf: Record<string, unknown> | null = null
    const walk = (items: Record<string, unknown>[]) => {
      for (const it of items) {
        if (it.ty === 'gf' && !gf) gf = it
        else if (it.ty === 'gr') walk(it.it as Record<string, unknown>[])
      }
    }
    walk(group.it as Record<string, unknown>[])
    if (!gf) return null
    const g = gf as Record<string, unknown>
    const sPt = ((g.s as Record<string, unknown>)?.k as number[] | undefined) ?? [0, 0]
    const ePt = ((g.e as Record<string, unknown>)?.k as number[] | undefined) ?? [100, 0]
    const stops = (((g.g as Record<string, unknown>)?.k as Record<string, unknown>)?.k as number[] | undefined) ?? []
    const hex = (i: number) =>
      stops.length >= i + 4
        ? `rgb(${Math.round(stops[i + 1] * 255)},${Math.round(stops[i + 2] * 255)},${Math.round(stops[i + 3] * 255)})`
        : '#888'
    const stopList: { t: number; css: string; hex: string }[] = []
    for (let i = 0; i + 3 < stops.length; i += 4) {
      const to255 = (v: number) => Math.round(v * 255)
      const hx = `#${[stops[i + 1], stops[i + 2], stops[i + 3]]
        .map((v) => to255(v).toString(16).padStart(2, '0'))
        .join('')}`
      stopList.push({ t: stops[i], css: hex(i), hex: hx })
    }
    return {
      li: gradIdx,
      s: [sPt[0], sPt[1]] as [number, number],
      e: [ePt[0], ePt[1]] as [number, number],
      from: hex(0),
      to: hex((stopList.length - 1) * 4),
      stops: stopList,
      radial: Number(g.t) === 2,
    }
  })()
  const hasGrad = !!gradInfo
  // 로컬→캔버스 행렬 — 렌더된 path CTM (editM과 동일 방식, 이동 툴 전용)
  useEffect(() => {
    if (!hasGrad) {
      setGradM(null)
      return
    }
    const raf = requestAnimationFrame(() => {
      const wrap = wrapRef.current
      if (!wrap) return
      const inst = lottieInst.current as unknown as {
        renderer?: { elements?: ({ layerElement?: SVGGElement } | null | undefined)[] }
      } | null
      const layerG = inst?.renderer?.elements?.[gradIdx]?.layerElement
      const el = layerG?.isConnected ? layerG.querySelector('path') : null
      const ctm = el?.getScreenCTM()
      if (!ctm) {
        setGradM(null)
        return
      }
      const rect = wrap.getBoundingClientRect()
      const f = cw / rect.width
      setGradM(new DOMMatrix().scale(f).translate(-rect.left, -rect.top).multiply(DOMMatrix.fromMatrix(ctm)))
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGrad, gradIdx, zoom, pan, animationData])
  const gradMove = (e: React.PointerEvent) => {
    const gd = gradDrag.current
    if (!gd || !gradM) return
    e.stopPropagation()
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const f = cw / rect.width
    const cvs = new DOMPoint((e.clientX - rect.left) * f, (e.clientY - rect.top) * f)
    const local = cvs.matrixTransform(gradM.inverse())
    gd.moved = true
    if (gd.which === 'stop') {
      // 라인 축 투영 → t (피그마 스톱 슬라이드)
      if (!gd.stops || gd.stopIdx === undefined || !gd.ls || !gd.le) return
      const ex = gd.le[0] - gd.ls[0]
      const ey = gd.le[1] - gd.ls[1]
      const len2 = ex * ex + ey * ey || 1
      const tv = Math.max(0, Math.min(1, ((local.x - gd.ls[0]) * ex + (local.y - gd.ls[1]) * ey) / len2))
      const next = gd.stops.map((x, j) => (j === gd.stopIdx ? { ...x, t: tv } : x))
      gd.stops = next
      useEditor.getState().setLayerFillStopsLive(gd.li, next)
      return
    }
    useEditor.getState().setLayerFillPointsLive(gd.li, { [gd.which]: [local.x, local.y] } as {
      s?: [number, number]
      e?: [number, number]
    })
  }
  const gradUp = (e: React.PointerEvent) => {
    const gd = gradDrag.current
    gradDrag.current = null
    if (!gd) return
    e.stopPropagation()
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    if (gd.moved) useEditor.getState().commitEdit()
  }


  // 고정 가이드 드래그 — 룰러에서 끌어 생성, 라인 드래그로 이동, 룰러 밖 드롭 = 삭제
  const guideDrag = useRef<{ axis: 'v' | 'h'; idx: number; moved: boolean } | null>(null)
  const guideCanvasPos = (e: React.PointerEvent, axis: 'v' | 'h'): number | null => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return null
    const f = cw / rect.width
    return axis === 'v' ? (e.clientX - rect.left) * f : (e.clientY - rect.top) * f
  }
  const guideMove = (e: React.PointerEvent) => {
    const gd = guideDrag.current
    if (!gd) return
    e.stopPropagation()
    const pos = guideCanvasPos(e, gd.axis)
    if (pos === null) return
    gd.moved = true
    gd.idx = useEditor.getState().setGuideLive(gd.axis, gd.idx, pos)
  }
  const guideUp = (e: React.PointerEvent) => {
    const gd = guideDrag.current
    guideDrag.current = null
    if (!gd) return
    e.stopPropagation()
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    if (!gd.moved) return
    const pos = guideCanvasPos(e, gd.axis)
    const st = useEditor.getState()
    // 캔버스 밖으로 드롭 = 삭제 (Figma)
    if (pos === null || pos < -1 || pos > (gd.axis === 'v' ? cw : ch) + 1) {
      if (gd.idx >= 0) st.removeGuide(gd.axis, gd.idx)
      else st.cancelEdit()
    } else st.commitEdit()
  }

  // 모션 패스 드래그 — 키 이동 / 공간 탄젠트 (⌥ = 반대쪽 비대칭)
  const mpDrag = useRef<{
    kind: 'key' | 'pto' | 'pti'
    t: number
    base: [number, number]
    moved: boolean
  } | null>(null)
  const mpCanvasPt = (e: React.PointerEvent): [number, number] | null => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return null
    const f = cw / rect.width
    return [(e.clientX - rect.left) * f, (e.clientY - rect.top) * f]
  }
  const mpMove = (e: React.PointerEvent) => {
    const md = mpDrag.current
    if (!md) return
    e.stopPropagation()
    const pt = mpCanvasPt(e)
    if (!pt) return
    md.moved = true
    const st = useEditor.getState()
    if (md.kind === 'key') {
      st.setKfChannelLive('p', md.t, [Math.round(pt[0] * 10) / 10, Math.round(pt[1] * 10) / 10])
      return
    }
    const off: [number, number] = [
      Math.round((pt[0] - md.base[0]) * 10) / 10,
      Math.round((pt[1] - md.base[1]) * 10) / 10,
    ]
    const isFirst = motionPath && Math.abs(md.t - motionPath.firstT) < 0.5
    const isLast = motionPath && Math.abs(md.t - motionPath.lastT) < 0.5
    const mirror: [number, number] = [-off[0], -off[1]]
    if (md.kind === 'pto')
      st.setKfSpatialLive(md.t, { pto: off, ...(!e.altKey && !isFirst ? { pti: mirror } : {}) })
    else st.setKfSpatialLive(md.t, { pti: off, ...(!e.altKey && !isLast ? { pto: mirror } : {}) })
  }
  const mpUp = (e: React.PointerEvent) => {
    const md = mpDrag.current
    mpDrag.current = null
    if (!md) return
    e.stopPropagation()
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    if (md.moved) useEditor.getState().commitEdit()
  }

  // 어니언 스킨 고스트 프레임 — 현재 기준 전후 (±6, ±12f)
  const onionFrames = (() => {
    if (!onion || templateId !== '__custom' || playing || liveEditing || !animationData) return []
    const op = animationData.op
    const cur = Math.round(frame)
    return [-12, -6, 6, 12]
      .map((d) => cur + d)
      .filter((f, i, arr) => f >= 0 && f <= op - 1 && f !== cur && arr.indexOf(f) === i)
      .map((f) => ({ f, past: f < cur }))
  })()


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
      const { half, offset } = layerAabbOf(sourceData, hoverIdx, Math.round(frame))
      hoverBox = { x: b[0] + offset[0], y: b[1] + offset[1], hw: half[0], hh: half[1] }
    }
  }

  // 레이어 i의 기준 위치/반크기 — 선택·드래그·스냅·히트테스트 공용
  const layerBase = (i: number): [number, number] | null => {
    const s = useEditor.getState()
    if (s.templateId !== '__custom' || !s.sourceData) return null
    // frameRef = 눈에 보이는 프레임 (재생 중에도 갱신) — curFrame은 재생 중 파킹돼
    // 히트테스트가 재생 시작 시점 위치를 보게 된다
    return layerBaseOf(s.sourceData, i, Math.round(frameRef.current))
  }


  /** 포인터 아래 모든 레이어 — 위(배열 앞)→아래 순. */
  const hitLayers = (px: number, py: number): number[] => {
    const s = useEditor.getState()
    const n = s.sourceData?.layers.length ?? 0
    const hits: number[] = []
    const anySolo = (s.sourceData?.layers as Record<string, unknown>[] | undefined)?.some(
      (l) => l.xsolo === true,
    )
    for (let i = 0; i < n; i++) {
      // 숨김·잠금·(솔로 중) 비솔로 레이어는 클릭/호버 대상에서 제외
      const lr = s.sourceData?.layers[i] as Record<string, unknown> | undefined
      if (lr?.hd || lr?.xlock === true) continue
      if (anySolo && lr?.xsolo !== true) continue
      const b = layerBase(i)
      if (!b || !s.sourceData) continue
      const { half, offset } = layerAabbOf(s.sourceData, i, Math.round(frameRef.current))
      if (Math.abs(px - b[0] - offset[0]) <= half[0] && Math.abs(py - b[1] - offset[1]) <= half[1])
        hits.push(i)
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
    size: number = cw,
    layerTargets: number[] = [],
  ): { shift: number; guide: number } | null => {
    const CENTER_TARGETS = [size / 2, 0, size / 4, (3 * size) / 4, size]
    const EDGE_TARGETS = [0, size / 2, size]
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
    // 스마트 가이드 — 다른 레이어 중앙/엣지에 내 중앙·양끝 흡착 (Figma)
    consider(t, layerTargets)
    consider(t - half, layerTargets)
    consider(t + half, layerTargets)
    return best
  }

  const onFrame = useCallback((f: number, total: number) => {
    frameRef.current = f
    setFrame(f)
    setTotalFrames(total)
  }, [])

  /** 로티 문서 라우팅 — 커스텀 모드면 레이어 변환 임포트(키프레임 유지), 아니면 문서 열기. */
  const routeLottieDoc = (doc: LottieJson, name: string) => {
    const s = useEditor.getState()
    if (s.mode === 'custom') {
      const res = s.importLottieLayers(doc)
      if (!res.added) {
        alert(t('가져올 수 있는 레이어가 없습니다 — 셰이프/이미지/솔리드 레이어만 지원합니다'))
        return
      }
      const parts = [
        t('레이어 {n}개 가져옴 (키프레임 유지)').replace('{n}', String(res.added)),
        ...(res.scenes ? [t('씬 {n}개 — 하단 탭에서 전환').replace('{n}', String(res.scenes))] : []),
        ...(res.skipped ? [t('건너뜀 {n}개').replace('{n}', String(res.skipped))] : []),
        ...res.warnings.map((w) => t(w)),
      ]
      if (res.skipped || res.warnings.length) alert(parts.join('\n'))
      return
    }
    load(doc, name)
  }

  const openFile = (file: File) => {
    // dotLottie(.lottie) — zip에서 애니메이션 추출
    if (/\.lottie$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then(async (buf) => {
          const inner = await readDotLottie(buf)
          if (!inner) {
            alert(t('dotLottie 파일을 읽을 수 없습니다'))
            return
          }
          routeLottieDoc(parseLottie(JSON.stringify(inner)), file.name.replace(/\.lottie$/i, ''))
        })
        .catch((e) => alert((e as Error).message))
      return
    }
    file.text().then((text) => {
      try {
        // 프로젝트 세이브 파일 (.lmproj.json) — 세션 복원
        const maybe = JSON.parse(text) as { app?: string; v?: number; sourceData?: unknown }
        if (maybe?.app === 'lottiemaker' && maybe.v === 1 && maybe.sourceData) {
          const s = useEditor.getState()
          // 히스토리 유무가 아니라 작업공간이 비어있지 않으면 확인 — 복원 직후 세션도 보호
          if (
            s.animationData &&
            !window.confirm(t('현재 작업을 프로젝트 파일 내용으로 교체할까요?'))
          )
            return
          s.restoreSession(maybe as Parameters<typeof s.restoreSession>[0])
          return
        }
      } catch {
        // JSON 파싱 실패 → 아래 parseLottie가 에러 메시지 처리
      }
      try {
        routeLottieDoc(parseLottie(text), file.name)
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
      const f = cw / rect.width
      at = [
        Math.max(0, Math.min(cw, (clientX - rect.left) * f)),
        Math.max(0, Math.min(ch, (clientY - rect.top) * f)),
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
        if (!window.confirm(t('그래픽 업로드는 커스텀 기능입니다. 커스텀으로 전환할까요?\n(템플릿 작업은 그대로 보관됩니다)')))
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
      {animationData && templateId !== '__custom' && (
        <div className="preview__modebar">
          <div className="segment segment--compact">
            <button
              className={`segment__btn ${mode === 'canvas' ? 'segment__btn--on' : ''}`}
              onClick={() => setMode('canvas')}
            >
              {t('미리보기')}
            </button>
            <button
              className={`segment__btn ${mode === 'mockup' ? 'segment__btn--on' : ''}`}
              onClick={() => setMode('mockup')}
            >
              {t('사용 예시')}
            </button>
          </div>
        </div>
      )}

      <div
        ref={canvasRef}
        // 배경 옵션(체커 등)은 아트보드 내부에만 — 바깥은 항상 페이스트보드
        className={`preview__canvas ${mode === 'mockup' ? 'preview__canvas--dark' : 'preview__canvas--board'} ${
          handActive && templateId === '__custom' && mode === 'canvas' ? 'preview__canvas--hand' : ''
        } ${drawTool && templateId === '__custom' && mode === 'canvas' ? 'preview__canvas--draw' : ''} ${
          tool === 'anchor' && templateId === '__custom' && mode === 'canvas' ? 'preview__canvas--anchor' : ''
        }`}
        onPointerDown={(e) => {
          if (templateId !== '__custom' || mode !== 'canvas') return
          // 휠(가운데) 버튼 드래그 = 임시 핸드 툴 — 어떤 툴이든 팬
          if (e.button === 1) {
            e.preventDefault() // 브라우저 오토스크롤 차단
            panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            return
          }
          if (e.button !== 0) return // 우클릭 등은 드로잉/마키에 안 섞이게
          // 앵커 포인트 툴 — 클릭 지점으로 피벗 이동 후 드래그 추적
          if (tool === 'anchor') {
            if ((e.target as HTMLElement).closest('.canvastools, .drawbar')) return
            const pt = toCanvasPt(e)
            if (!pt) return
            e.preventDefault()
            const st = useEditor.getState()
            // 선택 없으면 클릭 위치 레이어 먼저 픽
            if (!st.customIdxs.length) {
              const hit = pickLayer(pt[0], pt[1])
              if (hit === null) return
              setCustomIdx(hit)
            }
            anchorDrag.current = true
            applyAnchorDrag(pt)
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            return
          }
          // 드로잉 툴 — 캔버스 좌표로 도형 드래그 / 펜 포인트
          if (drawTool) {
            if ((e.target as HTMLElement).closest('.canvastools, .drawbar')) return
            const pt = toCanvasPt(e)
            if (!pt) return
            e.preventDefault()
            if (drawTool === 'pen') {
              // 편집 모드 + 포인트 선택 있음 → 빈 곳 드래그 = 포인트 마키 (AE)
              if (pathEditRef.current && penSelsRef.current.length && !penPtsRef.current.length) {
                pointMarquee.current = { x0: pt[0], y0: pt[1], add: e.shiftKey }
                setPmBox({ x0: pt[0], y0: pt[1], x1: pt[0], y1: pt[1] })
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                return
              }
              const pts = penPtsRef.current
              // 시작점 근처 클릭 = 닫힌 패스로 완성
              if (pts.length >= 3 && Math.hypot(pt[0] - pts[0].p[0], pt[1] - pts[0].p[1]) < 10) {
                finishPen(true)
                return
              }
              penHandleIdx.current = pts.length
              setPenSel(null)
              const next = [...pts, { p: pt, ho: null, hi: null } as PenPt]
              setPenPts(next)
              syncPenLayer(next) // 2점부터 실제 레이어 (일러 방식)
            } else {
              setDrawDrag({ x0: pt[0], y0: pt[1], x1: pt[0], y1: pt[1] })
            }
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            return
          }
          // 핸드 툴 — 캔버스 어디서든 팬
          if (handActive) {
            panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            return
          }
          // 무브 툴 — 페이스트보드(컴프 밖)에서 마키 시작 (AE 방식)
          if (tool === 'move') {
            const tgt2 = e.target as HTMLElement
            if (tgt2.closest('.canvastools, .drawbar, .scenetabs, .playbar, .customdrag, .selbox, .selhandle, .anchorbtn, .hoverbox, .allbox')) return
            // 캔버스 위 이벤트는 자식(customdrag)이 이미 처리 — 드래그/마키 진행 중이면 패스
            if (dragStart.current || selMarquee.current) return
            const rect = wrapRef.current?.getBoundingClientRect()
            if (!rect || rect.width < 1) return
            const f = cw / rect.width
            marqueeBegin(
              (e.clientX - rect.left) * f,
              (e.clientY - rect.top) * f,
              e.shiftKey || e.metaKey || e.ctrlKey,
            )
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }
        }}
        onPointerMove={(e) => {
          if (anchorDrag.current) {
            const pt = toCanvasPt(e)
            if (pt) applyAnchorDrag(pt)
            return
          }
          if (drawTool) {
            const pt = toCanvasPt(e)
            if (!pt) return
            if (drawTool === 'pen') {
              if (pointMarquee.current) {
                setPmBox({ x0: pointMarquee.current.x0, y0: pointMarquee.current.y0, x1: pt[0], y1: pt[1] })
                return
              }
              // 완성 패스 편집 드래그 — 캔버스 → 로컬 역변환 후 셰이프에 라이브 반영
              const ed = editDrag.current
              const pe = pathEditRef.current
              const M = editMRef.current
              if (ed && pe && M) {
                ed.moved = true
                const inv = M.inverse()
                const lq = inv.transformPoint(new DOMPoint(pt[0], pt[1]))
                const local: [number, number] = [lq.x, lq.y]
                // 그룹 이동 — 잡은 앵커 기준 델타를 선택 전체에
                if (ed.kind === 'anchor' && ed.group) {
                  const gdx = local[0] - ed.group.from[0]
                  const gdy = local[1] - ed.group.from[1]
                  const nextG = pe.pts.map((pp, i) => {
                    const gi = ed.group!.idxs.indexOf(i)
                    if (gi < 0) return pp
                    const st0 = ed.group!.starts[gi]
                    return { ...pp, p: [st0[0] + gdx, st0[1] + gdy] as [number, number] }
                  })
                  setPathEdit({ ...pe, pts: nextG })
                  useEditor.getState().setPenPathLive(pe.li, penPtsToK(nextG, pe.closed))
                  return
                }
                const next = pe.pts.map((pp, i) => {
                  if (i !== ed.idx) return pp
                  if (ed.kind === 'anchor') return { ...pp, p: local }
                  const v: [number, number] = [local[0] - pp.p[0], local[1] - pp.p[1]]
                  const hq = M.transformPoint(new DOMPoint(pp.p[0], pp.p[1]))
                  const dead = Math.hypot(pt[0] - hq.x, pt[1] - hq.y) < 2
                  if (ed.kind === 'pull')
                    return { ...pp, ho: dead ? null : v, hi: dead ? null : ([-v[0], -v[1]] as [number, number]) }
                  if (ed.kind === 'ho')
                    return {
                      ...pp,
                      ho: dead ? null : v,
                      hi: e.altKey ? pp.hi : dead ? null : ([-v[0], -v[1]] as [number, number]),
                    }
                  return {
                    ...pp,
                    hi: dead ? null : v,
                    ho: e.altKey ? pp.ho : dead ? null : ([-v[0], -v[1]] as [number, number]),
                  }
                })
                setPathEdit({ ...pe, pts: next })
                useEditor.getState().setPenPathLive(pe.li, penPtsToK(next, pe.closed))
                return
              }
              // 고스트 앵커/핸들 드래그 편집 (일러 방식 — ⌥ = 한쪽 핸들만)
              const gd = ghostDrag.current
              if (gd) {
                gd.moved = true
                if (gd.kind === 'anchor' && gd.group) {
                  const gdx = pt[0] - gd.group.from[0]
                  const gdy = pt[1] - gd.group.from[1]
                  const nextG = penPtsRef.current.map((pp, i) => {
                    const gi = gd.group!.idxs.indexOf(i)
                    if (gi < 0) return pp
                    const st0 = gd.group!.starts[gi]
                    return { ...pp, p: [st0[0] + gdx, st0[1] + gdy] as [number, number] }
                  })
                  setPenPts(nextG)
                  syncPenLayer(nextG)
                  return
                }
                const next = penPtsRef.current.map((pp, i) => {
                  if (i !== gd.idx) return pp
                  if (gd.kind === 'anchor') return { ...pp, p: pt }
                  const v: [number, number] = [pt[0] - pp.p[0], pt[1] - pp.p[1]]
                  const dead = Math.hypot(v[0], v[1]) < 2
                  // ⌥드래그 핸들 뽑기 — 대칭 스무스 핸들 (AE 포인트 변환)
                  if (gd.kind === 'pull')
                    return {
                      ...pp,
                      ho: dead ? null : v,
                      hi: dead ? null : ([-v[0], -v[1]] as [number, number]),
                    }
                  if (gd.kind === 'ho')
                    return {
                      ...pp,
                      ho: dead ? null : v,
                      hi: e.altKey ? pp.hi : dead ? null : ([-v[0], -v[1]] as [number, number]),
                    }
                  return {
                    ...pp,
                    hi: dead ? null : v,
                    ho: e.altKey ? pp.ho : dead ? null : ([-v[0], -v[1]] as [number, number]),
                  }
                })
                setPenPts(next)
                syncPenLayer(next)
                return
              }
              const hidx = penHandleIdx.current
              if (hidx !== null) {
                // 새 앵커에서 끌면 스무스 포인트 (대칭 핸들)
                const next = penPtsRef.current.map((pp, i) => {
                  if (i !== hidx) return pp
                  const dx = pt[0] - pp.p[0]
                  const dy = pt[1] - pp.p[1]
                  const dead = Math.hypot(dx, dy) < 2
                  return {
                    ...pp,
                    ho: dead ? null : ([dx, dy] as [number, number]),
                    hi: dead ? null : ([-dx, -dy] as [number, number]),
                  }
                })
                setPenPts(next)
                syncPenLayer(next)
              } else if (penPtsRef.current.length) {
                // AE 방식 — 기존 포인트/핸들 위(선택·변환 커서)에선 예상 경로 숨김
                const onPoint = (e.target as HTMLElement).closest?.(
                  '.drawghost__anchor, .drawghost__hdot',
                )
                setPenHover(onPoint ? null : pt)
              }
              return
            }
            setDrawDrag((dd) => {
              if (!dd) return dd
              let [x1, y1] = pt
              if (e.shiftKey) {
                const dx = x1 - dd.x0
                const dy = y1 - dd.y0
                if (drawTool === 'line') {
                  // 45° 스냅
                  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
                  const len = Math.hypot(dx, dy)
                  x1 = dd.x0 + Math.cos(ang) * len
                  y1 = dd.y0 + Math.sin(ang) * len
                } else {
                  // 정비율
                  const m = Math.max(Math.abs(dx), Math.abs(dy))
                  x1 = dd.x0 + Math.sign(dx || 1) * m
                  y1 = dd.y0 + Math.sign(dy || 1) * m
                }
              }
              return { ...dd, x1, y1 }
            })
            return
          }
          // 페이스트보드 마키 진행 — 캡처가 스테이지에 있을 때
          if (selMarquee.current && !dragStart.current && !drawTool) {
            marqueeMove(e.clientX, e.clientY)
            return
          }
          const d = panDrag.current
          if (!d) return
          setPanState({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
        }}
        onPointerUp={() => {
          if (anchorDrag.current) {
            anchorDrag.current = false
            useEditor.getState().commitEdit()
            return
          }
          if (drawTool === 'pen') {
            if (pointMarquee.current) {
              const mq = pointMarquee.current
              const box = pmBox
              pointMarquee.current = null
              setPmBox(null)
              const pe = pathEditRef.current
              const M = editMRef.current
              if (pe && M && box) {
                const xA = Math.min(box.x0, box.x1)
                const xB = Math.max(box.x0, box.x1)
                const yA = Math.min(box.y0, box.y1)
                const yB = Math.max(box.y0, box.y1)
                const tiny = xB - xA < 3 && yB - yA < 3
                const hits: number[] = []
                pe.pts.forEach((pp, i) => {
                  const q = M.transformPoint(new DOMPoint(pp.p[0], pp.p[1]))
                  if (q.x >= xA && q.x <= xB && q.y >= yA && q.y <= yB) hits.push(i)
                })
                if (tiny) setPenSels([]) // 클릭만 = 해제 (다음 클릭부터 새 패스)
                else if (mq.add)
                  // ⇧마키 = 토글 — 이미 선택된 포인트는 해제, 새 포인트는 추가 (일러 방식)
                  setPenSels((prev) => [
                    ...prev.filter((i) => !hits.includes(i)),
                    ...hits.filter((i) => !prev.includes(i)),
                  ])
                else setPenSels(hits)
              }
              return
            }
            const ed = editDrag.current
            if (ed) {
              const pe = pathEditRef.current
              if (pe && !ed.moved) {
                if (ed.kind === 'anchor') {
                  if (ed.add) togglePenSel(ed.idx)
                  else setPenSel(ed.idx)
                }
                else if (ed.kind === 'pull') {
                  // ⌥클릭 = 포인트 변환 토글 (코너 ↔ 스무스 — 시작 핸들 당겨진 상태)
                  const next = togglePenHandles(pe.pts, ed.idx, pe.closed)
                  setPathEdit({ ...pe, pts: next })
                  setPenSel(ed.idx)
                  useEditor.getState().setPenPathLive(pe.li, penPtsToK(next, pe.closed))
                  useEditor.getState().commitEdit()
                }
              } else if (ed.moved) {
                useEditor.getState().commitEdit()
              }
              editDrag.current = null
              penHandleIdx.current = null
              ghostDrag.current = null
              return
            }
            const gd = ghostDrag.current
            if (gd && !gd.moved) {
              if (gd.kind === 'anchor') {
                // 클릭(무이동) = 선택 (⇧ = 토글)
                if (gd.add) togglePenSel(gd.idx)
                else setPenSel(gd.idx)
              } else if (gd.kind === 'pull') {
                // ⌥클릭(무이동) = 포인트 변환 토글 (코너 ↔ 스무스 — 시작 핸들 당겨진 상태)
                const next = togglePenHandles(penPtsRef.current, gd.idx, false)
                setPenPts(next)
                setPenSel(gd.idx)
                syncPenLayer(next)
              }
            }
            penHandleIdx.current = null
            ghostDrag.current = null
          } else if (drawDrag) {
            commitDrawnShape(drawDrag)
            setDrawDrag(null)
          }
          if (selMarquee.current) {
            marqueeEnd()
            setShowAllBoxes(false)
          }
          panDrag.current = null
        }}
        onPointerCancel={() => {
          pointMarquee.current = null
          setPmBox(null)
          if (anchorDrag.current) {
            anchorDrag.current = false
            useEditor.getState().commitEdit()
          }
          setDrawDrag(null)
          penHandleIdx.current = null
          ghostDrag.current = null
          editDrag.current = null
          panDrag.current = null
        }}
        onDoubleClick={() => {
          // 펜 더블클릭 = 열린 패스로 완성 (두 번째 클릭이 만든 중복 점 제거)
          if (drawTool === 'pen' && penPtsRef.current.length >= 3) {
            finishPen(false, penPtsRef.current.slice(0, -1))
          }
        }}
      >
        {templateId === '__custom' && mode === 'canvas' && (
          <div className="canvastools">
            <span className="canvastools__zoom">{Math.round(zoom * 100)}%</span>
            <button
              className="canvastools__btn"
              title={t('100% / 중앙 (⌘0)')}
              onClick={() => {
                setZoom(1)
                setPanState({ x: 0, y: 0 })
              }}
            >
              <FitIcon />
            </button>
            <button
              className={`canvastools__btn ${onion ? 'canvastools__btn--on' : ''}`}
              title={t('어니언 스킨 — 전후 프레임 겹쳐 보기 (과거 흑백 / 미래 컬러)')}
              onClick={toggleOnion}
            >
              <LayersIcon />
            </button>
          </div>
        )}
        {/* 눈금자 — 캔버스 좌표 눈금, 드래그로 고정 가이드 생성 */}
        {templateId === '__custom' && mode === 'canvas' && animationData && !previewing && (() => {
          const wrapEl = wrapRef.current
          const stageEl = canvasRef.current
          if (!wrapEl || !stageEl) return null
          const wr = wrapEl.getBoundingClientRect()
          const sr = stageEl.getBoundingClientRect()
          const sx = wr.width / cw
          const ox = wr.left - sr.left
          const oy = wr.top - sr.top
          const ticks: number[] = []
          for (let v = 0; v <= cw; v += 50) ticks.push(v)
          return (
            <>
              <div
                className="ruler ruler--top"
                title={t('드래그: 가로 가이드 생성')}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  guideDrag.current = { axis: 'h', idx: -1, moved: false }
                }}
                onPointerMove={guideMove}
                onPointerUp={guideUp}
                onPointerCancel={guideUp}
              >
                {ticks.map((v) => (
                  <span key={v} className="ruler__tick" style={{ left: ox + v * sx }}>
                    {v}
                  </span>
                ))}
              </div>
              <div
                className="ruler ruler--left"
                title={t('드래그: 세로 가이드 생성')}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  guideDrag.current = { axis: 'v', idx: -1, moved: false }
                }}
                onPointerMove={guideMove}
                onPointerUp={guideUp}
                onPointerCancel={guideUp}
              >
                {ticks.map((v) => (
                  <span key={v} className="ruler__tick ruler__tick--v" style={{ top: oy + v * sx }}>
                    {v}
                  </span>
                ))}
              </div>
            </>
          )
        })()}
        {/* 드로잉 툴바 — Figma UI3 방식: 캔버스 하단 중앙 플로팅 */}
        {templateId === '__custom' && mode === 'canvas' && animationData && (
          <div className="drawbar">
            {(
              [
                { id: 'move', glyph: <CursorIcon />, tip: '이동 툴 (V)' },
                { id: 'hand', glyph: <HandIcon />, tip: '핸드 툴 (H)' },
                { id: 'anchor', glyph: <AnchorTargetIcon />, tip: '앵커 포인트 툴 (Y) — 드래그로 회전·스케일 피벗 이동 (그래픽은 제자리)' },
                { id: 'sep1', glyph: null, tip: '' },
                { id: 'rect', glyph: <SquareIcon />, tip: '사각형 (Q 순환) — 드래그로 그리기 · ⇧ 정사각형' },
                { id: 'ellipse', glyph: <CircleIcon />, tip: '원 (Q 순환) — 드래그로 그리기 · ⇧ 정원' },
                { id: 'polygon', glyph: <TriangleIcon />, tip: '삼각형 — 드래그로 그리기' },
                { id: 'star', glyph: <StarIcon />, tip: '별 — 드래그로 그리기' },
                { id: 'line', glyph: <LineIcon />, tip: '선 (Q 순환) — 드래그로 그리기 · ⇧ 45° 스냅' },
                { id: 'pen', glyph: <PenIcon />, tip: '펜 (G) — 클릭 = 점 · 클릭+드래그 = 곡선 · 그리는 중 앵커/핸들 드래그 편집 (⌥ = 한쪽 핸들만) · 시작점 클릭 = 닫기 · Enter/Esc = 완성' },
                { id: 'text', glyph: <span className="drawbar__glyphT">T</span>, tip: '텍스트 — 폰트를 패스로 변환해 추가 (.ttf/.otf 업로드)' },
              ] as { id: string; glyph: ReactNode; tip: string }[]
            ).map((b) =>
              b.id === 'sep1' ? (
                <span key={b.id} className="drawbar__sep" />
              ) : b.id === 'text' ? (
                <button
                  key={b.id}
                  className="drawbar__btn"
                  title={t(b.tip)}
                  onClick={() => setTextDlg(true)}
                >
                  {b.glyph}
                </button>
              ) : (
                <button
                  key={b.id}
                  className={`drawbar__btn ${tool === b.id ? 'drawbar__btn--on' : ''}`}
                  title={t(b.tip)}
                  onClick={() => switchTool(b.id as typeof tool)}
                >
                  {b.glyph}
                </button>
              ),
            )}
          </div>
        )}
        {textDlg && <TextDialog onClose={() => setTextDlg(false)} />}
        {animationData ? (
          mode === 'mockup' ? (
            <MockupView />
          ) : (
            <div
              ref={wrapRef}
              className={`preview__lottie preview__lottiewrap preview__lottiewrap--${bg}`}
              style={
                templateId === '__custom'
                  ? {
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      aspectRatio: `${cw} / ${ch}`,
                    }
                  : { aspectRatio: `${cw} / ${ch}` }
              }
            >
              {/* 빈 캔버스 시작 힌트 — 레이어가 생기면 사라짐 */}
              {templateId === '__custom' && (sourceData?.layers.length ?? 0) === 0 && !penPts.length && (
                <div className="canvashint">
                  <p>{t('드래그로 도형을 그리거나, 그래픽을 끌어다 놓으세요')}</p>
                  <p className="canvashint__keys">
                    <kbd>Q</kbd> {t('도형')} · <kbd>G</kbd> {t('펜')} · <kbd>T</kbd> {t('텍스트')} · <kbd>?</kbd> {t('단축키')}
                  </p>
                </div>
              )}
              {/* 어니언 스킨 — 전후 프레임 고스트 (과거 흑백 / 미래 컬러) */}
              {onionFrames.map((g) => (
                <div key={g.f} className={`onionghost ${g.past ? 'onionghost--past' : ''}`}>
                  <LottiePlayer
                    data={animationData}
                    playing={false}
                    seekFrame={g.f}
                    className="preview__lottiefill"
                  />
                </div>
              ))}
              {/* 드래그 이동은 내부 래퍼에만 — 가이드/오버레이는 고정 좌표 유지 */}
              <div className="preview__lottiefill">
                <LottiePlayer
                  data={animationData}
                  playing={playing}
                  speed={speed}
                  loop={loop}
                  instRef={lottieInst}
                  onFrame={onFrame}
                  seekFrame={seek}
                  replayToken={replayToken}
                  onComplete={() => setPlaying(false)}
                  className="preview__lottiefill"
                />
              </div>
              {/* 그라디언트 라인 (피그마) — 시작/끝 노브 드래그로 gf s/e 직접 이동 */}
              {gradInfo && gradM && !dragBox && (() => {
                const sP = new DOMPoint(gradInfo.s[0], gradInfo.s[1]).matrixTransform(gradM)
                const eP = new DOMPoint(gradInfo.e[0], gradInfo.e[1]).matrixTransform(gradM)
                const grab = (which: 's' | 'e') => (ev: React.PointerEvent) => {
                  if (ev.button !== 0) return
                  ev.stopPropagation()
                  ev.preventDefault()
                  ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
                  gradDrag.current = { which, li: gradInfo.li, moved: false }
                }
                const addStopAt = (ev: React.PointerEvent) => {
                  if (ev.button !== 0) return
                  ev.stopPropagation()
                  const rect = wrapRef.current?.getBoundingClientRect()
                  if (!rect) return
                  const f = cw / rect.width
                  const local = new DOMPoint(
                    (ev.clientX - rect.left) * f,
                    (ev.clientY - rect.top) * f,
                  ).matrixTransform(gradM.inverse())
                  const ex = gradInfo.e[0] - gradInfo.s[0]
                  const ey = gradInfo.e[1] - gradInfo.s[1]
                  const len2 = ex * ex + ey * ey || 1
                  const tv = Math.max(
                    0.02,
                    Math.min(0.98, ((local.x - gradInfo.s[0]) * ex + (local.y - gradInfo.s[1]) * ey) / len2),
                  )
                  // 이웃 스톱 색 보간
                  const list = gradInfo.stops.map((x) => ({ t: x.t, hex: x.hex }))
                  const sorted = [...list].sort((a, b) => a.t - b.t)
                  let a = sorted[0]
                  let b = sorted[sorted.length - 1]
                  for (let i = 0; i < sorted.length - 1; i++)
                    if (sorted[i].t <= tv && tv <= sorted[i + 1].t) {
                      a = sorted[i]
                      b = sorted[i + 1]
                      break
                    }
                  const u = b.t === a.t ? 0.5 : (tv - a.t) / (b.t - a.t)
                  const pa = [1, 3, 5].map((o) => parseInt(a.hex.slice(o, o + 2), 16))
                  const pb = [1, 3, 5].map((o) => parseInt(b.hex.slice(o, o + 2), 16))
                  const hx = `#${pa
                    .map((v, j) => Math.round(v + (pb[j] - v) * u).toString(16).padStart(2, '0'))
                    .join('')}`
                  const st2 = useEditor.getState()
                  st2.setLayerFillStopsLive(gradInfo.li, [...list, { t: tv, hex: hx }])
                  st2.commitEdit()
                }
                return (
                  <svg className="gradline" viewBox={`0 0 ${cw} ${ch}`}>
                    <line className="gradline__line" x1={sP.x} y1={sP.y} x2={eP.x} y2={eP.y} />
                    {/* 히트 라인 — 클릭 = 그 지점에 스톱 추가 (피그마) */}
                    <line
                      className="gradline__hit"
                      x1={sP.x}
                      y1={sP.y}
                      x2={eP.x}
                      y2={eP.y}
                      onPointerDown={addStopAt}
                    />
                    {/* 중간 스톱 노브 — 라인 축으로만 슬라이드 */}
                    {gradInfo.stops.map((sp2, i) => {
                      if (sp2.t <= 0.001 || sp2.t >= 0.999) return null
                      const px = sP.x + (eP.x - sP.x) * sp2.t
                      const py = sP.y + (eP.y - sP.y) * sp2.t
                      return (
                        <circle
                          key={`st${i}`}
                          className="gradline__knob gradline__knob--stop"
                          cx={px}
                          cy={py}
                          r={4.5}
                          style={{ fill: sp2.css }}
                          onPointerDown={(ev) => {
                            if (ev.button !== 0) return
                            ev.stopPropagation()
                            ev.preventDefault()
                            ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
                            gradDrag.current = {
                              which: 'stop',
                              li: gradInfo.li,
                              moved: false,
                              stopIdx: i,
                              stops: gradInfo.stops.map((x) => ({ t: x.t, hex: x.hex })),
                              ls: gradInfo.s,
                              le: gradInfo.e,
                            }
                          }}
                          onPointerMove={gradMove}
                          onPointerUp={gradUp}
                          onPointerCancel={gradUp}
                        />
                      )
                    })}
                    <circle
                      className="gradline__knob"
                      cx={sP.x}
                      cy={sP.y}
                      r={6}
                      style={{ fill: gradInfo.from }}
                      onPointerDown={grab('s')}
                      onPointerMove={gradMove}
                      onPointerUp={gradUp}
                      onPointerCancel={gradUp}
                    />
                    <circle
                      className="gradline__knob"
                      cx={eP.x}
                      cy={eP.y}
                      r={6}
                      style={{ fill: gradInfo.to }}
                      onPointerDown={grab('e')}
                      onPointerMove={gradMove}
                      onPointerUp={gradUp}
                      onPointerCancel={gradUp}
                    />
                  </svg>
                )
              })()}
              {/* 모션 패스 — 곡선 경로 + 프레임 점 + 드래그 가능한 키/공간 탄젠트 (AE) */}
              {motionPath && (
                <svg className="motionpath" viewBox={`0 0 ${cw} ${ch}`}>
                  <path className="motionpath__line" d={motionPath.d} fill="none" />
                  {motionPath.dots.map(([x, y], i) => (
                    <circle key={i} className="motionpath__dot" cx={x} cy={y} r={1.4} />
                  ))}
                  {tool === 'move' &&
                    motionPath.handles.map((h, i) => (
                      <g key={`h${i}`} className={`motionpath__tangent ${h.manual ? '' : 'motionpath__tangent--auto'}`}>
                        <line
                          x1={h.base[0]}
                          y1={h.base[1]}
                          x2={h.base[0] + h.off[0]}
                          y2={h.base[1] + h.off[1]}
                        />
                        <circle
                          className="motionpath__handle"
                          cx={h.base[0] + h.off[0]}
                          cy={h.base[1] + h.off[1]}
                          r={4}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            e.preventDefault()
                            ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
                            mpDrag.current = { kind: h.which, t: h.t, base: h.base, moved: false }
                          }}
                          onPointerMove={mpMove}
                          onPointerUp={mpUp}
                          onPointerCancel={mpUp}
                        />
                      </g>
                    ))}
                  {motionPath.keys.map((k, i) => (
                    <rect
                      key={`k${i}`}
                      className="motionpath__key"
                      x={k.p[0] - 3.5}
                      y={k.p[1] - 3.5}
                      width={7}
                      height={7}
                      onPointerDown={(e) => {
                        if (e.button !== 0 || tool !== 'move') return
                        e.stopPropagation()
                        e.preventDefault()
                        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
                        mpDrag.current = { kind: 'key', t: k.t, base: k.p, moved: false }
                      }}
                      onPointerMove={mpMove}
                      onPointerUp={mpUp}
                      onPointerCancel={mpUp}
                    />
                  ))}
                  <circle
                    className="motionpath__cur"
                    cx={motionPath.cur[0]}
                    cy={motionPath.cur[1]}
                    r={5}
                  />
                </svg>
              )}
              {/* 드로잉 고스트 — 그리는 중인 도형/펜 경로 미리보기 */}
              {drawTool && (drawDrag || penPts.length > 0 || (pathEdit && editM)) && (
                <svg className={`drawghost ${penAlt ? 'drawghost--alt' : ''}`} viewBox={`0 0 ${cw} ${ch}`}>
                  {drawDrag && drawTool === 'rect' && (
                    <rect
                      className="drawghost__shape"
                      x={Math.min(drawDrag.x0, drawDrag.x1)}
                      y={Math.min(drawDrag.y0, drawDrag.y1)}
                      width={Math.abs(drawDrag.x1 - drawDrag.x0)}
                      height={Math.abs(drawDrag.y1 - drawDrag.y0)}
                    />
                  )}
                  {drawDrag && drawTool === 'ellipse' && (
                    <ellipse
                      className="drawghost__shape"
                      cx={(drawDrag.x0 + drawDrag.x1) / 2}
                      cy={(drawDrag.y0 + drawDrag.y1) / 2}
                      rx={Math.abs(drawDrag.x1 - drawDrag.x0) / 2}
                      ry={Math.abs(drawDrag.y1 - drawDrag.y0) / 2}
                    />
                  )}
                  {drawDrag && (drawTool === 'polygon' || drawTool === 'star') && (
                    <polygon
                      className="drawghost__shape"
                      points={shapeGhostPoints(
                        drawTool,
                        Math.min(drawDrag.x0, drawDrag.x1),
                        Math.min(drawDrag.y0, drawDrag.y1),
                        Math.abs(drawDrag.x1 - drawDrag.x0),
                        Math.abs(drawDrag.y1 - drawDrag.y0),
                      )}
                    />
                  )}
                  {drawDrag && drawTool === 'line' && (
                    <line
                      className="drawghost__stroke"
                      x1={drawDrag.x0}
                      y1={drawDrag.y0}
                      x2={drawDrag.x1}
                      y2={drawDrag.y1}
                    />
                  )}
                  {/* 완성 패스 편집 오버레이 — 로컬 포인트를 행렬로 캔버스 좌표에 */}
                  {drawTool === 'pen' && !penPts.length && pathEdit && editM && (() => {
                    const mp = (pt: [number, number]): [number, number] => {
                      const q = editM.transformPoint(new DOMPoint(pt[0], pt[1]))
                      return [q.x, q.y]
                    }
                    // 아핀 변환은 베지어를 정확히 보존 — 절대점 매핑 후 상대 핸들 복원
                    const mpts = pathEdit.pts.map((pp) => {
                      const P = mp(pp.p)
                      const abs = (h: [number, number] | null) =>
                        h ? ((): [number, number] => { const A = mp([pp.p[0] + h[0], pp.p[1] + h[1]]); return [A[0] - P[0], A[1] - P[1]] })() : null
                      return { p: P, ho: abs(pp.ho), hi: abs(pp.hi) }
                    })
                    const grabEditKnob =
                      (kind: 'anchor' | 'ho' | 'hi') => (e: React.PointerEvent) => {
                        if (e.button !== 0) return
                        e.stopPropagation()
                        e.preventDefault()
                        const idx2 = Number((e.currentTarget as Element).getAttribute('data-i'))
                        const k2 = kind === 'anchor' && e.altKey ? 'pull' : kind
                        // 선택에 포함된 앵커를 잡으면 그룹째 이동 (AE)
                        const sels = penSelsRef.current
                        const group =
                          k2 === 'anchor' && sels.includes(idx2) && sels.length > 1
                            ? {
                                idxs: [...sels],
                                starts: sels.map((si) => [...pathEdit.pts[si].p] as [number, number]),
                                from: [...pathEdit.pts[idx2].p] as [number, number],
                              }
                            : null
                        editDrag.current = { kind: k2, idx: idx2, moved: false, add: e.shiftKey, group }
                        canvasRef.current?.setPointerCapture(e.pointerId)
                      }
                    return (
                      <>
                        <path className="drawghost__path" d={penPathD(mpts as PenPt[], pathEdit.closed)} />
                        {mpts.map((pp, i) => (
                          <g key={i}>
                            {pp.ho && (
                              <>
                                <line className="drawghost__handle" x1={pp.p[0]} y1={pp.p[1]} x2={pp.p[0] + pp.ho[0]} y2={pp.p[1] + pp.ho[1]} />
                                <circle className="drawghost__hdot" cx={pp.p[0] + pp.ho[0]} cy={pp.p[1] + pp.ho[1]} r={3} data-i={i} onPointerDown={grabEditKnob('ho')} />
                              </>
                            )}
                            {pp.hi && (
                              <>
                                <line className="drawghost__handle" x1={pp.p[0]} y1={pp.p[1]} x2={pp.p[0] + pp.hi[0]} y2={pp.p[1] + pp.hi[1]} />
                                <circle className="drawghost__hdot" cx={pp.p[0] + pp.hi[0]} cy={pp.p[1] + pp.hi[1]} r={3} data-i={i} onPointerDown={grabEditKnob('hi')} />
                              </>
                            )}
                            <circle
                              className={`drawghost__anchor ${penSels.includes(i) ? 'drawghost__anchor--sel' : ''}`}
                              cx={pp.p[0]}
                              cy={pp.p[1]}
                              r={penSels.includes(i) ? 5 : 4}
                              data-i={i}
                              onPointerDown={grabEditKnob('anchor')}
                            />
                          </g>
                        ))}
                      </>
                    )
                  })()}
                  {/* 포인트 마키 러버밴드 */}
                  {pmBox && (
                    <rect
                      className="drawghost__marquee"
                      x={Math.min(pmBox.x0, pmBox.x1)}
                      y={Math.min(pmBox.y0, pmBox.y1)}
                      width={Math.abs(pmBox.x1 - pmBox.x0)}
                      height={Math.abs(pmBox.y1 - pmBox.y0)}
                    />
                  )}
                  {drawTool === 'pen' && penPts.length > 0 && (
                    <>
                      <path className="drawghost__path" d={penPathD(penPts, false, penHover)} />
                      {penPts.map((pp, i) => {
                        const grabKnob =
                          (kind: 'anchor' | 'ho' | 'hi') => (e: React.PointerEvent) => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            e.preventDefault()
                            // 첫 앵커 클릭 = 닫힌 패스로 완성 (⌥는 편집이므로 제외)
                            if (kind === 'anchor' && i === 0 && penPtsRef.current.length >= 3 && !e.altKey) {
                              finishPen(true)
                              return
                            }
                            // ⌥앵커 = 포인트 변환 (클릭: 핸들 제거 / 드래그: 핸들 뽑기)
                            const k2 = kind === 'anchor' && e.altKey ? 'pull' : kind
                            const sels0 = penSelsRef.current
                            const grp =
                              k2 === 'anchor' && sels0.includes(i) && sels0.length > 1
                                ? {
                                    idxs: [...sels0],
                                    starts: sels0.map((si) => [...penPtsRef.current[si].p] as [number, number]),
                                    from: [...penPtsRef.current[i].p] as [number, number],
                                  }
                                : null
                            ghostDrag.current = { kind: k2, idx: i, moved: false, alt: e.altKey, add: e.shiftKey, group: grp }
                            setPenHover(null) // 조작 중엔 예상 경로 숨김 (AE)
                            canvasRef.current?.setPointerCapture(e.pointerId)
                          }
                        return (
                          <g key={i}>
                            {pp.ho && (
                              <>
                                <line
                                  className="drawghost__handle"
                                  x1={pp.p[0]}
                                  y1={pp.p[1]}
                                  x2={pp.p[0] + pp.ho[0]}
                                  y2={pp.p[1] + pp.ho[1]}
                                />
                                <circle
                                  className="drawghost__hdot"
                                  cx={pp.p[0] + pp.ho[0]}
                                  cy={pp.p[1] + pp.ho[1]}
                                  r={3}
                                  onPointerDown={grabKnob('ho')}
                                />
                              </>
                            )}
                            {pp.hi && (
                              <>
                                <line
                                  className="drawghost__handle"
                                  x1={pp.p[0]}
                                  y1={pp.p[1]}
                                  x2={pp.p[0] + pp.hi[0]}
                                  y2={pp.p[1] + pp.hi[1]}
                                />
                                <circle
                                  className="drawghost__hdot"
                                  cx={pp.p[0] + pp.hi[0]}
                                  cy={pp.p[1] + pp.hi[1]}
                                  r={3}
                                  onPointerDown={grabKnob('hi')}
                                />
                              </>
                            )}
                            <circle
                              className={`drawghost__anchor ${i === 0 && penPts.length >= 3 ? 'drawghost__anchor--first' : ''} ${penSels.includes(i) ? 'drawghost__anchor--sel' : ''}`}
                              cx={pp.p[0]}
                              cy={pp.p[1]}
                              r={penSels.includes(i) ? 5 : i === 0 && penPts.length >= 3 ? 5 : 4}
                              onPointerDown={grabKnob('anchor')}
                            />
                          </g>
                        )
                      })}
                    </>
                  )}
                </svg>
              )}
              {/* 마키 다중 선택 박스 */}
              {selMarqueeBox && (
                <div
                  className="canvasmarquee"
                  style={{
                    left: `${(selMarqueeBox.x / cw) * 100}%`,
                    top: `${(selMarqueeBox.y / ch) * 100}%`,
                    width: `${(selMarqueeBox.w / cw) * 100}%`,
                    height: `${(selMarqueeBox.h / ch) * 100}%`,
                  }}
                />
              )}
              <span className="canvasbadge">
                {animationData.w} × {animationData.h}
              </span>
              {templateId === '__custom' && (
                <>
                  {/* 고정 가이드 — 룰러에서 생성, 드래그 이동, 룰러 밖 드롭 삭제 */}
                  {!previewing &&
                    (((sourceData as unknown as Record<string, unknown> | null)?.xguides as
                      | { v: number[]; h: number[] }
                      | undefined)?.v ?? []).map((gv, gi) => (
                      <div
                        key={`gv${gi}`}
                        className="fixedguide fixedguide--v"
                        style={{ left: `${(gv / cw) * 100}%` }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          e.stopPropagation()
                          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                          guideDrag.current = { axis: 'v', idx: gi, moved: false }
                        }}
                        onPointerMove={guideMove}
                        onPointerUp={guideUp}
                        onPointerCancel={guideUp}
                      />
                    ))}
                  {!previewing &&
                    (((sourceData as unknown as Record<string, unknown> | null)?.xguides as
                      | { v: number[]; h: number[] }
                      | undefined)?.h ?? []).map((gh2, gi) => (
                      <div
                        key={`gh${gi}`}
                        className="fixedguide fixedguide--h"
                        style={{ top: `${(gh2 / ch) * 100}%` }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          e.stopPropagation()
                          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                          guideDrag.current = { axis: 'h', idx: gi, moved: false }
                        }}
                        onPointerMove={guideMove}
                        onPointerUp={guideUp}
                        onPointerCancel={guideUp}
                      />
                    ))}
                  {guides.v !== null && (
                    <div className="snapguide snapguide--v" style={{ left: `${(guides.v / cw) * 100}%` }}>
                      <span className="snapguide__label">{guides.v}</span>
                    </div>
                  )}
                  {guides.h !== null && (
                    <div className="snapguide snapguide--h" style={{ top: `${(guides.h / ch) * 100}%` }}>
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
                        left: `${((hoverBox.x - hoverBox.hw) / cw) * 100}%`,
                        top: `${((hoverBox.y - hoverBox.hh) / ch) * 100}%`,
                        width: `${((hoverBox.hw * 2) / cw) * 100}%`,
                        height: `${((hoverBox.hh * 2) / ch) * 100}%`,
                      }}
                    />
                  )}
                  {!previewing &&
                    !dragBox &&
                    customIdxs
                      .filter((i) => i !== idxClamped && sourceData?.layers[i])
                      .map((i) => {
                        const b = layerBaseOf(sourceData!, i, Math.round(frame))
                        if (!b) return null
                        const { half: [hw2, hh2], offset: [ox2, oy2] } = layerAabbOf(sourceData!, i, Math.round(frame))
                        return (
                          <div
                            key={`m${i}`}
                            className="selbox selbox--multi"
                            style={{
                              left: `${((b[0] + ox2 - hw2) / cw) * 100}%`,
                              top: `${((b[1] + oy2 - hh2) / ch) * 100}%`,
                              width: `${((hw2 * 2) / cw) * 100}%`,
                              height: `${((hh2 * 2) / ch) * 100}%`,
                            }}
                          />
                        )
                      })}
                  {/* 앵커 포인트 마커 (⊕) — 바운딩박스와 함께, 앵커 툴에서 드래그 대상 표시.
                      펜 모드에선 숨김 — 패스 앵커와 혼동 방지 */}
                  {anchorPt && !dragBox && drawTool !== 'pen' && (
                    <svg
                      className={`anchorpoint ${tool === 'anchor' ? 'anchorpoint--active' : ''}`}
                      viewBox="0 0 24 24"
                      style={{
                        left: `${(anchorPt[0] / cw) * 100}%`,
                        top: `${(anchorPt[1] / ch) * 100}%`,
                        transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                      }}
                    >
                      {/* 흰 케이싱(할로) — 어떤 배경에서도 링·십자가 분리돼 보이게 */}
                      <g className="anchorpoint__halo">
                        <circle cx="12" cy="12" r="6" />
                        <path d="M12 1v5M12 18v5M1 12h5M18 12h5" />
                      </g>
                      <g className="anchorpoint__ink">
                        <circle cx="12" cy="12" r="6" />
                        <path d="M12 1v5M12 18v5M1 12h5M18 12h5" />
                      </g>
                      <circle className="anchorpoint__dot" cx="12" cy="12" r="2" />
                    </svg>
                  )}
                  {selBox && (
                    <div
                      className="selbox"
                      style={{
                        left: `${((selBox.x - selBox.hw) / cw) * 100}%`,
                        top: `${((selBox.y - selBox.hh) / ch) * 100}%`,
                        width: `${((selBox.hw * 2) / cw) * 100}%`,
                        height: `${((selBox.hh * 2) / ch) * 100}%`,
                      }}
                    >
                      {!handActive &&
                        (['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                          <div
                            key={c}
                            className={`selhandle selhandle--${c}`}
                            style={{ transform: `scale(${1 / zoom})` }}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return
                              e.stopPropagation()
                              const rect = wrapRef.current?.getBoundingClientRect()
                              const st = useEditor.getState()
                              {
                                // applyLayerSize가 스케일 못 하는 레이어(씬 참조·bbox 메타 없는
                                // 셰이프)는 리사이즈 무시 — 보정 이동만 남아 레이어가 밀린다
                                const li0 = Math.min(st.customIdx, (st.sourceData?.layers.length ?? 1) - 1)
                                const lr0 = st.sourceData?.layers[li0] as Record<string, unknown> | undefined
                                const asset0 = (st.sourceData?.assets as Record<string, unknown>[] | undefined)?.find(
                                  (a) => a.id === lr0?.refId,
                                )
                                const sizable =
                                  (asset0 && typeof asset0.nw === 'number') ||
                                  typeof ((lr0?.shapes as Record<string, unknown>[] | undefined)?.[0] as Record<string, unknown> | undefined)?.bboxMax === 'number'
                                if (!sizable) return
                              }
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
                                f: cw / rect.width,
                                bx: b[0], by: b[1],
                                startSize,
                                ox: opp[0] - b[0], oy: opp[1] - b[1],
                                startDist: Math.max(
                                  8,
                                  Math.hypot(
                                    (e.clientX - rect.left) * (cw / rect.width) - b[0],
                                    (e.clientY - rect.top) * (cw / rect.width) - b[1],
                                  ),
                                ),
                                li, lastPx: startSize, lastAlt: false,
                                cx: selBox.x, cy: selBox.y, hw: selBox.hw, hh: selBox.hh,
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
                              d.lastPx = px
                              d.lastAlt = e.altKey
                              const k = px / d.startSize
                              // 고정점 — 기본: 반대 모서리, Alt: 기준점(앵커)
                              const fx = e.altKey ? d.bx : d.bx + d.ox
                              const fy = e.altKey ? d.by : d.by + d.oy
                              // 라이브 미리보기 — 재구축 없이 <g>를 고정점 기준 스케일
                              if (
                                applyXformOverlay(
                                  `translate(${fx} ${fy}) scale(${k}) translate(${-fx} ${-fy})`,
                                  d.li,
                                )
                              ) {
                                // 선택 박스도 같은 배율로 — store는 릴리즈에 1회
                                setDragBox({
                                  x: fx + (d.cx - fx) * k,
                                  y: fy + (d.cy - fy) * k,
                                  hw: d.hw * k,
                                  hh: d.hh * k,
                                })
                                return
                              }
                              // 내부 API 불가 폴백 — 기존 라이브 경로
                              const stt = useEditor.getState()
                              stt.setCustomSizeLive(px)
                              if (!e.altKey) {
                                stt.setCustomBaseLive(
                                  d.bx + (1 - k) * d.ox,
                                  d.by + (1 - k) * d.oy,
                                )
                              }
                            }}
                            onPointerUp={(e) => {
                              const d = resizeDrag.current
                              if (!d) return
                              resizeDrag.current = null
                              setDragBox(null)
                              ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                              // 오버레이 경로 — 릴리즈에 store 1회 반영 (재구축 1번)
                              clearMoveOverlay(false)
                              const stt = useEditor.getState()
                              if (d.lastPx !== d.startSize) {
                                stt.setCustomSizeLive(d.lastPx)
                                if (!d.lastAlt) {
                                  const k = d.lastPx / d.startSize
                                  stt.setCustomBaseLive(
                                    d.bx + (1 - k) * d.ox,
                                    d.by + (1 - k) * d.oy,
                                  )
                                }
                              }
                              stt.commitEdit()
                            }}
                            onPointerCancel={() => {
                              resizeDrag.current = null
                              setDragBox(null)
                              clearMoveOverlay(true)
                              useEditor.getState().cancelEdit()
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
                      const { half, offset } = layerAabbOf(sourceData, i, Math.round(frame))
                      return (
                        <div
                          key={i}
                          className="allbox"
                          style={{
                            left: `${((b[0] + offset[0] - half[0]) / cw) * 100}%`,
                            top: `${((b[1] + offset[1] - half[1]) / ch) * 100}%`,
                            width: `${((half[0] * 2) / cw) * 100}%`,
                            height: `${((half[1] * 2) / ch) * 100}%`,
                          }}
                        />
                      )
                    })}
                  {!handActive && !drawTool && (
                    <div
                      className={`customdrag ${hoverIdx !== null || dragBox ? 'customdrag--overlayer' : ''}`}
                      onDoubleClick={(e) => {
                        // 씬 레이어 더블클릭 = 씬 편집 진입 (AE 프리컴프 더블클릭)
                        const rect = wrapRef.current?.getBoundingClientRect()
                        if (!rect) return
                        const f = cw / rect.width
                        const hit = pickLayer((e.clientX - rect.left) * f, (e.clientY - rect.top) * f)
                        if (hit === null) return
                        const lr = useEditor.getState().sourceData?.layers[hit] as
                          | Record<string, unknown>
                          | undefined
                        if (Number(lr?.ty) === 0 && lr?.refId) {
                          const assets = (useEditor.getState().sourceData?.assets ?? []) as Record<
                            string,
                            unknown
                          >[]
                          if (assets.some((a) => a.id === lr.refId && a.xscene === true))
                            useEditor.getState().switchScene(String(lr.refId))
                        }
                      }}
                      title={t('드래그: 이동 · 빈 곳 드래그: 마키 다중 선택 (⇧ 추가) · Shift: 축 잠금 · Alt+드래그: 복제 · ⌘: 스냅 해제 · Esc: 취소')}
                      onPointerDown={(e) => {
                        // 좌클릭만 픽/드래그 — 휠클릭은 스테이지 팬으로 (버블)
                        if (e.button !== 0) return
                        const rect = wrapRef.current?.getBoundingClientRect()
                        if (!rect) return
                        const f = cw / rect.width
                        const px = (e.clientX - rect.left) * f
                        const py = (e.clientY - rect.top) * f
                        // 프리뷰 중 클릭 → 편집 모드로 복귀 (정지 + 박스 표시)
                        if (useEditor.getState().playing) setPlaying(false)
                        let hit = pickLayer(px, py)
                        if (hit === null) {
                          // 빈 곳 = 마키 다중 선택 시작 (⇧ = 기존 선택 유지·추가) — 클릭만이면 해제
                          marqueeBegin(px, py, e.shiftKey || e.metaKey || e.ctrlKey)
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
                        // 스냅/드래그 박스 — 회전·스케일 반영 AABB
                        const src2 = useEditor.getState().sourceData
                        const aabb = src2
                          ? layerAabbOf(src2, hit, Math.round(frameRef.current))
                          : { half: [60, 60] as [number, number], offset: [0, 0] as [number, number] }
                        // 스마트 가이드 타깃 — 드래그 대상(다중 선택 포함)·숨김 제외한
                        // 모든 레이어의 중앙/엣지 좌표 (그랩 시점 1회 수집)
                        const lx: number[] = []
                        const ly: number[] = []
                        if (src2) {
                          const selSet = useEditor.getState().customIdxs
                          const fr2 = Math.round(frameRef.current)
                          // 고정 가이드도 스냅 타깃
                          const xg = (src2 as unknown as Record<string, unknown>).xguides as
                            | { v: number[]; h: number[] }
                            | undefined
                          if (xg?.v) lx.push(...xg.v)
                          if (xg?.h) ly.push(...xg.h)
                          src2.layers.forEach((l, j) => {
                            if (j === hit || selSet.includes(j)) return
                            if ((l as Record<string, unknown>).hd === true) return
                            const b2 = layerBaseOf(src2, j, fr2)
                            if (!b2) return
                            const ab = layerAabbOf(src2, j, fr2)
                            const cx2 = b2[0] + ab.offset[0]
                            const cy2 = b2[1] + ab.offset[1]
                            lx.push(cx2, cx2 - ab.half[0], cx2 + ab.half[0])
                            ly.push(cy2, cy2 - ab.half[1], cy2 + ab.half[1])
                          })
                        }
                        dragStart.current = {
                          x: e.clientX, y: e.clientY, bx: base[0], by: base[1], f,
                          hw: aabb.half[0], hh: aabb.half[1],
                          ox: aabb.offset[0], oy: aabb.offset[1],
                          lx, ly,
                        }
                        dragLast.current = { tx: base[0], ty: base[1] }
                        setDragCoord({ x: base[0], y: base[1] })
                        e.currentTarget.setPointerCapture(e.pointerId)
                      }}
                      onPointerMove={(e) => {
                        const d = dragStart.current
                        // 마키 진행 — 박스 갱신 + 겹치는 레이어 라이브 선택
                        if (selMarquee.current && !d) {
                          marqueeMove(e.clientX, e.clientY)
                          return
                        }
                        if (!d) {
                          // 호버 하이라이트 — 선택될 레이어 미리 표시
                          const rect = wrapRef.current?.getBoundingClientRect()
                          if (!rect) return
                          const f = cw / rect.width
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
                          const sx = snapAxis(tx + d.ox, d.hw, snapDist, cw, d.lx)
                          if (sx) { tx += sx.shift; gv = sx.guide }
                          const sy = snapAxis(ty + d.oy, d.hh, snapDist, ch, d.ly)
                          if (sy) { ty += sy.shift; gh = sy.guide }
                        }
                        setGuides({ v: gv, h: gh })
                        setDragCoord({ x: tx, y: ty })
                        setDragBox({ x: tx + d.ox, y: ty + d.oy, hw: d.hw, hh: d.hh })
                        dragLast.current = { tx, ty }
                        // 라이브 미리보기 — 재구축 없이 <g> translate (릴리즈 때 store 1회)
                        if (!applyMoveOverlay(tx - d.bx, ty - d.by)) {
                          // 내부 API 불가 폴백 — 기존 rAF 라이브 경로
                          pendingBase.current = [tx, ty]
                          if (liveRaf.current === null)
                            liveRaf.current = requestAnimationFrame(flushLiveBase)
                        }
                      }}
                      onPointerLeave={() => {
                        if (!dragStart.current) setHoverIdx(null)
                      }}
                      onPointerUp={(e) => {
                        setShowAllBoxes(false)
                        marqueeEnd()
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
                        if (!d || !last) {
                          clearMoveOverlay(true)
                          return
                        }
                        // 마지막 위치 반영 후 히스토리 1회 커밋 — 오버레이는 재구축이 대체
                        clearMoveOverlay(false)
                        useEditor.getState().setCustomBaseLive(last.tx, last.ty)
                        useEditor.getState().commitEdit()
                      }}
                      onPointerCancel={() => {
                        // 제스처 중단 — 오버레이 복원 (store엔 아무것도 안 갔음)
                        clearMoveOverlay(true)
                        setShowAllBoxes(false)
                        marqueeEnd()
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
          // 빈 캔버스 — 문구만 모드별로 다르고 구조는 동일
          (() => {
            const empty =
              appMode === 'custom'
                ? {
                    title: t('그래픽을 끌어다 놓아 커스텀을 시작하세요'),
                    sub: t('SVG/PNG/JPG/WebP · 왼쪽 커스텀 패널에서도 업로드 가능 · 프로젝트 파일(.lmproj.json) 드롭 시 복원'),
                    btn: t('파일 열기'),
                  }
                : {
                    title: t('왼쪽에서 템플릿을 선택하세요'),
                    sub: t('로티 JSON · 프로젝트 파일(.lmproj.json)을 끌어다 놓아도 열립니다'),
                    btn: t('JSON 파일 열기'),
                  }
            return (
              <div className="preview__empty">
                <p className="preview__empty-title">{empty.title}</p>
                <p className="preview__empty-sub">{empty.sub}</p>
                <button className="btn btn--secondary" onClick={() => fileInputRef.current?.click()}>
                  {empty.btn}
                </button>
              </div>
            )
          })()
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
            title={playing ? t('일시정지 (Space)') : t('재생 (Space)')}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="btn btn--icon" onClick={replay} title={t('처음부터 재생 (루프 끄면 1회 재생)')}>
            <ReplayIcon />
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
            {t('루프')}
          </button>

          {mode === 'canvas' && (
            <div className="playbar__group">
              {(['checker', 'dark', 'light'] as const).map((b) => (
                <button
                  key={b}
                  className={`bgdot bgdot--${b} ${bg === b ? 'bgdot--on' : ''}`}
                  onClick={() => setBg(b)}
                  title={t('배경: {b}').replace('{b}', b)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 씬 탭 — 프리컴프 임포트 시 컴포지션 전환 (LottieFiles Creator 방식) */}
      {templateId === '__custom' && mode === 'canvas' && animationData && sceneTabs.length > 0 && (
        <div className="scenetabs">
          <button
            className={`scenetab ${activeScene === null ? 'scenetab--on' : ''}`}
            onClick={() => useEditor.getState().switchScene(null)}
          >
            <SceneIcon /> {t('메인 씬')}
          </button>
          {sceneTabs.map((sc) => (
            <button
              key={sc.id}
              className={`scenetab ${activeScene === sc.id ? 'scenetab--on' : ''}`}
              title={t('씬 편집 — 캔버스에서 씬 레이어 더블클릭으로도 진입')}
              onClick={() => useEditor.getState().switchScene(sc.id)}
            >
              <SceneIcon /> {sc.name}
            </button>
          ))}
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
