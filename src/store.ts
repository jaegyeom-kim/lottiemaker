import { create } from 'zustand'
import type { LottieJson, LottieLayer } from './lib/lottieUtils'
import { extractColorGroups, replaceColor, type ColorGroup } from './lib/lottieColors'
import { toggleLayer as toggleLayerUtil, resize as resizeUtil } from './lib/lottieUtils'
import { applyKnobs, type TemplateKnob } from './lib/lottieKnobs'
import {
  buildAnimKs, buildCustomDoc, buildCustomLayer, animSpans, normSel,
  layerHalfOf, layerCenterOffsetOf,
  CUSTOM_ASSET_PREFIX, DEFAULT_SEL, type CustomSel, type CustomPayload,
} from './lib/customBuilder'

const HISTORY_CAP = 50

/**
 * 히스토리 한 칸. 노브는 source(노브 미적용 원본)에서 재계산되므로
 * data만 저장하면 undo 후 노브 조작이 어긋난다 — 셋을 함께 스냅샷.
 */
interface Snapshot {
  /** null = 빈 작업공간(커스텀 전체 삭제 등) — undo/redo가 빈 상태를 오갈 수 있어야 한다. */
  data: LottieJson | null
  source: LottieJson | null
  knobValues: Record<string, number | string>
  templateKnobs: TemplateKnob[]
  customIdx: number
  customIdxs?: number[]
  templateId: string | null
}

/** localStorage 자동 저장 페이로드. */
export interface SavedSession {
  v: 1
  sourceData: LottieJson
  pristineData: LottieJson | null
  templateId: string | null
  templateKnobs: TemplateKnob[]
  knobValues: Record<string, number | string>
  fileName: string
  customIdx: number
}

export type SaveKind = 'template' | 'custom'
const SAVE_KEYS: Record<SaveKind, string> = {
  template: 'lottiemaker.session.template.v1',
  custom: 'lottiemaker.session.custom.v1',
}
const LAST_KEY = 'lottiemaker.session.last'

/** 모드별 작업공간 스냅샷 — 탭 전환 시 통째로 스왑되어 어느 쪽 작업도 사라지지 않는다. */
interface Workspace {
  animationData: LottieJson | null
  fileName: string
  colorGroups: ColorGroup[]
  past: Snapshot[]
  future: Snapshot[]
  sourceData: LottieJson | null
  pristineData: LottieJson | null
  templateKnobs: TemplateKnob[]
  knobValues: Record<string, number | string>
  templateId: string | null
  customIdx: number
  customIdxs: number[]
  loop: boolean
}
const modeStash: Record<SaveKind, Workspace | null> = { template: null, custom: null }

/** 시작 모드 — 마지막으로 작업한 쪽. 저장 기록이 없으면 템플릿 갤러리. */
function initialMode(): SaveKind {
  try {
    return localStorage.getItem(LAST_KEY) === 'custom' ? 'custom' : 'template'
  } catch {
    return 'template'
  }
}

/** 저장된 세션 읽기 — 손상/버전 불일치는 무시. */
export function loadSavedSession(kind: SaveKind): SavedSession | null {
  try {
    const raw = localStorage.getItem(SAVE_KEYS[kind])
    if (!raw) return null
    const s = JSON.parse(raw) as SavedSession
    if (s.v !== 1 || !s.sourceData?.layers) return null
    return s
  } catch {
    return null
  }
}

/**
 * 마지막으로 작업한 모드의 세션만 — 다른 모드로 넘어가지 않는다.
 * (반대 모드의 작업은 탭 전환 시 setMode가 슬롯에서 복원하므로 유실 없음.
 *  넘어가면 새로고침 후 첫 화면의 탭·캔버스가 마지막 상태와 어긋난다.)
 */
export function loadLastSession(): SavedSession | null {
  return loadSavedSession(initialMode())
}

interface EditorState {
  animationData: LottieJson | null
  fileName: string
  colorGroups: ColorGroup[]
  past: Snapshot[]
  future: Snapshot[]
  /** 드래그형 편집(색상 피커/노브 슬라이더) 세션 시작 스냅샷 — 커밋 시 한 번만 히스토리에 올린다. */
  editBaseline: Snapshot | null

  /** 노브 미적용 원본. 색상/레이어/크기 편집은 여기에도 미러된다. 템플릿이 아니면 null. */
  sourceData: LottieJson | null
  /** 템플릿 로드 시점의 완전 원본 — 색상/그래픽 편집도 안 닿는다. 전체 초기화용. */
  pristineData: LottieJson | null
  templateKnobs: TemplateKnob[]
  knobValues: Record<string, number | string>
  /** 로드된 템플릿 id — 커스텀 그래픽 슬롯 조회용. 파일 로드 시 null. */
  templateId: string | null
  /** 작업 모드 — 사이드바 탭·캔버스·우측 패널이 전부 이 값 하나로 갈린다. */
  mode: SaveKind
  /** 자동 저장 결과 — saved: 기록됨 / skipped: 저장 대상 아님 / blocked: 용량 초과 등 실패. */
  saveStatus: 'saved' | 'skipped' | 'blocked'

  // 재생 상태 (파일에는 저장 안 됨)
  playing: boolean
  speed: number
  loop: boolean
  bg: string
  /** 증가할 때마다 프리뷰가 0프레임부터 재생 — 인터랙션 1회 확인용. */
  replayToken: number

  loadTemplate: (data: LottieJson, id: string, knobs: TemplateKnob[]) => void
  load: (data: LottieJson, fileName: string) => void
  /** 모드 전환 — 현재 작업공간을 보관하고 대상 모드의 작업공간(스태시 → 저장 슬롯 순)으로 스왑. */
  setMode: (m: SaveKind) => void
  /** 자동 저장된 세션 복원 — 앱 시작 시 1회. */
  restoreSession: (s: SavedSession) => void
  setColorLive: (group: ColorGroup, hex: string) => void
  setKnobLive: (id: string, value: number | string) => void
  /** 템플릿 전체 초기화 — 노브·색상·커스텀 그래픽·크기 전부 로드 시점 원본으로 (undo 가능). */
  resetTemplate: () => void
  commitEdit: () => void
  toggleLayer: (index: number) => void
  setSize: (w: number, h: number) => void
  /** match로 시작하는 레이어들의 셰이프를 커스텀 그래픽 그룹으로 교체 (원본에도 미러). */
  applyGraphicToSlot: (match: string, group: unknown) => void
  /** match로 시작하는 레이어들을 임베드 이미지 레이어(ty:2)로 교체 (원본에도 미러). anchor = 0~1 비율 기준점. */
  applyImageToSlot: (match: string, dataUri: string, w: number, h: number, anchor?: [number, number]) => void
  /** 이미지 슬롯 앵커(기준점) 라이브 조절 — fx/fy 0~1 비율. 드래그 세션, commitEdit로 확정. */
  setImageAnchorLive: (match: string, fx: number, fy: number) => void
  /** 슬롯을 원본 레이어 기준으로 복원 — 셰이프/레이어 타입/앵커, 이미지 에셋 제거까지. */
  restoreSlot: (match: string, byName: Record<string, LottieLayer>) => void
  /** 커스텀 빌더: 주 선택 레이어 인덱스 (layers 배열 기준, 0 = 맨 위). */
  customIdx: number
  /** 다중 선택 — 항상 customIdx 포함. 이동/삭제/정렬은 전체, 속성 편집은 주 선택. */
  customIdxs: number[]
  setCustomIdx: (i: number) => void
  /** Shift/⌘ 클릭 — 선택 토글. */
  toggleCustomSel: (i: number) => void
  /** 빈 곳 클릭 — 선택 해제. */
  deselectCustom: () => void
  /** 다중 레이어 삭제 (인덱스 목록). */
  removeCustomLayers: (idxs: number[]) => void
  /** 커스텀 빌더: 그래픽 추가 — 세션 없으면 새 문서, 있으면 맨 위 레이어로. at = 배치 좌표. */
  addCustomLayer: (payload: CustomPayload, name: string, at?: [number, number]) => void
  /** 커스텀 빌더: 레이어 삭제 (에셋 포함). 마지막 레이어면 편집기 비움. */
  removeCustomLayer: (i: number) => void
  /** 커스텀 빌더: 선택 레이어의 프리셋 채널 교체 — 위치는 유지. */
  setCustomChannels: (sel: CustomSel) => void
  /** 라이브 버전 — 드래그 세션(editBaseline), commitEdit로 확정. */
  setCustomChannelsLive: (sel: CustomSel) => void
  /** 커스텀 빌더: 크기 라이브 버전 — 리사이즈 핸들/슬라이더 드래그용. */
  setCustomSizeLive: (px: number) => void
  /** 커스텀 빌더: 레이어를 from에서 to 위치로 이동 (드래그 재정렬). */
  reorderCustomLayer: (from: number, to: number) => void
  /** 커스텀 빌더: 레이어 복제 — 에셋 분리, offset px 이동, 원본 위에 삽입. */
  duplicateCustomLayer: (i: number, offset?: number) => void
  /** 진행 중인 라이브 편집 취소 — editBaseline 시점으로 복원 (Esc). */
  cancelEdit: () => void
  /** 커스텀 빌더: 레이어 이름 변경. */
  renameCustomLayer: (i: number, name: string) => void
  /** 커스텀 빌더: 선택 레이어 기준 위치 이동(px). */
  nudgeCustomBase: (dx: number, dy: number) => void
  /** 라이브 절대 이동 — 캔버스 드래그 중 실시간 반영, commitEdit로 확정. */
  setCustomBaseLive: (x: number, y: number) => void
  /** 커스텀 빌더: 선택 레이어 크기(긴 변 px) 변경. */
  setCustomSize: (px: number) => void
  /** 커스텀: 선택 레이어 정렬 (일러 Align) — basis: 캔버스 또는 선택 영역(합집합 바운드). 선택 없으면 무시. */
  alignCustom: (
    mode: 'left' | 'hc' | 'right' | 'top' | 'vc' | 'bottom',
    basis?: 'canvas' | 'selection',
  ) => void
  /** 커스텀: 균등 분배 — 3개 이상 선택 시 선택끼리, 아니면 전체 레이어. */
  distributeCustom: (axis: 'h' | 'v') => void
  /** 커스텀 컴포지션 길이(초) — AE 컴프처럼 키프레임/클립은 절대 시간 유지. */
  setCompLength: (sec: number) => void
  setCompLengthLive: (sec: number) => void
  /** 커스텀 빌더: 앵커 포인트(0~1 비율) — 이미지 제자리 유지(팬비하인드). */
  setCustomAnchor: (fx: number, fy: number) => void
  /** 라이브 버전 — 드래그 패드용, commitEdit로 확정. */
  setCustomAnchorLive: (fx: number, fy: number) => void
  undo: () => void
  redo: () => void

  replay: () => void
  setPlaying: (v: boolean) => void
  setSpeed: (v: number) => void
  setLoop: (v: boolean) => void
  setBg: (v: string) => void
  setFileName: (v: string) => void
}

export const useEditor = create<EditorState>((set, get) => {
  const snap = (): Snapshot => {
    const { animationData, sourceData, knobValues, templateKnobs, customIdx, templateId } = get()
    return {
      data: animationData, source: sourceData, knobValues, templateKnobs,
      customIdx, customIdxs: get().customIdxs, templateId,
    }
  }

  /** 현재 상태를 past에 올리고 next 필드를 반영한다. 드래그 세션이 열려 있으면 먼저 커밋. */
  const push = (next: Partial<EditorState>) => {
    get().commitEdit()
    set({
      past: [...get().past.slice(-HISTORY_CAP + 1), snap()],
      future: [],
      ...next,
    })
  }

  /**
   * 현재 작업공간을 자기 모드의 스태시에 보관 — 모드 전환/교차 로드 직전에 호출.
   * 자동 저장도 즉시 반영해 디바운스 대기 중인 편집이 유실되지 않게 한다.
   */
  const stashCurrent = () => {
    const s = get()
    saveSessionNow()
    // 빈 작업공간도 undo 히스토리가 남아 있으면 보관 — 전체 삭제 후 탭을 오가도 undo 가능
    modeStash[s.mode] = s.animationData || s.past.length || s.future.length
      ? {
          animationData: s.animationData,
          fileName: s.fileName,
          colorGroups: s.colorGroups,
          past: s.past,
          future: s.future,
          sourceData: s.sourceData,
          pristineData: s.pristineData,
          templateKnobs: s.templateKnobs,
          knobValues: s.knobValues,
          templateId: s.templateId,
          customIdx: s.customIdx,
          customIdxs: s.customIdxs,
          loop: s.loop,
        }
      : null
  }

  /** xci(라벨 컬러) 누락 레이어 백필 — 순서와 무관하게 색이 고정되도록. */
  const ensureLayerColors = (doc: LottieJson) => {
    let next =
      Math.max(-1, ...doc.layers.map((l) => Number((l as Record<string, unknown>).xci ?? -1))) + 1
    for (const l of doc.layers) {
      const lr = l as Record<string, unknown>
      if (typeof lr.xci !== 'number') lr.xci = next++
    }
  }

  /** 레이어의 위치 채널 전체 + xbase를 균등 이동 (공유 배열 이중 시프트 방지). */
  const shiftLayer = (layer: Record<string, unknown>, dx: number, dy: number) => {
    const p = (layer.ks as Record<string, unknown>).p as { a?: number; k: unknown }
    if (p.a === 1 && Array.isArray(p.k)) {
      const seen = new Set<number[]>()
      for (const kf of p.k as { s?: number[] }[]) {
        if (Array.isArray(kf.s) && !seen.has(kf.s)) {
          seen.add(kf.s)
          kf.s[0] += dx
          kf.s[1] += dy
        }
      }
    } else if (Array.isArray(p.k)) {
      ;(p.k as number[])[0] += dx
      ;(p.k as number[])[1] += dy
    }
    if (Array.isArray(layer.xbase)) {
      ;(layer.xbase as number[])[0] += dx
      ;(layer.xbase as number[])[1] += dy
    }
  }

  /** 선택 레이어의 애니메이션(등장/루프/퇴장 + 회전/불투명도)을 sel로 재구성. */
  const withCustomChannels = (
    st: EditorState,
    sel: CustomSel,
  ): Pick<EditorState, 'animationData' | 'sourceData' | 'colorGroups'> | null => {
    const { sourceData, templateKnobs, knobValues, customIdx } = st
    if (!sourceData) return null
    const src = structuredClone(sourceData)
    ensureLayerColors(src)
    const layer = src.layers[Math.min(customIdx, src.layers.length - 1)] as Record<string, unknown>
    if (!layer) return null
    const ks = layer.ks as Record<string, unknown>
    const base: [number, number] = Array.isArray(layer.xbase)
      ? [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
      : [256, 256]
    layer.xbase = [...base]
    const compOp = src.op
    const full = normSel(sel, compOp)
    const anim = buildAnimKs(full, base, compOp)
    ks.p = anim.p
    ks.s = anim.s
    ks.o = anim.o
    ks.r = anim.r
    // 클립 구간 = 레이어 렌더 구간 (프리미어 클립 방식)
    const { clipA, clipB } = animSpans(full, compOp)
    layer.ip = clipA
    layer.op = clipB
    layer.xsel = structuredClone(full)
    const applied = applyKnobs(src, templateKnobs, knobValues)
    return { animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) }
  }

  /** 선택 레이어 크기 변경 (긴 변 px) — 래스터는 에셋, SVG는 래퍼 스케일. */
  const withCustomSize = (
    st: EditorState,
    px: number,
  ): Pick<EditorState, 'animationData' | 'sourceData' | 'colorGroups'> | null => {
    const { sourceData, templateKnobs, knobValues, customIdx } = st
    if (!sourceData) return null
    const src = structuredClone(sourceData)
    const layer = src.layers[Math.min(customIdx, src.layers.length - 1)] as Record<string, unknown>
    if (!layer) return null
    const asset = (src.assets as Record<string, unknown>[] | undefined)?.find(
      (a) => a.id === layer.refId,
    )
    if (asset && typeof asset.nw === 'number' && typeof asset.nh === 'number') {
      const oldW = asset.w as number
      const oldH = asset.h as number
      const f = px / Math.max(asset.nw as number, asset.nh as number)
      asset.w = Math.round((asset.nw as number) * f)
      asset.h = Math.round((asset.nh as number) * f)
      const a = ((layer.ks as Record<string, unknown>).a as { k: number[] }).k
      a[0] = (a[0] / oldW) * (asset.w as number)
      a[1] = (a[1] / oldH) * (asset.h as number)
    } else {
      const group = (layer.shapes as Record<string, unknown>[] | undefined)?.[0]
      const bboxMax = group?.bboxMax as number | undefined
      if (group && bboxMax) {
        const tr = (group.it as Record<string, unknown>[]).find((i) => i.ty === 'tr')
        if (tr) (tr.s as { k: number[] }).k = [(px / bboxMax) * 100, (px / bboxMax) * 100]
        // 앵커 오프셋도 비례 스케일 — 비율 유지
        const prev = ((layer.xsel as CustomSel | undefined)?.size ?? 240)
        const ak = ((layer.ks as Record<string, unknown>).a as { k: number[] }).k
        ak[0] = (ak[0] * px) / prev
        ak[1] = (ak[1] * px) / prev
      }
    }
    const xsel = { ...DEFAULT_SEL, ...((layer.xsel as Partial<CustomSel>) ?? {}) }
    layer.xsel = { ...xsel, size: px }
    const applied = applyKnobs(src, templateKnobs, knobValues)
    return { animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) }
  }

  /** 선택 레이어 앵커 변경 — 정지 자세(회전) 기준 포지션 보정으로 그래픽은 제자리. */
  const withCustomAnchor = (
    st: EditorState,
    fx: number,
    fy: number,
  ): Pick<EditorState, 'animationData' | 'sourceData' | 'colorGroups'> | null => {
    const { sourceData, templateKnobs, knobValues, customIdx } = st
    if (!sourceData) return null
    const src = structuredClone(sourceData)
    const layer = src.layers[Math.min(customIdx, src.layers.length - 1)] as Record<string, unknown>
    if (!layer) return null
    const ks = layer.ks as Record<string, unknown>
    const asset = (src.assets as Record<string, unknown>[] | undefined)?.find(
      (a) => a.id === layer.refId,
    )
    let newA: number[]
    if (asset) {
      newA = [(asset.w as number) * fx, (asset.h as number) * fy, 0]
    } else {
      const g = (layer.shapes as Record<string, unknown>[] | undefined)?.[0]
      const tr = (g?.it as Record<string, unknown>[] | undefined)?.find((i) => i.ty === 'tr')
      const sc = ((tr?.s as { k: number[] } | undefined)?.k[0] ?? 100) / 100
      const gw = ((g?.bboxW as number | undefined) ?? 120) * sc
      const gh = ((g?.bboxH as number | undefined) ?? 120) * sc
      newA = [(fx - 0.5) * gw, (fy - 0.5) * gh, 0]
    }
    const oldA = ((ks.a as { k?: number[] })?.k as number[]) ?? [0, 0, 0]
    const xsel = { ...DEFAULT_SEL, ...((layer.xsel as Partial<CustomSel>) ?? {}) }
    // 팬비하인드 — 앵커 이동분에 정착 회전 반영해 포지션 보정 (스케일은 항상 100으로 정착)
    const rad = ((xsel.rotation ?? 0) * Math.PI) / 180
    const da = [newA[0] - oldA[0], newA[1] - oldA[1]]
    const dx = da[0] * Math.cos(rad) - da[1] * Math.sin(rad)
    const dy = da[0] * Math.sin(rad) + da[1] * Math.cos(rad)
    ks.a = { a: 0, k: newA }
    const p = ks.p as { a?: number; k: unknown }
    if (p.a === 1 && Array.isArray(p.k)) {
      const seen = new Set<number[]>() // 공유 배열 이중 시프트 방지
      for (const kf of p.k as { s?: number[] }[]) {
        if (Array.isArray(kf.s) && !seen.has(kf.s)) {
          seen.add(kf.s)
          kf.s[0] += dx
          kf.s[1] += dy
        }
      }
    } else if (Array.isArray(p.k)) {
      ;(p.k as number[])[0] += dx
      ;(p.k as number[])[1] += dy
    }
    if (Array.isArray(layer.xbase)) {
      ;(layer.xbase as number[])[0] += dx
      ;(layer.xbase as number[])[1] += dy
    }
    layer.xsel = { ...xsel, anchor: [fx, fy] }
    const applied = applyKnobs(src, templateKnobs, knobValues)
    return { animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) }
  }

  /** 컴포지션 길이 변경 — 소스 op만 갱신, 레이어 키프레임/클립은 절대 시간 유지 (AE 컴프). */
  const withCompLength = (
    st: EditorState,
    sec: number,
  ): Pick<EditorState, 'animationData' | 'sourceData' | 'colorGroups'> | null => {
    const { sourceData, templateKnobs, knobValues } = st
    if (!sourceData) return null
    const src = structuredClone(sourceData)
    ensureLayerColors(src)
    src.op = Math.max(30, Math.min(600, Math.round(sec * 60)))
    const applied = applyKnobs(src, templateKnobs, knobValues)
    return { animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) }
  }

  return {
    animationData: null,
    fileName: 'animation',
    colorGroups: [],
    past: [],
    future: [],
    editBaseline: null,

    sourceData: null,
    pristineData: null,
    templateKnobs: [],
    knobValues: {},
    templateId: null,
    mode: initialMode(),
    saveStatus: 'skipped',

    customIdx: 0,
    customIdxs: [0],

    playing: true,
    speed: 1,
    loop: true,
    bg: 'checker',
    replayToken: 0,

    loadTemplate: (data, id, knobs) => {
      const m: SaveKind = id === '__custom' ? 'custom' : 'template'
      // 같은 모드 안의 교체라도 스태시 — 디바운스 대기 중인 직전 편집을 즉시 플러시
      stashCurrent()
      const values = Object.fromEntries(knobs.map((k) => [k.id, k.default]))
      // 일부 노브(arcChase)는 기본값에서도 원본을 변환하므로 로드 시점에 적용
      const applied = applyKnobs(data, knobs, values)
      set({
        animationData: applied,
        sourceData: structuredClone(data),
        pristineData: structuredClone(data),
        templateKnobs: knobs,
        knobValues: values,
        templateId: id,
        mode: m,
        fileName: id,
        colorGroups: extractColorGroups(applied),
        past: [],
        future: [],
        editBaseline: null,
        playing: true,
      })
    },

    load: (data, fileName) => {
      // 외부 로티 JSON은 템플릿 쪽 작업공간에서 연다 — 현재 작업은 보관·플러시
      stashCurrent()
      set({
        animationData: data,
        sourceData: null,
        pristineData: null,
        templateKnobs: [],
        knobValues: {},
        templateId: null,
        mode: 'template',
        fileName: fileName.replace(/\.json$/i, ''),
        colorGroups: extractColorGroups(data),
        past: [],
        future: [],
        editBaseline: null,
        playing: true,
      })
    },

    setMode: (m) => {
      if (get().mode === m) return
      get().commitEdit()
      stashCurrent()
      try {
        localStorage.setItem(LAST_KEY, m)
      } catch {
        // 저장 불가 환경 — 무시
      }
      const st = modeStash[m]
      if (st) {
        set({ ...st, mode: m, editBaseline: null, playing: false })
        return
      }
      const saved = loadSavedSession(m)
      if (saved) {
        get().restoreSession(saved)
        return
      }
      // 해당 모드에 보관된 작업 없음 — 빈 작업공간
      set({
        animationData: null,
        fileName: '',
        colorGroups: [],
        past: [],
        future: [],
        editBaseline: null,
        sourceData: null,
        pristineData: null,
        templateKnobs: [],
        knobValues: {},
        templateId: null,
        mode: m,
        customIdx: 0,
        customIdxs: [0],
        playing: false,
        loop: m === 'template',
      })
    },

    restoreSession: (s) => {
      const m: SaveKind = s.templateId === '__custom' ? 'custom' : 'template'
      stashCurrent()
      if (s.templateId === '__custom') {
        ensureLayerColors(s.sourceData)
        // 구버전 세션의 timeStretch 노브 제거 — 커스텀은 컴프 길이 방식
        s.templateKnobs = []
        s.knobValues = {}
      }
      const applied = applyKnobs(s.sourceData, s.templateKnobs, s.knobValues)
      set({
        animationData: applied,
        sourceData: structuredClone(s.sourceData),
        pristineData: s.pristineData ? structuredClone(s.pristineData) : null,
        templateKnobs: s.templateKnobs,
        knobValues: s.knobValues,
        templateId: s.templateId,
        mode: m,
        fileName: s.fileName,
        customIdx: s.customIdx ?? 0,
        customIdxs: [s.customIdx ?? 0],
        colorGroups: extractColorGroups(applied),
        past: [],
        future: [],
        editBaseline: null,
        playing: false,
        loop: m === 'template',
      })
    },

    setColorLive: (group, hex) => {
      const { animationData, sourceData, editBaseline } = get()
      if (!animationData) return
      const baseline = editBaseline ?? snap()
      const next = replaceColor(animationData, group.refs, hex) as LottieJson
      set({
        animationData: next,
        colorGroups: extractColorGroups(next),
        // 노브는 색상을 건드리지 않으므로 경로가 동일 — 원본에도 그대로 미러
        sourceData: sourceData ? (replaceColor(sourceData, group.refs, hex) as LottieJson) : null,
        editBaseline: baseline,
        future: [],
      })
    },

    setKnobLive: (id, value) => {
      const { sourceData, templateKnobs, knobValues, editBaseline } = get()
      if (!sourceData) return
      const baseline = editBaseline ?? snap()
      const values = { ...knobValues, [id]: value }
      const next = applyKnobs(sourceData, templateKnobs, values)
      set({
        animationData: next,
        colorGroups: extractColorGroups(next),
        knobValues: values,
        editBaseline: baseline,
        future: [],
      })
    },

    resetTemplate: () => {
      const { pristineData, templateKnobs } = get()
      if (!pristineData) return
      const values = Object.fromEntries(templateKnobs.map((k) => [k.id, k.default]))
      const applied = applyKnobs(pristineData, templateKnobs, values)
      push({
        animationData: applied,
        sourceData: structuredClone(pristineData),
        knobValues: values,
        colorGroups: extractColorGroups(applied),
      })
    },

    commitEdit: () => {
      const { editBaseline, past } = get()
      if (!editBaseline) return
      set({
        past: [...past.slice(-HISTORY_CAP + 1), editBaseline],
        editBaseline: null,
      })
    },

    cancelEdit: () => {
      const b = get().editBaseline
      if (!b) return
      set({
        animationData: b.data,
        sourceData: b.source,
        knobValues: b.knobValues,
        templateKnobs: b.templateKnobs,
        customIdx: b.customIdx ?? get().customIdx,
        colorGroups: b.data ? extractColorGroups(b.data) : [],
        editBaseline: null,
      })
    },

    toggleLayer: (index) => {
      const { animationData, sourceData } = get()
      if (!animationData) return
      push({
        animationData: toggleLayerUtil(animationData, index),
        sourceData: sourceData ? toggleLayerUtil(sourceData, index) : null,
      })
    },

    setSize: (w, h) => {
      const { animationData, sourceData } = get()
      if (!animationData) return
      push({
        animationData: resizeUtil(animationData, w, h),
        sourceData: sourceData ? resizeUtil(sourceData, w, h) : null,
      })
    },

    applyGraphicToSlot: (match, group) => {
      const { animationData, sourceData } = get()
      if (!animationData) return
      const swap = (d: LottieJson) => {
        const clone = structuredClone(d)
        for (const l of clone.layers) {
          if (typeof l.nm === 'string' && l.nm.startsWith(match)) {
            ;(l as Record<string, unknown>).shapes = [structuredClone(group)]
          }
        }
        return clone
      }
      const next = swap(animationData)
      push({
        animationData: next,
        colorGroups: extractColorGroups(next),
        sourceData: sourceData ? swap(sourceData) : null,
      })
    },

    applyImageToSlot: (match, dataUri, w, h, anchor = [0.5, 0.5]) => {
      const { animationData, sourceData } = get()
      if (!animationData) return
      const assetId = `img_${match}`
      const swap = (d: LottieJson) => {
        const clone = structuredClone(d)
        const assets = ((clone.assets as Record<string, unknown>[] | undefined) ?? []).filter(
          (a) => a.id !== assetId,
        )
        // e:1 = 인라인(base64) — 내보낸 JSON 단독으로 재생 가능
        assets.push({ id: assetId, w, h, u: '', p: dataUri, e: 1 })
        clone.assets = assets
        for (const l of clone.layers) {
          if (typeof l.nm === 'string' && l.nm.startsWith(match)) {
            const lr = l as Record<string, unknown>
            lr.ty = 2
            lr.refId = assetId
            delete lr.shapes
            // 이미지는 좌상단 기준으로 그려진다 — 앵커를 기준점 비율 위치로
            ;(lr.ks as Record<string, unknown>).a = { a: 0, k: [w * anchor[0], h * anchor[1], 0] }
          }
        }
        return clone
      }
      const next = swap(animationData)
      push({
        animationData: next,
        colorGroups: extractColorGroups(next),
        sourceData: sourceData ? swap(sourceData) : null,
      })
    },

    setImageAnchorLive: (match, fx, fy) => {
      const { animationData, sourceData, editBaseline } = get()
      if (!animationData) return
      const baseline = editBaseline ?? snap()
      const assetId = `img_${match}`
      // 정지 자세 값 — 정적이면 k, 애니메이션이면 첫 키프레임
      const rest = (prop: unknown): unknown => {
        const p = prop as { a?: number; k?: unknown }
        if (p?.a === 1 && Array.isArray(p.k)) return (p.k[0] as { s?: unknown })?.s
        return p?.k
      }
      const adjust = (d: LottieJson) => {
        const clone = structuredClone(d)
        const asset = (clone.assets as Record<string, unknown>[] | undefined)?.find(
          (a) => a.id === assetId,
        )
        if (!asset) return clone
        for (const l of clone.layers) {
          const lr = l as Record<string, unknown>
          if (typeof l.nm === 'string' && l.nm.startsWith(match) && lr.refId === assetId) {
            const ks = lr.ks as Record<string, unknown>
            const oldA = ((ks.a as { k?: unknown })?.k as number[]) ?? [0, 0, 0]
            const newA = [(asset.w as number) * fx, (asset.h as number) * fy]
            // 앵커 이동만큼 이미지가 반대로 밀린다 — 정지 자세의 회전/스케일을 반영해
            // 포지션을 같은 만큼 보정하면 이미지는 제자리, 기준점만 움직인다 (AE 팬비하인드).
            const da = [newA[0] - oldA[0], newA[1] - oldA[1]]
            const r0 = ((rest(ks.r) as number) ?? 0) * (Math.PI / 180)
            const s0 = (rest(ks.s) as number[]) ?? [100, 100]
            const sx = (da[0] * s0[0]) / 100
            const sy = (da[1] * s0[1]) / 100
            const dx = sx * Math.cos(r0) - sy * Math.sin(r0)
            const dy = sx * Math.sin(r0) + sy * Math.cos(r0)
            ks.a = { a: 0, k: [newA[0], newA[1], 0] }
            const p = ks.p as { a?: number; k?: unknown }
            if (p?.a === 1 && Array.isArray(p.k)) {
              for (const kf of p.k as { s?: number[] }[]) {
                if (Array.isArray(kf.s)) {
                  kf.s[0] += dx
                  kf.s[1] += dy
                }
              }
            } else if (Array.isArray(p?.k)) {
              ;(p.k as number[])[0] += dx
              ;(p.k as number[])[1] += dy
            }
          }
        }
        return clone
      }
      set({
        animationData: adjust(animationData),
        sourceData: sourceData ? adjust(sourceData) : null,
        editBaseline: baseline,
        future: [],
      })
    },

    restoreSlot: (match, byName) => {
      const { animationData, sourceData } = get()
      if (!animationData) return
      const assetId = `img_${match}`
      const restore = (d: LottieJson) => {
        const clone = structuredClone(d)
        if (Array.isArray(clone.assets)) {
          clone.assets = (clone.assets as Record<string, unknown>[]).filter((a) => a.id !== assetId)
        }
        for (const l of clone.layers) {
          if (typeof l.nm === 'string' && l.nm.startsWith(match) && byName[l.nm]) {
            const src = byName[l.nm] as Record<string, unknown>
            const lr = l as Record<string, unknown>
            lr.ty = src.ty
            lr.shapes = structuredClone(src.shapes)
            delete lr.refId
            ;(lr.ks as Record<string, unknown>).a = structuredClone(
              (src.ks as Record<string, unknown>).a,
            )
          }
        }
        return clone
      }
      const next = restore(animationData)
      push({
        animationData: next,
        colorGroups: extractColorGroups(next),
        sourceData: sourceData ? restore(sourceData) : null,
      })
    },

    setCustomIdx: (i) => set({ customIdx: i, customIdxs: [i] }),

    deselectCustom: () => set({ customIdxs: [] }),

    toggleCustomSel: (i) => {
      const cur = get().customIdxs
      let next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]
      if (!next.length) next = [i]
      set({ customIdxs: next, customIdx: next[next.length - 1] })
    },

    addCustomLayer: (payload, name, at) => {
      const { templateId, sourceData, templateKnobs, knobValues } = get()
      const base: [number, number] = at ?? [256, 256]
      if (templateId !== '__custom' || !sourceData) {
        const doc = buildCustomDoc(payload, { ...DEFAULT_SEL }, base, name)
        ;(doc.layers[0] as Record<string, unknown>).xci = 0
        // 커스텀은 timeStretch 노브 없음 — 컴포지션 길이는 setCompLength로 (절대 시간 유지)
        get().loadTemplate(doc, '__custom', [])
        // 편집 모드로 시작 — 재생(프리뷰) 버튼을 눌러야 루프 재생
        set({ customIdx: 0, customIdxs: [0], loop: false, playing: false })
        return
      }
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      // 에셋 id 충돌 방지 — 기존 suffix 최대값 + 1
      const assets = (src.assets as Record<string, unknown>[] | undefined) ?? []
      const next =
        Math.max(
          -1,
          ...assets
            .map((a) => String(a.id))
            .filter((id) => id.startsWith(CUSTOM_ASSET_PREFIX))
            .map((id) => Number(id.slice(CUSTOM_ASSET_PREFIX.length + 1)) || 0),
        ) + 1
      const { layer, asset } = buildCustomLayer(
        payload, { ...DEFAULT_SEL }, base, name, `${CUSTOM_ASSET_PREFIX}_${next}`, src.op,
      )
      // 라벨 컬러 — 지금까지 배정된 최댓값 + 1 (재정렬해도 색 유지)
      layer.xci =
        Math.max(-1, ...src.layers.map((l) => Number((l as Record<string, unknown>).xci ?? -1))) + 1
      if (asset) assets.push(asset)
      src.assets = assets
      src.layers = [layer as never, ...src.layers]
      src.layers.forEach((l, i) => (l.ind = i + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: 0,
        customIdxs: [0],
      })
    },

    removeCustomLayers: (idxs) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData) return
      const uniq = [...new Set(idxs)].filter((i) => i >= 0 && i < sourceData.layers.length)
      if (!uniq.length) return
      if (uniq.length >= sourceData.layers.length) {
        // 전부 삭제 = 세션 비움 (undo 가능)
        push({
          animationData: null, sourceData: null, pristineData: null, templateId: null,
          templateKnobs: [], knobValues: {}, colorGroups: [], customIdx: 0, customIdxs: [0],
        })
        return
      }
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      // 내림차순 제거 — 인덱스 안정. 에셋은 남은 레이어가 참조 안 할 때만 정리
      for (const i of [...uniq].sort((a, b) => b - a)) {
        const removed = src.layers.splice(i, 1)[0] as Record<string, unknown> | undefined
        const stillUsed = src.layers.some(
          (l) => (l as Record<string, unknown>).refId === removed?.refId,
        )
        if (removed?.refId && !stillUsed && Array.isArray(src.assets)) {
          src.assets = (src.assets as Record<string, unknown>[]).filter(
            (a) => a.id !== removed.refId,
          )
        }
      }
      src.layers.forEach((l, li) => (l.ind = li + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      const nextIdx = Math.max(0, Math.min(Math.min(...uniq), src.layers.length - 1))
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: nextIdx,
        customIdxs: [nextIdx],
      })
    },

    removeCustomLayer: (i) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData) return
      if (sourceData.layers.length <= 1) {
        // 마지막 레이어 — 편집기 비움 (히스토리 유지 → undo로 복구 가능)
        push({
          animationData: null, sourceData: null, pristineData: null, templateId: null,
          templateKnobs: [], knobValues: {}, colorGroups: [], customIdx: 0, customIdxs: [0],
        })
        return
      }
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const removed = src.layers.splice(i, 1)[0] as Record<string, unknown> | undefined
      const stillUsed = src.layers.some(
        (l) => (l as Record<string, unknown>).refId === removed?.refId,
      )
      if (removed?.refId && !stillUsed && Array.isArray(src.assets)) {
        src.assets = (src.assets as Record<string, unknown>[]).filter((a) => a.id !== removed.refId)
      }
      src.layers.forEach((l, li) => (l.ind = li + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      // 선택 보정: 위쪽 레이어를 지우면 선택이 한 칸 당겨지고, 선택 자체를 지우면 그 자리 유지
      const cur = get().customIdx
      const nextIdx = i < cur ? cur - 1 : Math.min(cur, src.layers.length - 1)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: Math.max(0, nextIdx),
        customIdxs: [Math.max(0, nextIdx)],
      })
    },

    setCustomChannels: (sel) => {
      const next = withCustomChannels(get(), sel)
      if (next) push(next)
    },

    setCustomChannelsLive: (sel) => {
      const st = get()
      const next = withCustomChannels(st, sel)
      if (!next) return
      set({ ...next, editBaseline: st.editBaseline ?? snap(), future: [] })
    },

    reorderCustomLayer: (from, to) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData) return
      const n = sourceData.layers.length
      if (from === to || from < 0 || from >= n || to < 0 || to >= n) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const [moved] = src.layers.splice(from, 1)
      src.layers.splice(to, 0, moved)
      src.layers.forEach((l, li) => (l.ind = li + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: to,
        customIdxs: [to],
      })
    },

    duplicateCustomLayer: (i, offset = 12) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[i]) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const copy = structuredClone(src.layers[i]) as Record<string, unknown>
      // 이름: '복사 복사' 증식 방지 — 기본 이름 + 번호
      const baseName = String(copy.nm ?? '레이어').replace(/ 복사( \d+)?$/, '')
      const taken = new Set(src.layers.map((l) => String(l.nm ?? '')))
      let n = 1
      while (taken.has(`${baseName} 복사${n > 1 ? ` ${n}` : ''}`)) n++
      copy.nm = `${baseName} 복사${n > 1 ? ` ${n}` : ''}`
      // 이미지 에셋 분리 — 공유하면 한쪽 삭제/크기 조절이 다른 복제본을 깨뜨린다
      if (copy.refId && Array.isArray(src.assets)) {
        const assets = src.assets as Record<string, unknown>[]
        const orig = assets.find((a) => a.id === copy.refId)
        if (orig) {
          const next =
            Math.max(
              -1,
              ...assets
                .map((a) => String(a.id))
                .filter((id) => id.startsWith(CUSTOM_ASSET_PREFIX))
                .map((id) => Number(id.slice(CUSTOM_ASSET_PREFIX.length + 1)) || 0),
            ) + 1
          const dup = structuredClone(orig)
          dup.id = `${CUSTOM_ASSET_PREFIX}_${next}`
          assets.push(dup)
          copy.refId = dup.id
        }
      }
      // 살짝 오프셋 — 겹쳐서 안 보이는 문제 방지
      const p = (copy.ks as Record<string, unknown>).p as { a?: number; k: unknown }
      if (p.a === 1 && Array.isArray(p.k)) {
        const seen = new Set<number[]>()
        for (const kf of p.k as { s?: number[] }[]) {
          if (Array.isArray(kf.s) && !seen.has(kf.s)) {
            seen.add(kf.s)
            kf.s[0] += offset
            kf.s[1] += offset
          }
        }
      } else if (Array.isArray(p.k)) {
        ;(p.k as number[])[0] += offset
        ;(p.k as number[])[1] += offset
      }
      if (Array.isArray(copy.xbase)) {
        ;(copy.xbase as number[])[0] += offset
        ;(copy.xbase as number[])[1] += offset
      }
      copy.xci =
        Math.max(-1, ...src.layers.map((l) => Number((l as Record<string, unknown>).xci ?? -1))) + 1
      src.layers.splice(i, 0, copy as never)
      src.layers.forEach((l, li) => (l.ind = li + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: i,
        customIdxs: [i],
      })
    },

    renameCustomLayer: (i, name) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[i] || !name.trim()) return
      const src = structuredClone(sourceData)
      src.layers[i].nm = name.trim()
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    nudgeCustomBase: (dx, dy) => {
      const { sourceData, templateKnobs, knobValues, customIdxs } = get()
      if (!sourceData) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      // 다중 선택 전체 이동 — 선택이 없으면 아무것도 안 움직인다
      const sel = [...new Set(customIdxs)].filter((i) => i >= 0 && i < src.layers.length)
      if (!sel.length) return
      for (const i of sel) {
        shiftLayer(src.layers[i] as Record<string, unknown>, dx, dy)
      }
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    setCustomSize: (px) => {
      const next = withCustomSize(get(), px)
      if (next) push(next)
    },

    setCustomSizeLive: (px) => {
      const st = get()
      const next = withCustomSize(st, px)
      if (!next) return
      set({ ...next, editBaseline: st.editBaseline ?? snap(), future: [] })
    },

    setCustomBaseLive: (x, y) => {
      const st = get()
      const { sourceData, templateKnobs, knobValues, customIdx, customIdxs } = st
      if (!sourceData) return
      const src = structuredClone(sourceData)
      const primary = Math.min(customIdx, src.layers.length - 1)
      const layer = src.layers[primary] as Record<string, unknown>
      if (!layer || !Array.isArray(layer.xbase)) return
      const xb = layer.xbase as number[]
      const dx = x - xb[0]
      const dy = y - xb[1]
      if (!dx && !dy) return
      // 주 선택은 절대 좌표, 함께 선택된 레이어들은 같은 델타로 동반 이동 — 선택 없으면 무시
      const sel = [...new Set(customIdxs)].filter((i) => i >= 0 && i < src.layers.length)
      if (!sel.length) return
      for (const i of sel) {
        shiftLayer(src.layers[i] as Record<string, unknown>, dx, dy)
      }
      xb[0] = x
      xb[1] = y
      const applied = applyKnobs(src, templateKnobs, knobValues)
      set({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        editBaseline: st.editBaseline ?? snap(),
        future: [],
      })
    },

    alignCustom: (mode, basis = 'canvas') => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      // 선택된 레이어만 — 선택이 없으면 아무 일도 하지 않는다 (일러와 동일)
      const targets = [...new Set(get().customIdxs)].filter((i) => i >= 0 && i < src.layers.length)
      if (!targets.length) return
      // 각 레이어의 시각적 박스
      const boxes = targets.map((i) => {
        const layer = src.layers[i] as Record<string, unknown>
        const xb = (layer.xbase as number[]) ?? [256, 256]
        const [hw, hh] = layerHalfOf(src, i)
        const [ox, oy] = layerCenterOffsetOf(src, i)
        return { i, layer, cx: xb[0] + ox, cy: xb[1] + oy, hw, hh }
      })
      // 정렬 기준 경계: 캔버스 또는 선택 합집합 바운드 (2개 미만이면 캔버스로 폴백)
      let L = 0, R = 512, T = 0, B = 512
      if (basis === 'selection' && boxes.length >= 2) {
        L = Math.min(...boxes.map((b) => b.cx - b.hw))
        R = Math.max(...boxes.map((b) => b.cx + b.hw))
        T = Math.min(...boxes.map((b) => b.cy - b.hh))
        B = Math.max(...boxes.map((b) => b.cy + b.hh))
      }
      const MX = (L + R) / 2
      const MY = (T + B) / 2
      let moved = false
      for (const b of boxes) {
        if (!Array.isArray(b.layer.xbase)) continue
        const tx =
          mode === 'left' ? L + b.hw : mode === 'hc' ? MX : mode === 'right' ? R - b.hw : b.cx
        const ty =
          mode === 'top' ? T + b.hh : mode === 'vc' ? MY : mode === 'bottom' ? B - b.hh : b.cy
        const dx = tx - b.cx
        const dy = ty - b.cy
        if (!dx && !dy) continue
        shiftLayer(b.layer, dx, dy)
        moved = true
      }
      if (!moved) return
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    distributeCustom: (axis) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData || sourceData.layers.length < 3) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      // 다중 선택 3개 이상이면 선택만, 아니면 전체 — 양끝 고정, 사이 균등
      const selD = [...new Set(get().customIdxs)].filter((i) => i >= 0 && i < src.layers.length)
      const pool = selD.length >= 3 ? selD : src.layers.map((_, i) => i)
      const items = pool.map((i) => {
        const l = src.layers[i]
        const xb = ((l as Record<string, unknown>).xbase as number[]) ?? [256, 256]
        const [ox, oy] = layerCenterOffsetOf(src, i)
        return { i, c: axis === 'h' ? xb[0] + ox : xb[1] + oy }
      })
      if (items.length < 3) return
      items.sort((a, b) => a.c - b.c)
      const first = items[0].c
      const last = items[items.length - 1].c
      if (last - first < 1) return
      const step = (last - first) / (items.length - 1)
      items.forEach((it, rank) => {
        const target = first + rank * step
        const d = target - it.c
        if (!d) return
        const layer = src.layers[it.i] as Record<string, unknown>
        shiftLayer(layer, axis === 'h' ? d : 0, axis === 'h' ? 0 : d)
      })
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    setCompLength: (sec) => {
      const next = withCompLength(get(), sec)
      if (next) push(next)
    },

    setCompLengthLive: (sec) => {
      const st = get()
      const next = withCompLength(st, sec)
      if (!next) return
      set({ ...next, editBaseline: st.editBaseline ?? snap(), future: [] })
    },

    setCustomAnchor: (fx, fy) => {
      const next = withCustomAnchor(get(), fx, fy)
      if (next) push(next)
    },

    setCustomAnchorLive: (fx, fy) => {
      const st = get()
      const next = withCustomAnchor(st, fx, fy)
      if (!next) return
      set({ ...next, editBaseline: st.editBaseline ?? snap(), future: [] })
    },

    undo: () => {
      get().commitEdit()
      const { past, future } = get()
      if (!past.length) return
      const cur = snap()
      const prev = past[past.length - 1]
      set({
        animationData: prev.data,
        sourceData: prev.source,
        knobValues: prev.knobValues,
        templateKnobs: prev.templateKnobs,
        customIdx: prev.customIdx ?? 0,
        customIdxs: prev.customIdxs ?? [prev.customIdx ?? 0],
        templateId: prev.templateId,
        colorGroups: prev.data ? extractColorGroups(prev.data) : [],
        past: past.slice(0, -1),
        future: [cur, ...future].slice(0, HISTORY_CAP),
      })
    },

    redo: () => {
      get().commitEdit()
      const { future, past } = get()
      if (!future.length) return
      const cur = snap()
      const next = future[0]
      set({
        animationData: next.data,
        sourceData: next.source,
        knobValues: next.knobValues,
        templateKnobs: next.templateKnobs,
        customIdx: next.customIdx ?? 0,
        customIdxs: next.customIdxs ?? [next.customIdx ?? 0],
        templateId: next.templateId,
        colorGroups: next.data ? extractColorGroups(next.data) : [],
        future: future.slice(1),
        past: [...past.slice(-HISTORY_CAP + 1), cur],
      })
    },

    replay: () => set({ replayToken: get().replayToken + 1, playing: true }),
    setPlaying: (v) => set({ playing: v }),
    setSpeed: (v) => set({ speed: v }),
    setLoop: (v) => set({ loop: v }),
    setBg: (v) => set({ bg: v }),
    setFileName: (v) => set({ fileName: v }),
  }
})

// ── 자동 저장: 편집이 멈추고 0.8s 후 localStorage에 기록.
// 템플릿/커스텀 슬롯 분리 — 서로 덮어쓰지 않는다. 그냥 열어본(무편집) 템플릿은 저장 안 함.
// 대형 임베드 이미지 세션은 쿼터(약 5MB) 보호를 위해 4.5MB 초과 시 스킵 → saveStatus로 알림.
let saveTimer: ReturnType<typeof setTimeout> | undefined
let lastSavedSource: unknown = null
let lastSavedKnobs: unknown = null

/** 배지용 저장 상태 — 값이 바뀔 때만 set (subscribe 재귀 루프 방지). */
function setSaveStatus(v: 'saved' | 'skipped' | 'blocked') {
  if (useEditor.getState().saveStatus !== v) useEditor.setState({ saveStatus: v })
}

/** 현재 상태를 즉시 저장 — 모드 전환(stashCurrent)·pagehide가 디바운스를 기다리지 않고 호출한다. */
function saveSessionNow() {
  clearTimeout(saveTimer)
  const s = useEditor.getState()
  try {
    if (!s.sourceData) {
      lastSavedSource = null
      lastSavedKnobs = null
      // 커스텀 모드 안에서 실제 세션이 비워진 경우(마지막 레이어 삭제 = 히스토리 존재)만 슬롯 정리.
      // 부팅 직후·모드 전환·외부 파일 열기의 빈 상태(히스토리 없음)는 저장본을 지우지 않는다.
      if (s.mode === 'custom' && (s.past.length > 0 || s.future.length > 0)) {
        localStorage.removeItem(SAVE_KEYS.custom)
      }
      setSaveStatus('skipped')
      return
    }
    // 노브만 바뀐 편집도 저장돼야 하므로 sourceData와 knobValues 둘 다 비교
    if (s.sourceData === lastSavedSource && s.knobValues === lastSavedKnobs) return
    const kind: SaveKind | null =
      s.templateId === '__custom' ? 'custom' : s.templateId ? 'template' : null
    if (!kind) {
      // 외부 로티 파일 등 — 자동 저장 대상 아님 (마커도 진행 안 함)
      setSaveStatus('skipped')
      return
    }
    // 템플릿은 편집 흔적이 있을 때만 저장 — 미리보기로 연 것까지 남기지 않는다.
    // 마커를 진행하지 않아야 이후 첫 편집(노브 등)이 정상 저장된다.
    if (kind === 'template' && s.past.length === 0 && !s.editBaseline) {
      setSaveStatus('skipped')
      return
    }
    lastSavedSource = s.sourceData
    lastSavedKnobs = s.knobValues
    const payload: SavedSession = {
      v: 1,
      sourceData: s.sourceData,
      pristineData: s.pristineData,
      templateId: s.templateId,
      templateKnobs: s.templateKnobs,
      knobValues: s.knobValues,
      fileName: s.fileName,
      customIdx: s.customIdx,
    }
    const str = JSON.stringify(payload)
    if (str.length > 4_500_000) {
      // 쿼터 보호 — 저장 못 했음을 배지로 알린다 (.lmproj 저장 유도)
      setSaveStatus('blocked')
      return
    }
    localStorage.setItem(SAVE_KEYS[kind], str)
    localStorage.setItem(LAST_KEY, kind)
    setSaveStatus('saved')
  } catch {
    // 쿼터 초과·프라이빗 모드 등 — 편집엔 영향 없지만 배지로 알린다
    setSaveStatus('blocked')
  }
}

useEditor.subscribe((state) => {
  if (state.sourceData === lastSavedSource && state.knobValues === lastSavedKnobs) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveSessionNow, 800)
})

// 새로고침·창 닫기 직전 플러시 — 디바운스 창(0.8s) 안의 마지막 편집 유실 방지
if (typeof window !== 'undefined') window.addEventListener('pagehide', saveSessionNow)
