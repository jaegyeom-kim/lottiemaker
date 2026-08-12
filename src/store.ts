import { create } from 'zustand'
import type { LottieJson, LottieLayer } from './lib/lottieUtils'
import { extractColorGroups, replaceColor, type ColorGroup } from './lib/lottieColors'
import { toggleLayer as toggleLayerUtil, resize as resizeUtil } from './lib/lottieUtils'
import { applyKnobs, type TemplateKnob } from './lib/lottieKnobs'
import type { AiMotionPlan } from './lib/ai'
import { convertLottieToCustom, convertLottieToScenes, hasPrecomps } from './lib/lottieImport'
import { t } from './lib/i18n'
import {
  buildAnimKs, buildCustomDoc, buildCustomLayer, animSpans, normSel,
  layerHalfOf, layerCenterOffsetOf, normKf, buildKfKs, kfValueAt,
  springValue, SPRING_PRESETS, bounceValue,
  CUSTOM_ASSET_PREFIX, DEFAULT_SEL,
  type CustomSel, type CustomPayload, type CustomKf, type KfChannel, type Bezier4,
  type KfSelItem,
  kfChannelKeys, applyTrimChannels, extractTrimToKf,
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
  /** 편집 중이던 씬 (comp 에셋 id) — null = 메인. */
  activeScene?: string | null
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
  activeScene: string | null
}
const modeStash: Record<SaveKind, Workspace | null> = { template: null, custom: null }

/** 키프레임 내부 클립보드 항목 — 원 레이어 + 최소 시각 기준 오프셋 + 채널 값/이징. */
interface KfClipEntry {
  li: number
  dt: number
  ch: KfChannel
  v: number | [number, number]
  e?: Bezier4
}
let kfClipboard: KfClipEntry[] | null = null

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
  /** 편집 중인 씬 (comp 에셋 id) — null = 메인 씬. */
  activeScene: string | null
  /** 씬 전환 — 레이어 배열을 물리 스왑 (히스토리 초기화, LottieFiles Creator 방식). */
  switchScene: (id: string | null) => void
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
  /** 다중 선택을 통째로 설정 — 마키/범위 선택용 (빈 배열 = 해제). */
  setCustomSelList: (idxs: number[]) => void
  /** 타임라인 채널 공개 (AE P/S/R/T/U) — 레이어 인덱스 → 보이는 채널. 기본 접힘. */
  tlReveal: Record<number, KfChannel[]>
  /** AE식 채널 공개 — spec: 채널 솔로 / 'u' 키 있는 채널 / 'all' / 'none'. additive = ⇧ (토글 추가). */
  revealChannels: (lis: number[], spec: KfChannel | 'u' | 'all' | 'none', additive?: boolean) => void
  /** 빈 곳 클릭 — 선택 해제. */
  deselectCustom: () => void
  /** 다중 레이어 삭제 (인덱스 목록). */
  removeCustomLayers: (idxs: number[]) => void
  /** 커스텀 빌더: 그래픽 추가 — 세션 없으면 새 문서, 있으면 맨 위 레이어로. at = 배치 좌표. */
  addCustomLayer: (payload: CustomPayload, name: string, at?: [number, number], size?: number) => void
  /** 선택 레이어의 그래픽을 통째 교체 (라이브) — 펜 드로잉 진행 중 갱신. 모션·이름·라벨 유지, commitEdit로 확정. */
  replaceCustomGraphicLive: (payload: CustomPayload, at: [number, number], size: number) => void
  /** 로티 문서를 커스텀 레이어로 가져오기 — 트랜스폼 키프레임을 xkf로 변환. */
  importLottieLayers: (
    doc: LottieJson,
  ) => { added: number; warnings: string[]; skipped: number; scenes: number }
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
  /** 커스텀: 선택 레이어 정렬 (일러 Align) — basis: 캔버스 또는 선택 영역(합집합 바운드). 선택 없으면 무시. */
  alignCustom: (
    mode: 'left' | 'hc' | 'right' | 'top' | 'vc' | 'bottom',
    basis?: 'canvas' | 'selection',
  ) => void
  /** 커스텀: 균등 분배 — 3개 이상 선택 시 선택끼리, 아니면 전체 레이어. */
  distributeCustom: (axis: 'h' | 'v') => void
  /** 커스텀 컴포지션 길이(초) — 드래그 라이브, commitEdit로 확정. 줄이면 범위 밖 키는 클램프. */
  setCompLengthLive: (sec: number) => void
  /** 커스텀 빌더: 앵커 포인트(0~1 비율) — 이미지 제자리 유지(팬비하인드). */
  setCustomAnchor: (fx: number, fy: number) => void
  /** 라이브 버전 — 드래그 패드용, commitEdit로 확정. */
  setCustomAnchorLive: (fx: number, fy: number) => void

  // ── 키프레임 모드 (AE 사용자용) — 선택 레이어의 xkf 편집
  /** 재생헤드 파킹 프레임 — 키프레임 모드 자동 키가 찍히는 시각. 히스토리 없음. */
  curFrame: number
  setCurFrame: (f: number) => void
  /** 프리뷰에 재생헤드 이동 요청 — ◀/▶ 키 탐색용. */
  jumpToken: { f: number; n: number } | null
  jumpTo: (f: number) => void
  /** 선택 레이어를 키프레임 모드로 전환/해제 (프리셋 xsel은 보존). */
  setLayerKfMode: (on: boolean) => void
  /** 레이어 전체 이징 (KF_EASES 인덱스). */
  setKfEase: (ease: number) => void
  /** 채널 키 업서트 — frame에 키 생성/갱신. */
  setKfChannel: (ch: KfChannel, frame: number, value: number | [number, number]) => void
  setKfChannelLive: (ch: KfChannel, frame: number, value: number | [number, number]) => void
  /** frame의 채널 키 제거 — 키가 비면 키 자체 삭제. */
  removeKfChannel: (ch: KfChannel, frame: number) => void
  /** 타임라인 키 다중 선택 (마키/클릭) — Delete·그룹 드래그 대상. */
  kfSel: KfSelItem[]
  setKfSel: (items: KfSelItem[]) => void
  /** 선택된 키(채널 단위) 일괄 삭제 — 빈 키 정리 포함. */
  removeKfKeys: (items: KfSelItem[]) => void
  /**
   * 선택된 키 그룹을 dt프레임 이동 (라이브, 리지드 — 비선택 키와 겹치면 그 틱 무시).
   * 실제 적용된 오프셋을 반환 (거부된 틱은 null) — 드래그 종료 시 선택 재매핑 기준.
   */
  moveKfKeysLive: (items: KfSelItem[], dt: number) => number | null
  /** 선택된 키를 df프레임 넛지 — 한 번 누름 = 히스토리 1칸, 선택 유지. */
  nudgeKfSel: (df: number) => void
  /** 선택된 키 복사 (앱 내부 클립보드). */
  copyKfSel: () => void
  /** 복사한 키를 frame 기준으로 붙여넣기 — 가장 이른 키가 frame에 오도록. */
  pasteKfAt: (frame: number) => void
  /** 키프레임 레이어 클립 이동 — AE처럼 키 시각도 dt만큼 함께 이동 (라이브). */
  moveKfClipLive: (clipA: number, clipB: number, dt: number) => void
  /** fromT 키에서 시작하는 ch 구간의 이징 베지어 설정 (팝업 프리셋/입력 = 커밋). */
  setKfSegEase: (ch: KfChannel, fromT: number, bez: Bezier4) => void
  /** fromT→다음 키 구간을 스프링 모션 키로 굽기 (SPRING_PRESETS 인덱스). */
  bakeSpringSegEase: (ch: KfChannel, fromT: number, preset: number) => void
  /** fromT→다음 키 구간을 낙하 바운스(물리) 키로 굽기. */
  bakeBounceSegEase: (ch: KfChannel, fromT: number) => void
  /** 선택 레이어 패턴 복제 — count개, 간격/회전/크기/불투명도/시간차 누적 오프셋. */
  duplicatePattern: (
    count: number,
    dx: number,
    dy: number,
    drot: number,
    dt: number,
    ds: number,
    dop: number,
  ) => void
  /** 선택 키프레임 시간 반전(미러) — 선택 구간 창 기준, 이징도 뒤집힘. */
  reverseKfSel: () => void
  /** 선택 레이어 블렌드 모드 (Lottie bm — 0 표준). */
  setLayerBlend: (bm: number) => void
  /** 레이어 이름 변경 (AE Enter/더블클릭 리네임). */
  renameLayer: (li: number, name: string) => void
  /** 레이어 잠금 토글 (AE Lock) — 잠기면 캔버스/타임라인에서 선택·드래그 불가. */
  toggleLayerLock: (li: number) => void
  /** 수동 숨김 토글 (커스텀 모드) — 솔로와 조합해 최종 hd 계산. */
  toggleLayerHide: (li: number) => void
  /** 솔로 토글 (AE Solo/Creator Focus) — 켜진 레이어만 렌더. */
  toggleLayerSolo: (li: number) => void
  /** 트랙 매트 설정 — 소스는 임의 레이어(tp), 타입 none/alpha/luma + 반전. */
  setLayerMatte: (
    li: number,
    opts: { type: 'none' | 'alpha' | 'luma'; invert: boolean; sourceLi: number | null },
  ) => void
  /** 부모 설정 (AE Parent) — targetLi = 부모 레이어 인덱스, null = 해제. */
  setLayerParent: (li: number, targetLi: number | null) => void
  /** '타임라인에서 끄기' 토글 (Creator Turn off in Timeline). */
  toggleLayerTloff: (li: number) => void
  /** 타임라인에서 끈 레이어들 숨김 여부 (헤더 토글). */
  tlHideOff: boolean
  setTlHideOff: (v: boolean) => void
  /** 선택 레이어 위치 모션 패스 곡선 보간 토글. */
  setKfSmooth: (v: boolean) => void
  /** AI 모션 플랜 적용 — 대상 레이어를 키프레임 모드로 전환하고 키 통째 교체, 언두 1칸. */
  applyAiMotion: (plan: AiMotionPlan) => void
  /** 커브 핸들 드래그용 라이브 버전 — commitEdit로 확정. */
  setKfSegEaseLive: (ch: KfChannel, fromT: number, bez: Bezier4) => void
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

  /**
   * 라이브 편집용 문서 클론 — 레이어만 깊복사, 에셋 배열(대용량 base64)은 공유.
   * 트랜스폼 편집은 에셋을 건드리지 않으므로 안전. 에셋을 만지는 경로는 structuredClone 유지.
   */
  const cloneForLive = (d: LottieJson): LottieJson => ({
    ...d,
    layers: structuredClone(d.layers),
  })

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
          activeScene: s.activeScene,
        }
      : null
  }

  /** 다음 라벨 컬러 인덱스 — 지금까지 배정된 최댓값 + 1 (재정렬해도 색 유지). */
  const nextXci = (doc: LottieJson) =>
    Math.max(-1, ...doc.layers.map((l) => Number((l as Record<string, unknown>).xci ?? -1))) + 1

  /** 다음 커스텀 에셋 id — 기존 suffix 최댓값 + 1 (충돌 방지). */
  const nextAssetId = (assets: Record<string, unknown>[]) =>
    `${CUSTOM_ASSET_PREFIX}_${
      Math.max(
        -1,
        ...assets
          .map((a) => String(a.id))
          .filter((id) => id.startsWith(CUSTOM_ASSET_PREFIX))
          .map((id) => Number(id.slice(CUSTOM_ASSET_PREFIX.length + 1)) || 0),
      ) + 1
    }`

  /** xci(라벨 컬러) 누락 레이어 백필 — 순서와 무관하게 색이 고정되도록. */
  const ensureLayerColors = (doc: LottieJson) => {
    let next = nextXci(doc)
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
    // 키프레임 모드 레이어 — 원본(xkf) 위치 키도 함께 이동해야 재빌드 시 안 튄다
    const xkf = layer.xkf as CustomKf | undefined
    if (xkf?.keys) {
      for (const k of xkf.keys) {
        if (Array.isArray(k.p)) {
          k.p[0] += dx
          k.p[1] += dy
        }
      }
    }
  }

  /** 선택 레이어의 애니메이션(등장/루프/퇴장 + 회전/불투명도)을 sel로 재구성.
   *  live = 드래그 틱 — 에셋 공유 클론 + 색 재추출 생략 (트랜스폼은 색을 못 바꾼다). */
  const withCustomChannels = (
    st: EditorState,
    sel: CustomSel,
    live = false,
  ): Pick<EditorState, 'animationData' | 'sourceData' | 'colorGroups'> | null => {
    const { sourceData, templateKnobs, knobValues, customIdx } = st
    if (!sourceData) return null
    const src = live ? cloneForLive(sourceData) : structuredClone(sourceData)
    ensureLayerColors(src)
    const li = Math.min(customIdx, src.layers.length - 1)
    const layer = src.layers[li] as Record<string, unknown> | undefined
    if (!layer) return null
    if (!Array.isArray(layer.xbase)) layer.xbase = [256, 256]
    layer.xsel = structuredClone(normSel(sel, src.op))
    // 채널·클립 재생성은 editKfLayerIn 한 곳에서 — 프리셋/키프레임 분기 포함
    if (!editKfLayerIn(src, li, () => {})) return null
    const applied = applyKnobs(src, templateKnobs, knobValues)
    return {
      animationData: applied,
      sourceData: src,
      colorGroups: live ? st.colorGroups : extractColorGroups(applied),
    }
  }

  /** 레이어 크기(긴 변 px) 적용 — 래스터는 에셋 w/h, SVG는 그룹 스케일 (+앵커 비례). */
  const applyLayerSize = (src: LottieJson, layer: Record<string, unknown>, px: number) => {
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
    applyLayerSize(src, layer, px)
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
    if (Number(layer.ty) === 0 && typeof layer.w === 'number') {
      // 씬 참조(프리컴프) — 뷰포트(레이어 w/h)가 앵커 좌표계
      newA = [(layer.w as number) * fx, Number(layer.h ?? layer.w) * fy, 0]
    } else if (asset && typeof asset.w === 'number' && !asset.layers) {
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
    // 포지션 보정 — shiftLayer가 ks.p·xbase·xkf.p를 한 번에 (공유 배열 가드 포함)
    shiftLayer(layer, dx, dy)
    layer.xsel = { ...xsel, anchor: [fx, fy] }
    const applied = applyKnobs(src, templateKnobs, knobValues)
    return { animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) }
  }

  /** 클론된 src의 레이어 li에 xkf 변형 적용 + 채널·클립 재생성. 성공 여부 반환. */
  const editKfLayerIn = (
    src: LottieJson,
    li: number,
    mutate: (xkf: CustomKf, layer: Record<string, unknown>) => void,
  ): boolean => {
    const layer = src.layers[li] as Record<string, unknown> | undefined
    if (!layer) return false
    const xkf = normKf(layer.xkf as Partial<CustomKf> | undefined)
    mutate(xkf, layer)
    xkf.keys.sort((a, b) => a.t - b.t)
    layer.xkf = xkf
    const full = normSel(layer.xsel as Partial<CustomSel> | undefined, src.op)
    const base: [number, number] = Array.isArray(layer.xbase)
      ? [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
      : [256, 256]
    const ks = layer.ks as Record<string, unknown>
    const anim = xkf.on ? buildKfKs(xkf, full, base) : buildAnimKs(full, base, src.op)
    // 로티는 키 시각과 프레임 양쪽에서 st(offsetTime)를 빼므로 상쇄된다 —
    // 트랜스폼 키는 comp 시간 그대로 쓰는 게 맞다 (st는 자식 컴프 내용만 시프트)
    ks.p = anim.p
    ks.s = anim.s
    ks.o = anim.o
    ks.r = anim.r
    // 트림 패스 채널(ts/te) — ks 밖(shapes의 tm)에 반영, 키 있을 때만
    applyTrimChannels(layer, xkf)
    const { clipA, clipB } = animSpans(full, src.op)
    layer.ip = clipA
    layer.op = clipB
    return true
  }

  /** 선택 레이어의 xkf를 변형하고 채널·클립을 재생성 — 키프레임 모드 편집의 공통 경로.
   *  live = 드래그 틱 (에셋 공유 클론 + 색 재추출 생략). */
  const withKfEdit = (
    st: EditorState,
    mutate: (xkf: CustomKf, layer: Record<string, unknown>) => void,
    live = false,
  ): Pick<EditorState, 'animationData' | 'sourceData' | 'colorGroups'> | null => {
    const { sourceData, templateKnobs, knobValues, customIdx } = st
    if (!sourceData) return null
    const src = live ? cloneForLive(sourceData) : structuredClone(sourceData)
    ensureLayerColors(src)
    if (!editKfLayerIn(src, Math.min(customIdx, src.layers.length - 1), mutate)) return null
    const applied = applyKnobs(src, templateKnobs, knobValues)
    return {
      animationData: applied,
      sourceData: src,
      colorGroups: live ? st.colorGroups : extractColorGroups(applied),
    }
  }

  /** xkf.keys에서 frame(±0.5f)의 키에 채널 값(+구간 이징) 업서트. */
  /** ind를 1..n으로 재할당하면서 tp(매트)·parent 참조를 함께 리매핑. */
  const reindexLayers = (layersArr: Record<string, unknown>[]) => {
    const oldToNew = new Map<number, number>()
    layersArr.forEach((l, i) => {
      if (typeof l.ind === 'number') oldToNew.set(l.ind as number, i + 1)
    })
    layersArr.forEach((l, i) => (l.ind = i + 1))
    layersArr.forEach((l) => {
      if (typeof l.tp === 'number' && oldToNew.has(l.tp as number))
        l.tp = oldToNew.get(l.tp as number)
      if (typeof l.parent === 'number' && oldToNew.has(l.parent as number))
        l.parent = oldToNew.get(l.parent as number)
    })
  }

  const upsertKey = (
    xkf: CustomKf,
    ch: KfChannel,
    frame: number,
    value: number | [number, number],
    ease?: Bezier4,
  ) => {
    const t = Math.max(0, Math.round(frame))
    let k = xkf.keys.find((x) => Math.abs(x.t - t) < 0.5)
    if (!k) {
      k = { t }
      xkf.keys.push(k)
    }
    ;(k as unknown as Record<string, unknown>)[ch] = Array.isArray(value)
      ? [Math.round(value[0] * 10) / 10, Math.round(value[1] * 10) / 10]
      : Math.round(value * 10) / 10
    if (ease) k.e = { ...(k.e ?? {}), [ch]: ease }
  }

  /** fromT→다음 키 구간을 진행 곡선 fn(u∈[0,1]→0..1) 샘플 키로 굽는다 — 스프링/바운스 공용. */
  const bakeCurveSegEase = (ch: KfChannel, fromT: number, fn: (u: number) => number) => {
    const next = withKfEdit(get(), (xkf) => {
      const chKeys = xkf.keys
        .filter((k) => k[ch] !== undefined)
        .sort((a, b) => a.t - b.t)
      const i1 = chKeys.findIndex((k) => Math.abs(k.t - fromT) < 0.5)
      if (i1 < 0 || i1 >= chKeys.length - 1) return
      const k1 = chKeys[i1]
      const k2 = chKeys[i1 + 1]
      const D = k2.t - k1.t
      if (D < 6) return // 너무 짧으면 샘플 의미 없음
      const v1 = k1[ch] as number | [number, number]
      const v2 = k2[ch] as number | [number, number]
      const lin: Bezier4 = [0, 0, 1, 1]
      // 사이 기존 키 정리 (해당 채널만)
      for (const k of xkf.keys) {
        if (k.t > k1.t + 0.5 && k.t < k2.t - 0.5 && k[ch] !== undefined) {
          delete k[ch]
          if (k.e) delete k.e[ch]
        }
      }
      xkf.keys = xkf.keys.filter(
        (k) => k.p !== undefined || k.s !== undefined || k.r !== undefined || k.o !== undefined,
      )
      // 곡선 샘플 — 세그먼트당 최대 14키, 최소 2f 간격
      const steps = Math.max(4, Math.min(14, Math.floor(D / 2)))
      const mix = (u: number): number | [number, number] => {
        const f = fn(u)
        if (Array.isArray(v1) && Array.isArray(v2))
          return [v1[0] + (v2[0] - v1[0]) * f, v1[1] + (v2[1] - v1[1]) * f]
        return (v1 as number) + ((v2 as number) - (v1 as number)) * f
      }
      for (let i = 1; i < steps; i++) {
        upsertKey(xkf, ch, k1.t + (D * i) / steps, mix(i / steps), lin)
      }
      // 굽힌 구간은 샘플을 따라가야 하므로 선형 이징
      k1.e = { ...(k1.e ?? {}), [ch]: lin }
    })
    if (next) push(next)
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
    activeScene: null,
    tlReveal: {},
    tlHideOff: true,

    curFrame: 0,
    jumpToken: null,

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
        activeScene: null,
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
        // 구버전 세션 마이그레이션 — tm 애니메이션을 편집 가능한 트림 채널로 추출
        const allLayers = [
          ...(s.sourceData.layers as Record<string, unknown>[]),
          ...(((s.sourceData.assets as Record<string, unknown>[] | undefined) ?? [])
            .filter((a) => a.xscene === true)
            .flatMap((a) => (a.layers as Record<string, unknown>[] | undefined) ?? [])),
        ]
        for (const lr of allLayers) if (Number(lr.ty) === 4) extractTrimToKf(lr)
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
        activeScene: s.activeScene ?? null,
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

    revealChannels: (lis, spec, additive = false) => {
      const src = get().sourceData
      if (!src) return
      const ALL: KfChannel[] = ['p', 's', 'r', 'o', 'ts', 'te']
      const next = { ...get().tlReveal }
      for (const li of lis) {
        const layer = src.layers[li] as Record<string, unknown> | undefined
        if (!layer) continue
        const xkf = normKf(layer.xkf as Partial<CustomKf> | undefined)
        // 트림 채널(ts/te)은 kf 모드와 무관하게 동작 — on 아닐 땐 트림만 공개 가능
        const eligible = (c: KfChannel) => xkf.on || c === 'ts' || c === 'te'
        if (
          !xkf.on &&
          Number(layer.ty) !== 4 &&
          !xkf.keys.some((k) => k.ts !== undefined || k.te !== undefined)
        )
          continue
        const cur = next[li] ?? []
        if (additive && spec !== 'u' && spec !== 'all' && spec !== 'none') {
          // ⇧ = 현재 공개 목록에 채널 토글 추가/제거 (AE ⇧P/⇧S…)
          next[li] = cur.includes(spec) ? cur.filter((c) => c !== spec) : [...cur, spec]
          continue
        }
        let chs: KfChannel[]
        const trimOk = (c: KfChannel) =>
          (c !== 'ts' && c !== 'te') ||
          Number(layer.ty) === 4 ||
          kfChannelKeys(xkf, c).length > 0
        if (spec === 'u') chs = ALL.filter((c) => eligible(c) && kfChannelKeys(xkf, c).length > 0)
        else if (spec === 'all') chs = ALL.filter((c) => trimOk(c) && eligible(c))
        else if (spec === 'none') chs = []
        else chs = [spec].filter(eligible)
        // 같은 상태에서 같은 키 = 접기 (AE 토글)
        const same = cur.length === chs.length && chs.every((c) => cur.includes(c))
        next[li] = same ? [] : chs
      }
      set({ tlReveal: next })
    },

    setCustomSelList: (idxs) => {
      const n = get().sourceData?.layers.length ?? 0
      const uniq = [...new Set(idxs)].filter((i) => i >= 0 && i < n)
      if (!uniq.length) {
        set({ customIdxs: [] })
        return
      }
      set({ customIdxs: uniq, customIdx: uniq[uniq.length - 1] })
    },

    toggleCustomSel: (i) => {
      const cur = get().customIdxs
      let next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]
      if (!next.length) next = [i]
      set({ customIdxs: next, customIdx: next[next.length - 1] })
    },

    addCustomLayer: (payload, name, at, size) => {
      const { templateId, sourceData, templateKnobs, knobValues } = get()
      const base: [number, number] = at ?? [256, 256]
      // 드로잉 툴은 그린 크기 그대로 생성 (기본은 240px)
      const sel = { ...DEFAULT_SEL, ...(size ? { size: Math.max(4, Math.round(size)) } : {}) }
      if (templateId !== '__custom' || !sourceData) {
        const doc = buildCustomDoc(payload, sel, base, name)
        ;(doc.layers[0] as Record<string, unknown>).xci = 0
        // 커스텀은 timeStretch 노브 없음 — 컴포지션 길이는 setCompLength로 (절대 시간 유지)
        get().loadTemplate(doc, '__custom', [])
        // 편집 모드로 시작 — 재생(프리뷰) 버튼을 눌러야 루프 재생
        set({ customIdx: 0, customIdxs: [0], loop: false, playing: false })
        return
      }
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const assets = (src.assets as Record<string, unknown>[] | undefined) ?? []
      const { layer, asset } = buildCustomLayer(
        payload, sel, base, name, nextAssetId(assets), src.op,
      )
      layer.xci = nextXci(src)
      if (asset) assets.push(asset)
      src.assets = assets
      src.layers = [layer as never, ...src.layers]
      reindexLayers(src.layers as Record<string, unknown>[])
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        kfSel: [], // 맨 위에 끼어들며 레이어 인덱스가 밀림
        customIdx: 0,
        customIdxs: [0],
      })
    },

    replaceCustomGraphicLive: (payload, at, size) => {
      const st = get()
      const baseline = st.editBaseline ?? snap()
      const baseSrc = baseline.source
      if (!baseSrc?.layers.length) return
      const src = cloneForLive(baseSrc)
      ensureLayerColors(src)
      const li = Math.min(st.customIdx, src.layers.length - 1)
      const old = src.layers[li] as Record<string, unknown>
      const sel = normSel(old.xsel as Partial<CustomSel> | undefined, src.op)
      // 에셋 추가 가능성 — 공유 배열 오염 방지 (copy-on-write)
      const assets = [...((src.assets as Record<string, unknown>[] | undefined) ?? [])]
      const { layer, asset } = buildCustomLayer(
        payload,
        { ...sel, size: Math.max(4, Math.round(size)) },
        at,
        String(old.nm ?? '패스'),
        nextAssetId(assets),
        src.op,
      )
      layer.xci = old.xci
      layer.ind = old.ind
      if (old.xkf) layer.xkf = structuredClone(old.xkf)
      if (asset) {
        assets.push(asset)
      }
      src.assets = assets
      src.layers[li] = layer as never
      editKfLayerIn(src, li, () => {})
      const applied = applyKnobs(src, st.templateKnobs, st.knobValues)
      set({
        animationData: applied,
        sourceData: src,
        colorGroups: st.colorGroups, // 펜 라이브 — 색 고정, 재추출 생략
        editBaseline: baseline,
        future: [],
      })
    },

    switchScene: (id) => {
      const st = get()
      if (st.templateId !== '__custom' || !st.sourceData) return
      if (id === st.activeScene) return
      get().commitEdit()
      const src = structuredClone(get().sourceData!)
      const assets = ((src.assets as Record<string, unknown>[] | undefined) ?? []).slice()
      // 현재 뷰 레이어를 제자리(씬 에셋 또는 __main 홀더)에 반납
      const holderId = st.activeScene ?? '__main'
      let holder = assets.find((a) => a.id === holderId)
      if (!holder) {
        holder = { id: holderId, xscene: true, nm: holderId === '__main' ? 'Main' : holderId }
        assets.push(holder)
      }
      holder.layers = src.layers
      // 현재 캔버스 크기·길이 반납 — 컴프마다 뷰포트/타임라인이 다르다 (AE 방식)
      holder.xw = src.w
      holder.xh = src.h
      holder.xop = src.op
      // 타깃 레이어 꺼내기 — 편집 중 씬 에셋은 비워서 이중 표시/발산 방지
      const targetId = id ?? '__main'
      const target = assets.find((a) => a.id === targetId)
      src.layers = ((target?.layers as never[] | undefined) ?? []) as never
      if (target) target.layers = []
      // 타깃 뷰포트/길이로 전환 (작업물은 그대로 — 보는 창만 바뀐다)
      ;(src as unknown as Record<string, unknown>).w = Number(target?.xw ?? 512)
      ;(src as unknown as Record<string, unknown>).h = Number(target?.xh ?? 512)
      ;(src as unknown as Record<string, unknown>).op = Number(target?.xop ?? src.op)
      // 메인 복귀 시 홀더 정리
      src.assets = (targetId === '__main' ? assets.filter((a) => a !== target) : assets) as never
      ensureLayerColors(src)
      const applied = applyKnobs(src, st.templateKnobs, st.knobValues)
      set({
        sourceData: src,
        animationData: applied,
        colorGroups: extractColorGroups(applied),
        activeScene: id,
        past: [],
        future: [],
        editBaseline: null,
        kfSel: [],
        customIdx: 0,
        customIdxs: src.layers.length ? [0] : [],
        playing: false,
      })
    },

    importLottieLayers: (doc) => {
      // 프리컴프 문서 → 씬 보존 모드 (LottieFiles Creator 방식)
      if (hasPrecomps(doc)) {
        const sc = convertLottieToScenes(doc)
        const totalLayers = sc.main.length + sc.scenes.reduce((n, x) => n + x.layers.length, 0)
        if (!totalLayers) return { added: 0, warnings: sc.warnings, skipped: sc.skipped, scenes: 0 }
        // 채널 재생성 — 메인/씬 레이어 전부 (씬은 가짜 문서 래퍼로)
        const rebuild = (layersArr: Record<string, unknown>[], scopeOp: number) => {
          const fake = { op: scopeOp, layers: layersArr } as unknown as LottieJson
          layersArr.forEach((_, i) => editKfLayerIn(fake, i, () => {}))
          reindexLayers(layersArr)
        }
        rebuild(sc.main, sc.op)
        sc.scenes.forEach((x) => rebuild(x.layers, x.op))
        const sceneAssets = sc.scenes.map((x) => ({
          id: x.id,
          nm: x.name,
          xscene: true,
          xw: x.w,
          xh: x.h,
          xop: x.op,
          layers: x.layers,
        }))
        const { templateId, sourceData, templateKnobs, knobValues } = get()
        if (templateId !== '__custom' || !sourceData) {
          const newDoc = {
            v: '5.7.0', fr: 60, ip: 0, op: sc.op, w: 512, h: 512, nm: 'imported',
            assets: [...sc.assets, ...sceneAssets], layers: sc.main,
          } as unknown as LottieJson
          ensureLayerColors(newDoc)
          get().loadTemplate(newDoc, '__custom', [])
          set({ customIdx: 0, customIdxs: sc.main.length ? [0] : [], loop: false, playing: false })
          return { added: totalLayers, warnings: sc.warnings, skipped: sc.skipped, scenes: sc.scenes.length }
        }
        // 기존 세션에 추가 — 씬 id 충돌 회피 (xsc_ 번호 오프셋) + 이미지 에셋 remap
        const src = structuredClone(sourceData)
        ensureLayerColors(src)
        const assets = ((src.assets as Record<string, unknown>[] | undefined) ?? []).slice()
        const sceneOff = assets.filter((a) => a.xscene === true).length
        const sceneMap = new Map<string, string>()
        sc.scenes.forEach((x, i) => sceneMap.set(x.id, `xsc_${sceneOff + i + 1}`))
        const imgMap = new Map<string, string>()
        for (const a of sc.assets) {
          const newId = nextAssetId(assets)
          imgMap.set(String(a.id), newId)
          assets.push({ ...a, id: newId })
        }
        const remapLayers = (layersArr: Record<string, unknown>[]) => {
          for (const l of layersArr) {
            const rid = String(l.refId ?? '')
            if (sceneMap.has(rid)) l.refId = sceneMap.get(rid)
            else if (imgMap.has(rid)) l.refId = imgMap.get(rid)
          }
        }
        remapLayers(sc.main)
        sc.scenes.forEach((x) => remapLayers(x.layers))
        for (const x of sc.scenes)
          assets.push({ id: sceneMap.get(x.id)!, nm: x.name, xscene: true, layers: x.layers })
        const baseXci = nextXci(src)
        sc.main.forEach((l, i) => (l.xci = baseXci + i))
        src.assets = assets as never
        src.layers = [...(sc.main as never[]), ...src.layers]
        reindexLayers(src.layers as Record<string, unknown>[])
        const applied = applyKnobs(src, templateKnobs, knobValues)
        push({
          animationData: applied,
          sourceData: src,
          colorGroups: extractColorGroups(applied),
          kfSel: [],
          customIdx: 0,
          customIdxs: [0],
        })
        return { added: totalLayers, warnings: sc.warnings, skipped: sc.skipped, scenes: sc.scenes.length }
      }
      const conv = convertLottieToCustom(doc)
      if (!conv.layers.length)
        return { added: 0, warnings: conv.warnings, skipped: conv.skipped, scenes: 0 }
      const { templateId, sourceData, templateKnobs, knobValues } = get()
      // 빈 작업공간 → 새 커스텀 세션으로
      if (templateId !== '__custom' || !sourceData) {
        const newDoc = {
          v: '5.7.0', fr: 60, ip: 0, op: conv.op, w: 512, h: 512, nm: 'imported',
          assets: conv.assets, layers: conv.layers,
        } as unknown as LottieJson
        ensureLayerColors(newDoc)
        newDoc.layers.forEach((_, i) => editKfLayerIn(newDoc, i, () => {}))
        newDoc.layers.forEach((l, i) => (l.ind = i + 1))
        get().loadTemplate(newDoc, '__custom', [])
        set({ customIdx: 0, customIdxs: [0], loop: false, playing: false })
        return { added: conv.layers.length, warnings: conv.warnings, skipped: conv.skipped, scenes: 0 }
      }
      // 기존 세션에 추가 — 에셋 id 충돌은 우리 프리픽스로 재부여
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const assets = (src.assets as Record<string, unknown>[] | undefined) ?? []
      const idMap = new Map<string, string>()
      for (const a of conv.assets) {
        const newId = nextAssetId(assets)
        idMap.set(String(a.id), newId)
        assets.push({ ...a, id: newId })
      }
      const baseXci = nextXci(src)
      conv.layers.forEach((l, i) => {
        if (l.refId && idMap.has(String(l.refId))) l.refId = idMap.get(String(l.refId))
        l.xci = baseXci + i
        // 기존 컴프 길이에 맞춰 클립·키 클램프
        const xsel = l.xsel as CustomSel
        xsel.clip = [
          Math.max(0, Math.min(src.op, xsel.clip[0])),
          Math.max(1, Math.min(src.op, xsel.clip[1])),
        ]
        const xkf = l.xkf as CustomKf
        xkf.keys = xkf.keys.filter(
          (k, ki, arr2) =>
            k.t <= src.op &&
            arr2.findIndex((m) => Math.abs(m.t - k.t) < 0.5) === ki,
        )
      })
      if (conv.op > src.op)
        conv.warnings = [...conv.warnings, '가져온 애니메이션이 현재 컴프보다 김 — 재생 길이를 늘려보세요']
      src.assets = assets
      src.layers = [...(conv.layers as never[]), ...src.layers]
      src.layers.forEach((l, i) => (l.ind = i + 1))
      for (let i = 0; i < conv.layers.length; i++) editKfLayerIn(src, i, () => {})
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        kfSel: [],
        customIdx: 0,
        customIdxs: [0],
      })
      return { added: conv.layers.length, warnings: conv.warnings, skipped: conv.skipped, scenes: 0 }
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
          kfSel: [],
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
      // 선택 보정: 지운 것 위쪽 선택은 당겨지고, 지운 자리는 그 자리 유지
      const cur = get().customIdx
      const below = uniq.filter((x) => x < cur).length
      const nextIdx = Math.max(0, Math.min(cur - below, src.layers.length - 1))
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: nextIdx,
        customIdxs: [nextIdx],
        kfSel: [], // 레이어 인덱스가 바뀌므로 키 선택 무효화
      })
    },

    // 단일 삭제 = 다중 삭제의 특수형 — 로직 한 곳 유지
    removeCustomLayer: (i) => get().removeCustomLayers([i]),

    setCustomChannels: (sel) => {
      const next = withCustomChannels(get(), sel)
      if (next) push(next)
    },

    setCustomChannelsLive: (sel) => {
      const st = get()
      const next = withCustomChannels(st, sel, true)
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
        kfSel: [], // 레이어 인덱스가 바뀌므로 키 선택 무효화
      })
    },

    duplicateCustomLayer: (i, offset = 12) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[i]) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const copy = structuredClone(src.layers[i]) as Record<string, unknown>
      // 이름: '복사 복사' 증식 방지 — 기본 이름 + 번호
      const copySuffix = t('복사')
      const baseName = String(copy.nm ?? t('레이어')).replace(
        new RegExp(` ${copySuffix}( \\d+)?$`),
        '',
      )
      const taken = new Set(src.layers.map((l) => String(l.nm ?? '')))
      let n = 1
      while (taken.has(`${baseName} ${copySuffix}${n > 1 ? ` ${n}` : ''}`)) n++
      copy.nm = `${baseName} ${copySuffix}${n > 1 ? ` ${n}` : ''}`
      // 이미지 에셋 분리 — 공유하면 한쪽 삭제/크기 조절이 다른 복제본을 깨뜨린다
      if (copy.refId && Array.isArray(src.assets)) {
        const assets = src.assets as Record<string, unknown>[]
        const orig = assets.find((a) => a.id === copy.refId)
        if (orig) {
          const dup = structuredClone(orig)
          dup.id = nextAssetId(assets)
          assets.push(dup)
          copy.refId = dup.id
        }
      }
      // 살짝 오프셋 — 겹쳐서 안 보이는 문제 방지 (ks.p + xbase + xkf.p 전부 동반 이동)
      shiftLayer(copy, offset, offset)
      copy.xci = nextXci(src)
      src.layers.splice(i, 0, copy as never)
      src.layers.forEach((l, li) => (l.ind = li + 1))
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        customIdx: i,
        customIdxs: [i],
        kfSel: [], // 아래 레이어 인덱스가 밀리므로 키 선택 무효화
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
      const { sourceData, templateKnobs, knobValues, customIdxs, customIdx, curFrame } = get()
      if (!sourceData) return
      // 키프레임 모드 단독 선택 — 현재 프레임 위치에 자동 키
      {
        const pi = Math.min(customIdx, sourceData.layers.length - 1)
        const lr = sourceData.layers[pi] as Record<string, unknown>
        const sel1 = [...new Set(customIdxs)]
        if ((lr?.xkf as CustomKf | undefined)?.on && sel1.length === 1 && sel1[0] === pi) {
          const xkf = normKf(lr.xkf as Partial<CustomKf>)
          const xb = Array.isArray(lr.xbase)
            ? ([...(lr.xbase as number[])] as [number, number])
            : ([256, 256] as [number, number])
          const cur = kfValueAt(xkf, 'p', curFrame, xb) as [number, number]
          get().setKfChannel('p', curFrame, [cur[0] + dx, cur[1] + dy])
          return
        }
      }
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
      // 키프레임 모드 단독 선택 — 이동은 통째 시프트가 아니라 현재 프레임 자동 키 (AE 방식)
      {
        const pi = Math.min(customIdx, sourceData.layers.length - 1)
        const lr = sourceData.layers[pi] as Record<string, unknown>
        const sel1 = [...new Set(customIdxs)]
        if ((lr?.xkf as CustomKf | undefined)?.on && sel1.length === 1 && sel1[0] === pi) {
          get().setKfChannelLive('p', st.curFrame, [x, y])
          return
        }
      }
      const src = cloneForLive(sourceData)
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
        colorGroups: st.colorGroups, // 이동은 색을 못 바꾼다 — 라이브 재추출 생략
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

    setCompLengthLive: (sec) => {
      const st = get()
      // 드래그 시작(baseline) 기준 재적용 — 줄였다 다시 늘려도 제스처 안에서는 키가 안 사라진다
      const baseline = st.editBaseline ?? snap()
      const baseSrc = baseline.source ?? st.sourceData
      if (!baseSrc) return
      const src = cloneForLive(baseSrc)
      ensureLayerColors(src)
      src.op = Math.max(30, Math.min(600, Math.round(sec * 60)))
      // 줄어든 범위 밖 키프레임은 클램프 + 겹침 정리 — 보이지도 지울 수도 없는 유령 키 방지
      src.layers.forEach((l, li) => {
        const xkfRaw = (l as Record<string, unknown>).xkf as Partial<CustomKf> | undefined
        if (!xkfRaw?.on) return
        editKfLayerIn(src, li, (xkf) => {
          const kept: typeof xkf.keys = []
          for (const k of xkf.keys) {
            const t = Math.max(0, Math.min(src.op, k.t))
            if (kept.some((m) => Math.abs(m.t - t) < 0.5)) continue
            k.t = t
            kept.push(k)
          }
          xkf.keys = kept
        })
      })
      const applied = applyKnobs(src, st.templateKnobs, st.knobValues)
      set({
        animationData: applied,
        sourceData: src,
        colorGroups: st.colorGroups, // 길이 변경은 색 불변
        editBaseline: baseline,
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

    // ── 키프레임 모드 ─────────────────────────────────────
    setCurFrame: (f) => {
      const v = Math.max(0, Math.round(f))
      if (get().curFrame !== v) set({ curFrame: v })
    },

    jumpTo: (f) => {
      const op = get().sourceData?.op
      const v = Math.max(0, Math.min(op ?? Number.MAX_SAFE_INTEGER, Math.round(f)))
      set({ jumpToken: { f: v, n: (get().jumpToken?.n ?? 0) + 1 }, curFrame: v })
    },

    setLayerKfMode: (on) => {
      const next = withKfEdit(get(), (xkf) => {
        xkf.on = on
      })
      if (next) push(next)
    },

    setKfEase: (ease) => {
      const next = withKfEdit(get(), (xkf) => {
        xkf.ease = ease
      })
      if (next) push(next)
    },

    setKfChannel: (ch, frame, value) => {
      const next = withKfEdit(get(), (xkf) => upsertKey(xkf, ch, frame, value))
      if (next) push(next)
    },

    setKfChannelLive: (ch, frame, value) => {
      const st = get()
      const next = withKfEdit(st, (xkf) => upsertKey(xkf, ch, frame, value), true)
      if (!next) return
      set({ ...next, editBaseline: st.editBaseline ?? snap(), future: [] })
    },

    removeKfChannel: (ch, frame) => {
      const next = withKfEdit(get(), (xkf) => {
        const k = xkf.keys.find((x) => Math.abs(x.t - frame) < 0.5)
        if (!k) return
        delete k[ch]
        if (k.p === undefined && k.s === undefined && k.r === undefined && k.o === undefined)
          xkf.keys = xkf.keys.filter((x) => x !== k)
      })
      if (next) push(next)
    },

    kfSel: [],
    setKfSel: (items) => set({ kfSel: items }),

    removeKfKeys: (items) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData || !items.length) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const byLayer = new Map<number, KfSelItem[]>()
      for (const it of items) {
        const arr = byLayer.get(it.li) ?? []
        arr.push(it)
        byLayer.set(it.li, arr)
      }
      let removed = 0
      for (const [li, its] of byLayer) {
        editKfLayerIn(src, li, (xkf) => {
          for (const it of its) {
            const k = xkf.keys.find((x) => Math.abs(x.t - it.t) < 0.5 && x[it.ch] !== undefined)
            if (!k) continue
            removed++
            delete k[it.ch]
            if (k.p === undefined && k.s === undefined && k.r === undefined && k.o === undefined)
              xkf.keys = xkf.keys.filter((x) => x !== k)
          }
        })
      }
      // 실제로 지운 게 없으면 히스토리 오염 금지 — 낡은 선택만 정리
      if (!removed) {
        set({ kfSel: [] })
        return
      }
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
      set({ kfSel: [] })
    },

    moveKfKeysLive: (items, dt) => {
      const st = get()
      if (!items.length) return null
      // 드래그 시작 시점 기준 재적용 — items의 t는 잡은 시점 그대로 유효
      const baseline = st.editBaseline ?? snap()
      const baseSrc = baseline.source ?? st.sourceData
      if (!baseSrc) return null
      const src = cloneForLive(baseSrc)
      ensureLayerColors(src)
      const op = src.op
      // 그룹 클램프 — 전체가 [0, op] 안에 머무는 dt
      const ts = items.map((i) => i.t)
      const d = Math.max(-Math.min(...ts), Math.min(op - Math.max(...ts), Math.round(dt)))
      if (d === 0 && st.editBaseline === null) return null // 시작 전 무의미한 틱
      // 리지드 충돌 검사 — 목적지에 비선택 키(같은 레이어·채널)가 있으면 이번 틱 무시
      const byLayer = new Map<number, KfSelItem[]>()
      for (const it of items) {
        const arr = byLayer.get(it.li) ?? []
        arr.push(it)
        byLayer.set(it.li, arr)
      }
      for (const [li, its] of byLayer) {
        const layer = src.layers[li] as Record<string, unknown> | undefined
        if (!layer) return null
        const xkf = normKf(layer.xkf as Partial<CustomKf> | undefined)
        for (const it of its) {
          const others = xkf.keys.filter(
            (k) =>
              k[it.ch] !== undefined &&
              !its.some((s) => s.ch === it.ch && Math.abs(s.t - k.t) < 0.5),
          )
          if (others.some((k) => Math.abs(k.t - (it.t + d)) < 0.5)) return null
        }
      }
      // 적용 — 채널값(+구간 이징 오버라이드) 분리 후 새 시각에 업서트
      for (const [li, its] of byLayer) {
        editKfLayerIn(src, li, (xkf) => {
          const movedVals: {
            ch: KfChannel
            t: number
            v: number | [number, number]
            e?: Bezier4
          }[] = []
          for (const it of its) {
            const k = xkf.keys.find((x) => Math.abs(x.t - it.t) < 0.5 && x[it.ch] !== undefined)
            if (!k) continue
            movedVals.push({
              ch: it.ch,
              t: it.t + d,
              v: k[it.ch] as number | [number, number],
              e: k.e?.[it.ch],
            })
            delete k[it.ch]
            if (k.e) delete k.e[it.ch]
            if (k.p === undefined && k.s === undefined && k.r === undefined && k.o === undefined)
              xkf.keys = xkf.keys.filter((x) => x !== k)
          }
          for (const m of movedVals) upsertKey(xkf, m.ch, m.t, m.v, m.e)
        })
      }
      const applied = applyKnobs(src, st.templateKnobs, st.knobValues)
      set({
        animationData: applied,
        sourceData: src,
        colorGroups: st.colorGroups, // 키 이동은 색 불변 — 라이브 재추출 생략
        editBaseline: baseline,
        future: [],
      })
      return d
    },

    nudgeKfSel: (df) => {
      const items = get().kfSel
      if (!items.length) return
      const d = get().moveKfKeysLive(items, df)
      get().commitEdit()
      if (d === null || d === 0) return
      set({ kfSel: items.map((it) => ({ ...it, t: it.t + d })) })
    },

    reverseKfSel: () => {
      const st = get()
      const items = st.kfSel
      if (items.length < 2 || !st.sourceData) return
      const src = structuredClone(st.sourceData)
      ensureLayerColors(src)
      // 전체 선택 구간 창 기준 미러 (AE 시간 반전) — 레이어 넘어 스태거도 뒤집힌다
      const tmin = Math.min(...items.map((i) => i.t))
      const tmax = Math.max(...items.map((i) => i.t))
      if (tmax - tmin < 1) return
      const mirror = (t: number) => Math.round((tmin + tmax - t) * 10) / 10
      const byLayer = new Map<number, KfSelItem[]>()
      for (const it of items) {
        const arr = byLayer.get(it.li) ?? []
        arr.push(it)
        byLayer.set(it.li, arr)
      }
      // 충돌 사전 검사 — 목적지에 비선택 키(같은 레이어·채널)가 있으면 통째로 중단
      for (const [li, its] of byLayer) {
        const layer = src.layers[li] as Record<string, unknown> | undefined
        if (!layer) return
        const xkf = normKf(layer.xkf as Partial<CustomKf> | undefined)
        for (const it of its) {
          const others = xkf.keys.filter(
            (k) =>
              k[it.ch] !== undefined &&
              !its.some((s) => s.ch === it.ch && Math.abs(s.t - k.t) < 0.5),
          )
          if (others.some((k) => Math.abs(k.t - mirror(it.t)) < 0.5)) return
        }
      }
      const flip = (b?: Bezier4): Bezier4 | undefined =>
        b ? [1 - b[2], 1 - b[3], 1 - b[0], 1 - b[1]] : undefined
      const newSel: KfSelItem[] = []
      for (const [li, its] of byLayer) {
        editKfLayerIn(src, li, (xkf) => {
          const byCh = new Map<KfChannel, number[]>()
          for (const it of its) {
            const arr = byCh.get(it.ch) ?? []
            arr.push(it.t)
            byCh.set(it.ch, arr)
          }
          for (const [ch, ts] of byCh) {
            const sorted = [...ts].sort((a, b) => a - b)
            // 값+이징 걷어내기
            const recs: { t: number; v: number | [number, number]; e?: Bezier4 }[] = []
            for (const t of sorted) {
              const k = xkf.keys.find((x) => Math.abs(x.t - t) < 0.5 && x[ch] !== undefined)
              if (!k) continue
              recs.push({ t, v: k[ch] as number | [number, number], e: k.e?.[ch] })
              delete k[ch]
              if (k.e) delete k.e[ch]
            }
            xkf.keys = xkf.keys.filter(
              (k) =>
                k.p !== undefined || k.s !== undefined || k.r !== undefined || k.o !== undefined,
            )
            const n = recs.length
            // 역순 재배치 — new_m = old_{n-1-m}, 나가는 이징 = flip(old_{n-2-m}의 이징)
            for (let m = 0; m < n; m++) {
              const rec = recs[n - 1 - m]
              const nt = mirror(rec.t)
              const e = m < n - 1 ? flip(recs[n - 2 - m].e) : undefined
              upsertKey(xkf, ch, nt, rec.v, e)
              newSel.push({ li, ch, t: Math.max(0, Math.round(nt)) })
            }
          }
        })
      }
      const applied = applyKnobs(src, st.templateKnobs, st.knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        kfSel: newSel,
      })
    },

    setLayerBlend: (bm) => {
      const { sourceData, templateKnobs, knobValues, customIdx } = get()
      if (!sourceData?.layers.length) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const layer = src.layers[Math.min(customIdx, src.layers.length - 1)] as Record<
        string,
        unknown
      >
      if (!layer) return
      if (bm > 0) layer.bm = bm
      else delete layer.bm
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    toggleLayerHide: (li) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[li]) return
      const src = structuredClone(sourceData)
      const layer = src.layers[li] as Record<string, unknown>
      if (layer.hd === true) delete layer.hd
      else layer.hd = true
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    toggleLayerSolo: (li) => {
      // 솔로는 플래그만 — 실제 숨김은 프리뷰(LottiePlayer)에서 적용, 내보내기엔 안 실림
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[li]) return
      const src = structuredClone(sourceData)
      const layer = src.layers[li] as Record<string, unknown>
      if (layer.xsolo === true) delete layer.xsolo
      else layer.xsolo = true
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    setLayerMatte: (li, opts) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[li]) return
      const src = structuredClone(sourceData)
      const layers = src.layers as Record<string, unknown>[]
      // ind 보장 — tp 참조용
      let maxInd = 0
      for (const l of layers) if (typeof l.ind === 'number') maxInd = Math.max(maxInd, l.ind as number)
      for (const l of layers) if (typeof l.ind !== 'number') l.ind = ++maxInd
      const layer = layers[li]
      if (opts.type === 'none' || opts.sourceLi === null || opts.sourceLi === li) {
        delete layer.tt
        delete layer.tp
      } else {
        const source = layers[opts.sourceLi]
        if (!source) return
        layer.tt = (opts.type === 'alpha' ? 1 : 3) + (opts.invert ? 1 : 0)
        layer.tp = source.ind as number
      }
      // td 재계산 — 실제 소비되는 소스에만 부여 (tp 우선, 없으면 인접 규칙)
      const byInd = new Map(layers.map((l) => [l.ind as number, l]))
      for (const l of layers) delete l.td
      layers.forEach((l, i) => {
        if (l.tt === undefined) return
        const sourceL =
          typeof l.tp === 'number' ? byInd.get(l.tp as number) : i > 0 ? layers[i - 1] : undefined
        if (sourceL) sourceL.td = 1
      })
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    setLayerParent: (li, targetLi) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[li]) return
      const src = structuredClone(sourceData)
      const layers = src.layers as Record<string, unknown>[]
      // ind 보장 — 없는 레이어에 순차 부여 (그린 도형 등)
      let maxInd = 0
      for (const l of layers) if (typeof l.ind === 'number') maxInd = Math.max(maxInd, l.ind as number)
      for (const l of layers) if (typeof l.ind !== 'number') l.ind = ++maxInd
      const layer = layers[li]
      if (targetLi === null) {
        delete layer.parent
      } else {
        const target = layers[targetLi]
        if (!target || target === layer) return
        // 순환 가드 — 대상의 부모 체인에 자신이 있으면 거부
        const byInd = new Map(layers.map((l) => [l.ind as number, l]))
        let cur: Record<string, unknown> | undefined = target
        let hop = 0
        while (cur && hop++ < 64) {
          if (cur === layer) return
          cur = typeof cur.parent === 'number' ? byInd.get(cur.parent as number) : undefined
        }
        layer.parent = target.ind as number
      }
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    toggleLayerLock: (li) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[li]) return
      const src = structuredClone(sourceData)
      const layer = src.layers[li] as Record<string, unknown>
      if (layer.xlock === true) delete layer.xlock
      else layer.xlock = true
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    toggleLayerTloff: (li) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers[li]) return
      const src = structuredClone(sourceData)
      const layer = src.layers[li] as Record<string, unknown>
      if (layer.xtloff === true) delete layer.xtloff
      else layer.xtloff = true
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    setTlHideOff: (v) => set({ tlHideOff: v }),

    renameLayer: (li, name) => {
      const { sourceData, templateKnobs, knobValues } = get()
      const nm = name.trim()
      if (!sourceData?.layers[li] || !nm) return
      const src = structuredClone(sourceData)
      ;(src.layers[li] as Record<string, unknown>).nm = nm
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
    },

    setKfSmooth: (v) => {
      const next = withKfEdit(get(), (xkf) => {
        xkf.smooth = v
      })
      if (next) push(next)
    },

    copyKfSel: () => {
      const { kfSel, sourceData } = get()
      if (!kfSel.length || !sourceData) return
      const minT = Math.min(...kfSel.map((i) => i.t))
      const entries: KfClipEntry[] = []
      for (const it of kfSel) {
        const lr = sourceData.layers[it.li] as Record<string, unknown> | undefined
        if (!lr) continue
        const xkf = normKf(lr.xkf as Partial<CustomKf> | undefined)
        const k = xkf.keys.find((x) => Math.abs(x.t - it.t) < 0.5 && x[it.ch] !== undefined)
        if (!k) continue
        entries.push({
          li: it.li,
          dt: it.t - minT,
          ch: it.ch,
          v: structuredClone(k[it.ch]) as number | [number, number],
          e: k.e?.[it.ch] ? ([...k.e[it.ch]!] as Bezier4) : undefined,
        })
      }
      if (entries.length) kfClipboard = entries
    },

    pasteKfAt: (frame) => {
      const { sourceData } = get()
      if (!kfClipboard?.length || !sourceData) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const op = src.op
      const byLayer = new Map<number, KfClipEntry[]>()
      for (const en of kfClipboard) {
        const li = Math.min(en.li, src.layers.length - 1)
        if (li < 0) continue
        // 키프레임 모드 레이어에만 — 아닌 레이어는 건너뜀
        if (!(src.layers[li] as Record<string, unknown>).xkf) continue
        const arr = byLayer.get(li) ?? []
        arr.push(en)
        byLayer.set(li, arr)
      }
      if (!byLayer.size) return
      const pasted: KfSelItem[] = []
      for (const [li, ens] of byLayer) {
        editKfLayerIn(src, li, (xkf) => {
          if (!xkf.on) return
          for (const en of ens) {
            const t = Math.max(0, Math.min(op, Math.round(frame + en.dt)))
            upsertKey(xkf, en.ch, t, structuredClone(en.v), en.e)
            pasted.push({ li, ch: en.ch, t })
          }
        })
      }
      if (!pasted.length) return
      const applied = applyKnobs(src, get().templateKnobs, get().knobValues)
      push({ animationData: applied, sourceData: src, colorGroups: extractColorGroups(applied) })
      set({ kfSel: pasted })
    },

    moveKfClipLive: (clipA, clipB, dt) => {
      const st = get()
      // 드래그 시작 시점 기준 재적용 — dt는 잡은 시점 클립 대비 오프셋
      const baseline = st.editBaseline ?? snap()
      const baseSt = { ...st, sourceData: baseline.source ?? st.sourceData } as EditorState
      const next = withKfEdit(baseSt, (xkf, layer) => {
        const op = baseSt.sourceData?.op ?? 90
        // 키 시각 클램프 — 컴프 밖(음수/op 초과)으로 밀려 영구히 지울 수 없는 키가 생기는 것 방지
        const moved: typeof xkf.keys = []
        for (const k of xkf.keys) {
          const t = Math.max(0, Math.min(op, Math.round((k.t + dt) * 10) / 10))
          // 클램프로 같은 시각에 겹치면 먼저 온 키만 유지
          if (moved.some((m) => Math.abs(m.t - t) < 0.5)) continue
          k.t = t
          moved.push(k)
        }
        xkf.keys = moved
        const full = normSel(layer.xsel as Partial<CustomSel> | undefined, op)
        layer.xsel = { ...full, clip: [clipA, clipB] }
      }, true)
      if (!next) return
      set({ ...next, editBaseline: baseline, future: [] })
    },

    setKfSegEase: (ch, fromT, bez) => {
      const next = withKfEdit(get(), (xkf) => {
        const k = xkf.keys.find((x) => Math.abs(x.t - fromT) < 0.5 && x[ch] !== undefined)
        if (!k) return
        k.e = { ...(k.e ?? {}), [ch]: bez }
      })
      if (next) push(next)
    },

    bakeSpringSegEase: (ch, fromT, preset) => {
      const sp = SPRING_PRESETS[preset]
      if (!sp) return
      bakeCurveSegEase(ch, fromT, (u) => springValue(u, sp.zeta, sp.cycles))
    },

    bakeBounceSegEase: (ch, fromT) => {
      bakeCurveSegEase(ch, fromT, bounceValue)
    },

    duplicatePattern: (count, dx, dy, drot, dt, ds, dop) => {
      const { sourceData, templateKnobs, knobValues, customIdx } = get()
      if (!sourceData?.layers.length) return
      const n = Math.max(2, Math.min(12, Math.round(count)))
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      const li = Math.min(customIdx, src.layers.length - 1)
      const orig = src.layers[li] as Record<string, unknown>
      const baseXci = nextXci(src)
      const copies: Record<string, unknown>[] = []
      for (let i = 1; i < n; i++) {
        const copy = structuredClone(orig)
        copy.nm = `${String(orig.nm ?? t('레이어'))} ${i + 1}`
        copy.xci = baseXci + i - 1
        shiftLayer(copy, dx * i, dy * i)
        // 크기 오프셋 — 래스터는 에셋 사본을 떠서 스케일 (공유 에셋 오염 방지)
        if (ds) {
          const size0 = normSel(copy.xsel as Partial<CustomSel> | undefined, src.op).size
          const px = Math.max(4, Math.round(size0 * (1 + (ds / 100) * i)))
          if (copy.refId) {
            const assets = (src.assets ?? []) as Record<string, unknown>[]
            const srcAsset = assets.find((a) => a.id === copy.refId)
            if (srcAsset) {
              const dup = structuredClone(srcAsset)
              dup.id = nextAssetId(assets)
              assets.push(dup)
              copy.refId = dup.id
            }
          }
          applyLayerSize(src, copy, px)
        }
        const xsel = normSel(copy.xsel as Partial<CustomSel> | undefined, src.op)
        xsel.rotation = xsel.rotation + drot * i
        if (dop) xsel.opacity = Math.max(0, Math.min(100, xsel.opacity + dop * i))
        if (dt) {
          const off = Math.round(dt * i)
          xsel.clip = [
            Math.max(0, Math.min(src.op, xsel.clip[0] + off)),
            Math.max(0, Math.min(src.op, xsel.clip[1] + off)),
          ]
          const xkf = copy.xkf as CustomKf | undefined
          if (xkf?.on) {
            const kept: typeof xkf.keys = []
            for (const k of xkf.keys) {
              const t = Math.max(0, Math.min(src.op, Math.round((k.t + off) * 10) / 10))
              if (kept.some((m) => Math.abs(m.t - t) < 0.5)) continue
              k.t = t
              kept.push(k)
            }
            xkf.keys = kept
          }
        }
        copy.xsel = xsel
        copies.push(copy)
      }
      // 원본 뒤(아래)에 순서대로 — 에셋은 공유 (삭제는 참조 카운트로 보호됨)
      src.layers.splice(li + 1, 0, ...(copies as never[]))
      src.layers.forEach((l, i2) => (l.ind = i2 + 1))
      for (let i = li + 1; i <= li + copies.length; i++) editKfLayerIn(src, i, () => {})
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        kfSel: [],
      })
    },

    applyAiMotion: (plan) => {
      const { sourceData, templateKnobs, knobValues } = get()
      if (!sourceData?.layers.length) return
      const src = structuredClone(sourceData)
      ensureLayerColors(src)
      let touched = 0
      for (const lp of plan.layers) {
        if (lp.index < 0 || lp.index >= src.layers.length) continue
        const ok = editKfLayerIn(src, lp.index, (xkf, layer) => {
          xkf.on = true
          xkf.keys = structuredClone(lp.keys)
          if (lp.clip) {
            const xsel = normSel(layer.xsel as Partial<CustomSel> | undefined, src.op)
            xsel.clip = [lp.clip[0], lp.clip[1]]
            layer.xsel = xsel
          }
        })
        if (ok) touched++
      }
      if (!touched) return
      const applied = applyKnobs(src, templateKnobs, knobValues)
      push({
        animationData: applied,
        sourceData: src,
        colorGroups: extractColorGroups(applied),
        kfSel: [],
      })
    },

    setKfSegEaseLive: (ch, fromT, bez) => {
      const st = get()
      const next = withKfEdit(st, (xkf) => {
        const k = xkf.keys.find((x) => Math.abs(x.t - fromT) < 0.5 && x[ch] !== undefined)
        if (!k) return
        k.e = { ...(k.e ?? {}), [ch]: bez }
      }, true)
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
        kfSel: [], // 스냅샷엔 키 선택이 없음 — 낡은 인덱스로 남지 않게 정리
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
        kfSel: [],
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
    const payload = sessionPayload()
    if (!payload) return
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

/** 현재 상태 → 저장 페이로드 — 자동 저장과 .lmproj 프로젝트 저장이 공유. */
export function sessionPayload(): SavedSession | null {
  const s = useEditor.getState()
  if (!s.sourceData) return null
  return {
    v: 1,
    sourceData: s.sourceData,
    pristineData: s.pristineData,
    templateId: s.templateId,
    templateKnobs: s.templateKnobs,
    knobValues: s.knobValues,
    fileName: s.fileName,
    customIdx: s.customIdx,
    activeScene: s.activeScene,
  }
}

useEditor.subscribe((state) => {
  if (state.sourceData === lastSavedSource && state.knobValues === lastSavedKnobs) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveSessionNow, 800)
})

// 새로고침·창 닫기 직전 플러시 — 디바운스 창(0.8s) 안의 마지막 편집 유실 방지
if (typeof window !== 'undefined') window.addEventListener('pagehide', saveSessionNow)
