// 커스텀 빌더 — 업로드한 그래픽(래스터/SVG)에 스케일·포지션·오퍼시티 프리셋을 조합해
// 단일 레이어 로티를 만든다. 채널별 택일이라 프리셋끼리 충돌 없이 합성된다.
import type { LottieJson } from './lottieUtils'
import { wrapToFit, fitImageSize, type ImportedGraphic, type ImportedImage } from './svgImport'

export const CUSTOM_OP = 90 // 1.5s @60fps
export const CUSTOM_ASSET_PREFIX = 'img_custom'

export const POS_PRESETS = ['없음', '아래→위', '위→아래', '왼→오', '오→왼', '플로팅', '바운스']

export interface CustomSel {
  pos: number
  scale: number
  fade: number
  /** 포지션 프리셋의 이동량 px — 슬라이드 거리·플로팅 진폭·바운스 높이. */
  amount: number
  /** 그래픽 긴 변 px. */
  size: number
  /** 정적 회전 (°). */
  rotation: number
  /** 정적 불투명도 (0~100) — 오퍼시티 프리셋 파형에 곱해진다. */
  opacity: number
  /** 앵커 포인트 (0~1 비율) — 회전·스케일 기준점. */
  anchor: [number, number]
  /** 스케일 — 활성 토글 + 시작/끝(%) + 바운싱. */
  scaleOn: number
  scaleFrom: number
  scaleTo: number
  scaleBounce: number
  /** 오퍼시티 — 활성 토글 + 시작/끝(%). 비활성 시 opacity(정적) 사용. */
  fadeOn: number
  fadeFrom: number
  fadeTo: number
  /** 타임라인 창 [시작 프레임, 길이] — 없으면 채널 고유 타이밍. */
  posWin?: [number, number]
  scaleWin?: [number, number]
  fadeWin?: [number, number]
}

export const DEFAULT_SEL: CustomSel = {
  pos: 0, scale: 0, fade: 0, amount: 60, size: 240, rotation: 0, opacity: 100,
  anchor: [0.5, 0.5],
  scaleOn: 0, scaleFrom: 0, scaleTo: 100, scaleBounce: 1,
  fadeOn: 0, fadeFrom: 0, fadeTo: 100,
}

/** 오퍼시티 채널 활성 여부. */
export function isFadeOn(sel: CustomSel): boolean {
  return (sel.fadeOn ?? 0) !== 0 && sel.fadeFrom !== sel.fadeTo
}

/** 스케일 채널 활성 여부 — 구버전 세션(scaleOn 없음)은 값 차이로 판정. */
export function isScaleOn(sel: CustomSel): boolean {
  const on = sel.scaleOn ?? (sel.scaleFrom !== sel.scaleTo ? 1 : 0)
  return on !== 0 && sel.scaleFrom !== sel.scaleTo
}

const ease = (n: number) => ({
  i: { x: Array(n).fill(0.4), y: Array(n).fill(1) },
  o: { x: Array(n).fill(0.6), y: Array(n).fill(0) },
})

/** [t, 값] 목록 → 키프레임 프로퍼티 (마지막 키프레임엔 이징 생략). */
const kfProp = (dims: number, pts: [number, number[]][]) => ({
  a: 1,
  k: pts.map(([t, s], i) => (i < pts.length - 1 ? { ...ease(dims), t, s } : { t, s })),
})

/**
 * 포지션 채널 — base 중심의 오프셋 파형, amount = 이동량 px.
 * 방향 프리셋(1~4)은 오프셋에서 출발해 살짝 오버슈트 후 base 정착(등장 원샷).
 * 플로팅/바운스는 첫=마지막이라 루프 안전.
 */
export function posProp(base: [number, number], preset: number, amount = 60): unknown {
  const [x, y] = base
  const amt = Math.max(4, Math.min(400, amount))
  const P = (dx: number, dy: number): number[] => [x + dx, y + dy, 0]
  // 방향 슬라이드 공통 형태 — (sx, sy) 방향 단위 오프셋
  const slide = (sx: number, sy: number) =>
    kfProp(3, [
      [0, P(sx * amt, sy * amt)],
      [18, P(-sx * amt * 0.08, -sy * amt * 0.08)],
      [26, P(0, 0)],
      [90, P(0, 0)],
    ])
  switch (preset) {
    case 1: return slide(0, 1) // 아래→위
    case 2: return slide(0, -1) // 위→아래
    case 3: return slide(-1, 0) // 왼→오
    case 4: return slide(1, 0) // 오→왼
    case 5: {
      // 플로팅 — 상하 부유, 총 이동폭 = amount
      const h = amt / 2
      return kfProp(3, [
        [0, P(0, 0)], [22, P(0, -h)], [45, P(0, 0)], [68, P(0, h)], [90, P(0, 0)],
      ])
    }
    case 6: // 바운스 — 첫 튀기 = amount, 두 번째 = 1/3
      return kfProp(3, [
        [0, P(0, 0)], [18, P(0, -amt)], [34, P(0, 0)], [46, P(0, -amt / 3)],
        [58, P(0, 0)], [90, P(0, 0)],
      ])
    default:
      return { a: 0, k: [x, y, 0] }
  }
}

/**
 * 스케일 채널 — 시작→끝 스케일 트윈(%). 같으면 정적.
 * 바운싱이 켜지면 델타에 비례한 오버슈트 후 스프링 정착.
 */
export function scaleProp(from = 100, to = 100, bounce = 1): unknown {
  const S = (v: number): number[] => [v, v, 100]
  const f = Math.max(0, Math.min(300, from))
  const t = Math.max(0, Math.min(300, to))
  if (f === t) return { a: 0, k: [t, t, 100] }
  if (bounce) {
    const ov = (t - f) * 0.18
    return kfProp(3, [
      [0, S(f)], [14, S(t + ov)], [21, S(t - ov * 0.4)], [28, S(t)], [90, S(t)],
    ])
  }
  return kfProp(3, [[0, S(f)], [20, S(t)], [90, S(t)]])
}

/** 오퍼시티 채널 — 시작→끝 트윈(%). 같으면 정적. */
export function fadeProp(from = 0, to = 100): unknown {
  const f = Math.max(0, Math.min(100, from))
  const t = Math.max(0, Math.min(100, to))
  if (f === t) return { a: 0, k: t }
  return kfProp(1, [[0, [f]], [20, [t]], [90, [t]]])
}

/** 채널별 고유 액션 길이(f) — 타임라인 기본 바 폭. 0 = 정적(바 없음). */
export function nativePosDur(preset: number): number {
  if (preset >= 1 && preset <= 4) return 26 // 방향 슬라이드
  if (preset === 5) return 90 // 플로팅
  if (preset === 6) return 58 // 바운스
  return 0
}

export function nativeScaleDur(sel: CustomSel): number {
  if (!isScaleOn(sel)) return 0
  return sel.scaleBounce ? 28 : 20
}

export function nativeFadeDur(sel: CustomSel): number {
  return isFadeOn(sel) ? 20 : 0
}

/**
 * 채널 키프레임을 타임라인 창 [시작, 길이]로 리맵 — 프리미어식 밀기/당기기.
 * 액션(고유 길이 구간)을 창 길이에 맞게 스케일하고, 앞뒤는 첫/마지막 값으로 홀드.
 */
export function remapChannel(
  prop: unknown,
  actionDur: number,
  win: [number, number] | undefined,
): unknown {
  const p = prop as { a?: number; k?: ({ t: number; s: unknown } & Record<string, unknown>)[] }
  if (!win || !actionDur || p.a !== 1 || !Array.isArray(p.k)) return prop
  const st = Math.max(0, Math.min(CUSTOM_OP - 1, win[0]))
  const dur = Math.max(2, Math.min(CUSTOM_OP - st, win[1]))
  const sc = dur / actionDur
  const action = p.k.filter((kf) => kf.t <= actionDur + 0.01)
  if (!action.length) return prop
  const out: Record<string, unknown>[] = []
  if (st > 0) out.push({ ...action[0], t: 0 }) // 시작 전 홀드
  for (const kf of action) out.push({ ...kf, t: Math.round((st + kf.t * sc) * 10) / 10 })
  const last = action[action.length - 1]
  const end = st + actionDur * sc
  if (end < CUSTOM_OP - 0.01) out.push({ t: CUSTOM_OP, s: last.s }) // 종료 후 홀드
  return { a: 1, k: out }
}

export type CustomPayload =
  | { kind: 'image'; image: ImportedImage }
  | { kind: 'svg'; graphic: ImportedGraphic }

/**
 * 그래픽 하나 → 레이어(+ 이미지 에셋). xsel = 프리셋 선택 상태를 레이어에 저장
 * (로티 재생기는 무시하는 확장 필드 — undo/내보내기에도 따라다닌다).
 */
export function buildCustomLayer(
  payload: CustomPayload,
  sel: CustomSel,
  base: [number, number],
  nm: string,
  assetId: string,
): { layer: Record<string, unknown>; asset?: Record<string, unknown> } {
  const ks = {
    o: isFadeOn(sel)
      ? remapChannel(fadeProp(sel.fadeFrom, sel.fadeTo), nativeFadeDur(sel), sel.fadeWin)
      : { a: 0, k: Math.max(0, Math.min(100, sel.opacity)) },
    r: { a: 0, k: sel.rotation },
    p: remapChannel(posProp(base, sel.pos, sel.amount), nativePosDur(sel.pos), sel.posWin),
    a: { a: 0, k: [0, 0, 0] },
    s: isScaleOn(sel)
      ? remapChannel(
          scaleProp(sel.scaleFrom, sel.scaleTo, sel.scaleBounce),
          nativeScaleDur(sel),
          sel.scaleWin,
        )
      : { a: 0, k: [100, 100, 100] },
  }
  // xbase = 기준(정착) 위치 — 채널 재계산 시 첫 키프레임(오프셋 시작점)이 아니라 이 값을 쓴다
  const common = {
    ddd: 0, sr: 1, ao: 0, ip: 0, op: CUSTOM_OP, st: 0, bm: 0, nm,
    xsel: { ...sel }, xbase: [...base],
  }
  const [afx, afy] = sel.anchor ?? [0.5, 0.5]
  if (payload.kind === 'image') {
    const { w, h } = fitImageSize(payload.image, sel.size)
    // nw/nh = 원본 픽셀 — 크기 조절 시 재계산 기준
    const asset = {
      id: assetId, w, h, u: '', p: payload.image.dataUri, e: 1,
      nw: payload.image.w, nh: payload.image.h,
    }
    return {
      layer: {
        ...common, ty: 2, ind: 1, refId: assetId,
        ks: { ...ks, a: { a: 0, k: [w * afx, h * afy, 0] } },
      },
      asset,
    }
  }
  const group = wrapToFit(payload.graphic, sel.size) as Record<string, unknown>
  // bboxMax = 원본 최장 변(크기 재계산 기준), bboxW/H = 스냅용 원본 비율
  group.bboxMax = Math.max(payload.graphic.bbox.w, payload.graphic.bbox.h)
  group.bboxW = payload.graphic.bbox.w
  group.bboxH = payload.graphic.bbox.h
  // SVG는 원점 중심 — 앵커를 비율 오프셋으로
  const sc = sel.size / Math.max(payload.graphic.bbox.w, payload.graphic.bbox.h)
  const gw = payload.graphic.bbox.w * sc
  const gh = payload.graphic.bbox.h * sc
  return {
    layer: {
      ...common, ty: 4, ind: 1,
      ks: { ...ks, a: { a: 0, k: [(afx - 0.5) * gw, (afy - 0.5) * gh, 0] } },
      shapes: [group],
    },
  }
}

/** 첫 그래픽 → 512×512 로티 문서. */
export function buildCustomDoc(
  payload: CustomPayload,
  sel: CustomSel,
  base: [number, number],
  nm: string,
): LottieJson {
  const { layer, asset } = buildCustomLayer(payload, sel, base, nm, `${CUSTOM_ASSET_PREFIX}_0`)
  return {
    v: '5.7.4', fr: 60, ip: 0, op: CUSTOM_OP, w: 512, h: 512, nm: 'Custom', ddd: 0,
    assets: asset ? [asset] : [], layers: [layer as never],
  } as unknown as LottieJson
}
