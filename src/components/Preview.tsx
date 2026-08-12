import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditor } from '../store'
import { t } from '../lib/i18n'
import {
  CursorIcon, HandIcon, SquareIcon, CircleIcon, TriangleIcon, StarIcon, LineIcon, PenIcon, AnchorTargetIcon,
  PlayIcon, PauseIcon, ReplayIcon, FitIcon, LayersIcon, SceneIcon,
} from './icons'
import { durationSec, parseLottie, type LottieJson } from '../lib/lottieUtils'
import { svgToLottie, readImageFile } from '../lib/svgImport'
import {
  layerHalfOf, layerAabbOf, layerBaseOf, layerRotationOf, normKf, kfValueAt,
  kfChannelKeys, normSel, animSpans, kfFallbackValue,
  type CustomPayload, type CustomKf, type CustomSel, type KfChannel,
} from '../lib/customBuilder'
import LottiePlayer from './LottiePlayer'
import MockupView from './MockupView'
import Timeline from './Timeline'
import {
  buildShapeSvg, buildPenSvg, penPathD, shapeGhostPoints, STROKE_W,
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
  } | null>(null)
  const [penSel, setPenSel] = useState<number | null>(null)
  const penSelRef = useRef(penSel)
  penSelRef.current = penSel
  // 완성된 패스 재편집 (일러 직접 선택) — 포인트는 셰이프 로컬 좌표, 표시용 로컬→캔버스 행렬
  const [pathEdit, setPathEdit] = useState<{ li: number; pts: PenPt[]; closed: boolean } | null>(null)
  const pathEditRef = useRef(pathEdit)
  pathEditRef.current = pathEdit
  const [editM, setEditM] = useState<DOMMatrix | null>(null)
  const editMRef = useRef(editM)
  editMRef.current = editM
  const editDrag = useRef<{ kind: 'anchor' | 'ho' | 'hi' | 'pull'; idx: number; moved: boolean } | null>(null)

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
    const k = (found[0].ks as Record<string, unknown> | undefined)?.k as
      | { v: [number, number][]; i: [number, number][]; o: [number, number][]; c?: boolean }
      | undefined
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
  }, [templateId, tool, customIdx, sourceData, penPts.length])

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
      for (const cand of Array.from(svg.querySelectorAll('path'))) {
        const m = (cand.getAttribute('d') ?? '').match(/M\s*(-?[\d.]+)[ ,](-?[\d.]+)/)
        if (m && Math.abs(Number(m[1]) - v0[0]) < 0.6 && Math.abs(Number(m[2]) - v0[1]) < 0.6) {
          el = cand as SVGPathElement
          break
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
    useEditor
      .getState()
      .addCustomLayer(
        { kind: 'svg', graphic: svgToLottie(svg) },
        t(TOOL_NAMES[dt]),
        [(dd.x0 + dd.x1) / 2, (dd.y0 + dd.y1) / 2],
        size,
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
          const selIdx = penSelRef.current
          if (selIdx !== null && selIdx < pe.pts.length && pe.pts.length > 2) {
            const pts = pe.pts.filter((_, i) => i !== selIdx)
            setPathEdit({ ...pe, pts })
            setPenSel(null)
            s.setPenPathLive(pe.li, penPtsToK(pts, pe.closed))
            s.commitEdit()
          }
          return
        }
        if (toolRef.current === 'pen' && penPtsRef.current.length) {
          // 선택 앵커가 있으면 그 점, 없으면 마지막 점
          const selIdx = penSelRef.current
          if (selIdx !== null && selIdx < penPtsRef.current.length) {
            const rest = penPtsRef.current.filter((_, i) => i !== selIdx)
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
    return {
      keys: pk.map((k) => k.p as [number, number]),
      dots,
      cur: kfValueAt(xkf, 'p', Math.round(frame), fb) as [number, number],
    }
  })()

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
              // 완성 패스 편집 드래그 — 캔버스 → 로컬 역변환 후 셰이프에 라이브 반영
              const ed = editDrag.current
              const pe = pathEditRef.current
              const M = editMRef.current
              if (ed && pe && M) {
                ed.moved = true
                const inv = M.inverse()
                const lq = inv.transformPoint(new DOMPoint(pt[0], pt[1]))
                const local: [number, number] = [lq.x, lq.y]
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
                setPenHover(pt)
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
            const ed = editDrag.current
            if (ed) {
              const pe = pathEditRef.current
              if (pe && !ed.moved) {
                if (ed.kind === 'anchor') setPenSel(ed.idx)
                else if (ed.kind === 'pull') {
                  // ⌥클릭 = 핸들 제거 (스무스 → 코너)
                  const next = pe.pts.map((pp, i) => (i === ed.idx ? { ...pp, ho: null, hi: null } : pp))
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
                // 클릭(무이동) = 앵커 선택
                setPenSel(gd.idx)
              } else if (gd.kind === 'pull') {
                // ⌥클릭(무이동) = 핸들 제거 (스무스 → 코너, AE 포인트 변환 클릭)
                const next = penPtsRef.current.map((pp, i) =>
                  i === gd.idx ? { ...pp, ho: null, hi: null } : pp,
                )
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
              ] as { id: string; glyph: ReactNode; tip: string }[]
            ).map((b) =>
              b.id === 'sep1' ? (
                <span key={b.id} className="drawbar__sep" />
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
                  onFrame={onFrame}
                  seekFrame={seek}
                  replayToken={replayToken}
                  onComplete={() => setPlaying(false)}
                  className="preview__lottiefill"
                />
              </div>
              {/* 모션 패스 — 위치 키 경로 (점선) + 프레임 점 + 키 마커 + 현재 위치 */}
              {motionPath && (
                <svg className="motionpath" viewBox={`0 0 ${cw} ${ch}`}>
                  <polyline
                    className="motionpath__line"
                    points={motionPath.keys.map(([x, y]) => `${x},${y}`).join(' ')}
                  />
                  {motionPath.dots.map(([x, y], i) => (
                    <circle key={i} className="motionpath__dot" cx={x} cy={y} r={1.4} />
                  ))}
                  {motionPath.keys.map(([x, y], i) => (
                    <rect
                      key={`k${i}`}
                      className="motionpath__key"
                      x={x - 3}
                      y={y - 3}
                      width={6}
                      height={6}
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
                <svg className="drawghost" viewBox={`0 0 ${cw} ${ch}`}>
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
                        const k2 = kind === 'anchor' && e.altKey ? 'pull' : kind
                        editDrag.current = { kind: k2, idx: Number((e.currentTarget as Element).getAttribute('data-i')), moved: false }
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
                              className={`drawghost__anchor ${penSel === i ? 'drawghost__anchor--sel' : ''}`}
                              cx={pp.p[0]}
                              cy={pp.p[1]}
                              r={penSel === i ? 5 : 4}
                              data-i={i}
                              onPointerDown={grabEditKnob('anchor')}
                            />
                          </g>
                        ))}
                      </>
                    )
                  })()}
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
                            ghostDrag.current = { kind: k2, idx: i, moved: false, alt: e.altKey }
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
                              className={`drawghost__anchor ${i === 0 && penPts.length >= 3 ? 'drawghost__anchor--first' : ''} ${penSel === i ? 'drawghost__anchor--sel' : ''}`}
                              cx={pp.p[0]}
                              cy={pp.p[1]}
                              r={penSel === i ? 5 : i === 0 && penPts.length >= 3 ? 5 : 4}
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
                  {/* 앵커 포인트 마커 (⊕) — 바운딩박스와 함께, 앵커 툴에서 드래그 대상 표시 */}
                  {anchorPt && !dragBox && (
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
                        dragStart.current = {
                          x: e.clientX, y: e.clientY, bx: base[0], by: base[1], f,
                          hw: aabb.half[0], hh: aabb.half[1],
                          ox: aabb.offset[0], oy: aabb.offset[1],
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
                          const sx = snapAxis(tx + d.ox, d.hw, snapDist)
                          if (sx) { tx += sx.shift; gv = sx.guide }
                          const sy = snapAxis(ty + d.oy, d.hh, snapDist, ch)
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
                        if (!d || !last) return
                        // 마지막 위치 반영 후 히스토리 1회 커밋
                        useEditor.getState().setCustomBaseLive(last.tx, last.ty)
                        useEditor.getState().commitEdit()
                      }}
                      onPointerCancel={() => {
                        // 제스처 중단 — 스턱 드래그 방지, 진행분은 커밋
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
