import { create } from 'zustand'
import type { LottieJson } from './lib/lottieUtils'
import { extractColorGroups, replaceColor, type ColorGroup } from './lib/lottieColors'
import { toggleLayer as toggleLayerUtil, resize as resizeUtil } from './lib/lottieUtils'
import { applyKnobs, type TemplateKnob } from './lib/lottieKnobs'

const HISTORY_CAP = 50

/**
 * 히스토리 한 칸. 노브는 source(노브 미적용 원본)에서 재계산되므로
 * data만 저장하면 undo 후 노브 조작이 어긋난다 — 셋을 함께 스냅샷.
 */
interface Snapshot {
  data: LottieJson
  source: LottieJson | null
  knobValues: Record<string, number | string>
  templateKnobs: TemplateKnob[]
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

  // 재생 상태 (파일에는 저장 안 됨)
  playing: boolean
  speed: number
  loop: boolean
  bg: string
  /** 증가할 때마다 프리뷰가 0프레임부터 재생 — 인터랙션 1회 확인용. */
  replayToken: number

  loadTemplate: (data: LottieJson, id: string, knobs: TemplateKnob[]) => void
  load: (data: LottieJson, fileName: string) => void
  setColorLive: (group: ColorGroup, hex: string) => void
  setKnobLive: (id: string, value: number | string) => void
  /** 템플릿 전체 초기화 — 노브·색상·커스텀 그래픽·크기 전부 로드 시점 원본으로 (undo 가능). */
  resetTemplate: () => void
  commitEdit: () => void
  toggleLayer: (index: number) => void
  setSize: (w: number, h: number) => void
  /** match로 시작하는 레이어들의 셰이프를 커스텀 그래픽 그룹으로 교체 (원본에도 미러). */
  applyGraphicToSlot: (match: string, group: unknown) => void
  /** 슬롯 셰이프를 레이어 이름별 원본으로 복원. */
  restoreSlot: (match: string, byName: Record<string, unknown[]>) => void
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
  const snap = (): Snapshot | null => {
    const { animationData, sourceData, knobValues, templateKnobs } = get()
    return animationData
      ? { data: animationData, source: sourceData, knobValues, templateKnobs }
      : null
  }

  /** 현재 상태를 past에 올리고 next 필드를 반영한다. 드래그 세션이 열려 있으면 먼저 커밋. */
  const push = (next: Partial<EditorState>) => {
    get().commitEdit()
    const s = snap()
    set({
      past: s ? [...get().past.slice(-HISTORY_CAP + 1), s] : get().past,
      future: [],
      ...next,
    })
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

    playing: true,
    speed: 1,
    loop: true,
    bg: 'checker',
    replayToken: 0,

    loadTemplate: (data, id, knobs) => {
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
        fileName: id,
        colorGroups: extractColorGroups(applied),
        past: [],
        future: [],
        editBaseline: null,
        playing: true,
      })
    },

    load: (data, fileName) =>
      set({
        animationData: data,
        sourceData: null,
        pristineData: null,
        templateKnobs: [],
        knobValues: {},
        templateId: null,
        fileName: fileName.replace(/\.json$/i, ''),
        colorGroups: extractColorGroups(data),
        past: [],
        future: [],
        editBaseline: null,
        playing: true,
      }),

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

    restoreSlot: (match, byName) => {
      const { animationData, sourceData } = get()
      if (!animationData) return
      const restore = (d: LottieJson) => {
        const clone = structuredClone(d)
        for (const l of clone.layers) {
          if (typeof l.nm === 'string' && l.nm.startsWith(match) && byName[l.nm]) {
            ;(l as Record<string, unknown>).shapes = structuredClone(byName[l.nm])
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

    undo: () => {
      get().commitEdit()
      const { past, future } = get()
      const cur = snap()
      if (!past.length || !cur) return
      const prev = past[past.length - 1]
      set({
        animationData: prev.data,
        sourceData: prev.source,
        knobValues: prev.knobValues,
        templateKnobs: prev.templateKnobs,
        colorGroups: extractColorGroups(prev.data),
        past: past.slice(0, -1),
        future: [cur, ...future].slice(0, HISTORY_CAP),
      })
    },

    redo: () => {
      get().commitEdit()
      const { future, past } = get()
      const cur = snap()
      if (!future.length || !cur) return
      const next = future[0]
      set({
        animationData: next.data,
        sourceData: next.source,
        knobValues: next.knobValues,
        templateKnobs: next.templateKnobs,
        colorGroups: extractColorGroups(next.data),
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
