import { create } from 'zustand'
import type { LottieJson, LottieLayer } from './lib/lottieUtils'
import { extractColorGroups, replaceColor, type ColorGroup } from './lib/lottieColors'
import { toggleLayer as toggleLayerUtil, resize as resizeUtil } from './lib/lottieUtils'
import { applyKnobs, type TemplateKnob } from './lib/lottieKnobs'
import {
  posProp, scaleProp, fadeProp, buildCustomDoc, buildCustomLayer,
  remapChannel, nativePosDur, nativeScaleDur, nativeFadeDur, isScaleOn, isFadeOn,
  CUSTOM_ASSET_PREFIX, DEFAULT_SEL, type CustomSel, type CustomPayload,
} from './lib/customBuilder'
import { durationKnob } from './lib/lottieKnobs'

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
  /** match로 시작하는 레이어들을 임베드 이미지 레이어(ty:2)로 교체 (원본에도 미러). anchor = 0~1 비율 기준점. */
  applyImageToSlot: (match: string, dataUri: string, w: number, h: number, anchor?: [number, number]) => void
  /** 이미지 슬롯 앵커(기준점) 라이브 조절 — fx/fy 0~1 비율. 드래그 세션, commitEdit로 확정. */
  setImageAnchorLive: (match: string, fx: number, fy: number) => void
  /** 슬롯을 원본 레이어 기준으로 복원 — 셰이프/레이어 타입/앵커, 이미지 에셋 제거까지. */
  restoreSlot: (match: string, byName: Record<string, LottieLayer>) => void
  /** 커스텀 빌더: 선택된 레이어 인덱스 (layers 배열 기준, 0 = 맨 위). */
  customIdx: number
  setCustomIdx: (i: number) => void
  /** 커스텀 빌더: 그래픽 추가 — 세션 없으면 새 문서, 있으면 맨 위 레이어로. */
  addCustomLayer: (payload: CustomPayload, name: string) => void
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
  /** 커스텀 빌더: 레이어 복제 — 에셋 공유, +12px 오프셋, 원본 위에 삽입. */
  duplicateCustomLayer: (i: number) => void
  /** 커스텀 빌더: 레이어 이름 변경. */
  renameCustomLayer: (i: number, name: string) => void
  /** 커스텀 빌더: 선택 레이어 기준 위치 이동(px). */
  nudgeCustomBase: (dx: number, dy: number) => void
  /** 라이브 절대 이동 — 캔버스 드래그 중 실시간 반영, commitEdit로 확정. */
  setCustomBaseLive: (x: number, y: number) => void
  /** 커스텀 빌더: 선택 레이어 크기(긴 변 px) 변경. */
  setCustomSize: (px: number) => void
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

  /** 선택 레이어의 채널(포지션/스케일/오퍼시티/회전)을 sel로 교체한 다음 상태 필드. */
  const withCustomChannels = (
    st: EditorState,
    sel: CustomSel,
  ): Pick<EditorState, 'animationData' | 'sourceData' | 'colorGroups'> | null => {
    const { sourceData, templateKnobs, knobValues, customIdx } = st
    if (!sourceData) return null
    const src = structuredClone(sourceData)
    const layer = src.layers[Math.min(customIdx, src.layers.length - 1)] as Record<string, unknown>
    if (!layer) return null
    const ks = layer.ks as Record<string, unknown>
    const p = ks.p as { a?: number; k: unknown }
    // 기준 위치: xbase 우선 — p 첫 키프레임은 슬라이드류에서 오프셋 시작점이라 쓰면 드리프트
    let base: [number, number]
    if (Array.isArray(layer.xbase)) {
      base = [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
    } else if (p.a === 1 && Array.isArray(p.k)) {
      const kfs = p.k as { s: number[] }[]
      const last = kfs[kfs.length - 1].s
      base = [last[0], last[1]]
    } else {
      base = [(p.k as number[])[0], (p.k as number[])[1]]
    }
    layer.xbase = [...base]
    ks.p = remapChannel(posProp(base, sel.pos, sel.amount), nativePosDur(sel.pos), sel.posWin)
    ks.s = isScaleOn(sel)
      ? remapChannel(
          scaleProp(sel.scaleFrom, sel.scaleTo, sel.scaleBounce),
          nativeScaleDur(sel),
          sel.scaleWin,
        )
      : { a: 0, k: [100, 100, 100] }
    ks.o = isFadeOn(sel)
      ? remapChannel(fadeProp(sel.fadeFrom, sel.fadeTo), nativeFadeDur(sel), sel.fadeWin)
      : { a: 0, k: Math.max(0, Math.min(100, sel.opacity)) }
    ks.r = { a: 0, k: sel.rotation }
    layer.xsel = { ...sel }
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
    // 팬비하인드 — 앵커 이동분(정지 회전 반영)만큼 포지션 보정
    const rad = ((xsel.rotation ?? 0) * Math.PI) / 180
    const da = [newA[0] - oldA[0], newA[1] - oldA[1]]
    const dx = da[0] * Math.cos(rad) - da[1] * Math.sin(rad)
    const dy = da[0] * Math.sin(rad) + da[1] * Math.cos(rad)
    ks.a = { a: 0, k: newA }
    const p = ks.p as { a?: number; k: unknown }
    if (p.a === 1 && Array.isArray(p.k)) {
      for (const kf of p.k as { s?: number[] }[]) {
        if (Array.isArray(kf.s)) {
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

    customIdx: 0,

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

    setCustomIdx: (i) => set({ customIdx: i }),

    addCustomLayer: (payload, name) => {
      const { templateId, sourceData, templateKnobs, knobValues } = get()
      if (templateId !== '__custom' || !sourceData) {
        const doc = buildCustomDoc(payload, { ...DEFAULT_SEL }, [256, 256], name)
        get().loadTemplate(doc, '__custom', [durationKnob(doc)])
        // 편집 모드로 시작 — 재생(프리뷰) 버튼을 눌러야 루프 재생
        set({ customIdx: 0, loop: false, playing: false })
        return
      }
      const src = structuredClone(sourceData)
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
        payload, { ...DEFAULT_SEL }, [256, 256], name, `${CUSTOM_ASSET_PREFIX}_${next}`,
      )
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
      })
    },

    removeCustomLayer: (i) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData) return
      if (sourceData.layers.length <= 1) {
        // 마지막 레이어 — 편집기 비움
        set({
          animationData: null, sourceData: null, pristineData: null, templateId: null,
          templateKnobs: [], knobValues: {}, colorGroups: [], past: [], future: [],
          editBaseline: null, customIdx: 0,
        })
        return
      }
      const src = structuredClone(sourceData)
      const removed = src.layers.splice(i, 1)[0] as Record<string, unknown> | undefined
      if (removed?.refId && Array.isArray(src.assets)) {
        src.assets = (src.assets as Record<string, unknown>[]).filter((a) => a.id !== removed.refId)
      }
      src.layers.forEach((l, li) => (l.ind = li + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: Math.min(get().customIdx, src.layers.length - 1),
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
      const [moved] = src.layers.splice(from, 1)
      src.layers.splice(to, 0, moved)
      src.layers.forEach((l, li) => (l.ind = li + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: to,
      })
    },

    duplicateCustomLayer: (i) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[i]) return
      const src = structuredClone(sourceData)
      const copy = structuredClone(src.layers[i]) as Record<string, unknown>
      copy.nm = `${copy.nm ?? '레이어'} 복사`
      // 살짝 오프셋 — 겹쳐서 안 보이는 문제 방지
      const p = (copy.ks as Record<string, unknown>).p as { a?: number; k: unknown }
      if (p.a === 1 && Array.isArray(p.k)) {
        for (const kf of p.k as { s?: number[] }[]) {
          if (Array.isArray(kf.s)) {
            kf.s[0] += 12
            kf.s[1] += 12
          }
        }
      } else if (Array.isArray(p.k)) {
        ;(p.k as number[])[0] += 12
        ;(p.k as number[])[1] += 12
      }
      if (Array.isArray(copy.xbase)) {
        ;(copy.xbase as number[])[0] += 12
        ;(copy.xbase as number[])[1] += 12
      }
      src.layers.splice(i, 0, copy as never)
      src.layers.forEach((l, li) => (l.ind = li + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: i,
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
      const { sourceData, templateKnobs, knobValues, customIdx } = get()
      if (!sourceData) return
      const src = structuredClone(sourceData)
      const layer = src.layers[Math.min(customIdx, src.layers.length - 1)] as Record<string, unknown>
      if (!layer) return
      const p = (layer.ks as Record<string, unknown>).p as { a?: number; k: unknown }
      if (p.a === 1 && Array.isArray(p.k)) {
        for (const kf of p.k as { s?: number[] }[]) {
          if (Array.isArray(kf.s)) {
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
      const { sourceData, templateKnobs, knobValues, customIdx } = st
      if (!sourceData) return
      const src = structuredClone(sourceData)
      const layer = src.layers[Math.min(customIdx, src.layers.length - 1)] as Record<string, unknown>
      if (!layer || !Array.isArray(layer.xbase)) return
      const xb = layer.xbase as number[]
      const dx = x - xb[0]
      const dy = y - xb[1]
      if (!dx && !dy) return
      const p = (layer.ks as Record<string, unknown>).p as { a?: number; k: unknown }
      if (p.a === 1 && Array.isArray(p.k)) {
        for (const kf of p.k as { s?: number[] }[]) {
          if (Array.isArray(kf.s)) {
            kf.s[0] += dx
            kf.s[1] += dy
          }
        }
      } else if (Array.isArray(p.k)) {
        ;(p.k as number[])[0] += dx
        ;(p.k as number[])[1] += dy
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
