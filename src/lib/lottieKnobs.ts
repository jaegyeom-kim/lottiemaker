// 템플릿 파라메트릭 옵션(노브) 엔진 — 픽셀/도(°) 절대 단위.
// 노브는 항상 "노브 미적용 원본(source)"에서 현재 값 전체를 다시 적용한다 — 중첩 누적 없음.
// 배율형 연산은 value / ref (ref = 원본에서 측정한 기준값)로 환산한다.

import type { LottieJson, LottieLayer } from './lottieUtils'

export type KnobOp =
  /** 캔버스 중심 기준 전체 줌. ref = 기준 px (예: 링 지름 340). */
  | { kind: 'zoom'; ref: number }
  /** 스트로크 두께. ref = 원본 대표 두께 px. */
  | { kind: 'stroke'; ref: number }
  /**
   * 아크 각도 + 꼬리물기(Material 스피너 방식). 값(°) = 기본 아크, 피크는 자동 3배(최대 한 바퀴).
   * 전반부: 머리(e)가 앞서가며 아크 성장. 후반부: 꼬리(s)가 따라잡으며 기본 길이로 수축.
   * 두 끝점 모두 앞으로만 이동(후퇴 없음). 사이클당 트림 전진량만큼 회전 종점을 줄여 루프를 보정.
   * toggleId가 가리키는 토글 노브가 0이면 꼬리물기 없이 고정 아크만 설정한다.
   * 기본값에서도 항상 적용된다(원본의 정적 트림을 대체).
   */
  | { kind: 'arcChase'; toggleId?: string }
  /** 상태 저장용 노브(토글 등) — 자체 변환 없음. 다른 연산이 values에서 참조. */
  | { kind: 'none' }
  /** 재생 길이 — 값은 초. 모든 키프레임 시각·레이어 구간·op를 비례 스케일 (fps 유지). */
  | { kind: 'timeStretch' }
  /** 가로 간격 — 레이어 x 위치(정적+키프레임)를 캔버스 중심 기준 배율. ref = 원본 최외곽 오프셋 px. */
  | { kind: 'spreadX'; ref: number }
  /** 모서리 라운딩 — 모든 rc의 r을 배율 스케일. ref = 원본 대표 r px. */
  | { kind: 'corner'; ref: number }
  /** 요소 표시 토글 — 값 0이면 nm이 match로 시작하는 레이어를 숨긴다(hd). */
  | { kind: 'layerVis'; match: string }
  /**
   * 컨페티 버스트 소멸 방식. 파티클별 스태거(첫 키프레임 t)와 발사점/도착점을 읽어
   * 스타일별로 위치/스케일/불투명도 키프레임을 재구성한다.
   * 0 스케일 아웃(원본: 이동 종료와 동기로 커졌다 줄며 소멸) / 1 낙하 / 2 페이드 / 3 팝 / 4 흡수.
   * 위치를 재구성하므로 퍼짐(ampPos)·회전(ampRot)보다 앞에 배치할 것.
   */
  | { kind: 'burstStyle' }
  /**
   * 파티클 발사 시차 스케일 — 값은 최대 시차(초). ref = 원본 최대 시차(초).
   * 각 레이어의 시작 시각을 배율만큼 당기거나 늘리고(내부 구간 길이는 유지),
   * 늘어난 만큼 전체 재생 구간(op)을 재계산한다. burstStyle보다 앞에 배치할 것.
   */
  | { kind: 'stagger'; ref: number }
  /**
   * 소멸 방식 — 불투명도 페이드아웃 꼬리를 가진 레이어 대상.
   * 0 스케일: 페이드 구간을 제거하고 같은 구간에 스케일 0 수렴을 넣는다.
   * 1 오퍼시티: 원본 페이드 유지.
   * 기본값(0)이 원본과 다르므로 항상 적용된다.
   */
  | { kind: 'vanish' }
  /**
   * 레이어 택일 — prefix로 시작하는 레이어들 중 items[value]와 이름이 같은 것만 표시.
   * items[value]가 null이면 전부 숨김. 기본값이 원본(전부 표시)과 다르므로 항상 적용.
   */
  | { kind: 'pickLayer'; prefix: string; items: (string | null)[] }
  /**
   * 코인 z두께 — 회전 슬랩(폭 모핑 라운드 사각형)의 최소 폭(px)을 설정.
   * 애니메이트된 rc 폭 키프레임 중 '얇은' 값(높이의 절반 미만)만 교체한다.
   */
  | { kind: 'coinDepth' }
  /**
   * 코인 회전 횟수 — 3회짜리 원본 키프레임을 분해해 N회로 재조립.
   * 코인 스케일/워블 재생성, 사이드 모프는 원본에서 첫 플립/중간 플립/마지막 플립(정착 포함)
   * 그룹을 추출해 반복 배치. 광택·반짝이 타이밍과 전체 길이도 함께 이동.
   * coinDepth·zoom·duration보다 앞에 배치할 것.
   */
  | { kind: 'coinSpins' }
  /**
   * 숫자 카운트 통합 레이아웃(항상 적용). 값(0–999,999)·쉼표·화폐·폰트 노브를 함께 읽어
   * 표시할 스트립 수/위치/롤 종점, 쉼표·화폐 레이어, fonts.list를 재구성한다.
   * ids: 함께 읽을 보조 노브 id.
   */
  | {
      kind: 'countStyle'
      ids: {
        comma: string
        currency: string
        font: string
        digitSize: string
        digitWeight: string
        curSize: string
        curWeight: string
      }
    }
  /**
   * 웨이브 바 개수 — 'Bar 1'을 원형으로 N개 재구성. 60px 피치 중앙 정렬,
   * 바당 8f 시차(전체가 루프 80f를 넘으면 시차를 압축). 다른 연산보다 앞에 배치할 것.
   * orderId가 가리키는 노브로 파동 순서 결정: 0 왼쪽부터 / 1 오른쪽부터 /
   * 2 중앙부터 / 3 바깥부터 / 4 랜덤(시드 고정 — 재계산에도 안정).
   * flowId 토글이 1이면 연속 파동: 쉬는 구간 없이 32f 주기로 계속 진동,
   * 위상을 주기에 분산하고 루프를 2주기(64f)로 재설정 — 끊김 없는 무한 반복.
   * seedId 노브로 랜덤 변주: 0 = 규칙적, 1 이상 = 시드별 위상/시차 지터 +
   * 바·사이클별 피크 높이 변주. 같은 시드는 항상 같은 패턴(재계산 안정),
   * 피크 패턴이 64f 주기라 루프 이음새 유지.
   * 순서/연속/시드 노브가 기본값이 아닐 수 있으므로 항상 적용된다.
   */
  | { kind: 'barCount'; orderId?: string; flowId?: string; seedId?: string }
  /**
   * 구도 방향 회전 — 값(옵션 인덱스) × 90°를 캔버스 중심 기준으로 전체 적용.
   * 루트 레이어의 위치(정적+키프레임)를 회전하고 레이어 회전값에 각도를 더한다.
   * 진폭(ampPos) 등 축 기준 연산 뒤에 배치할 것.
   */
  | { kind: 'dirRotate' }
  /** 위치 키프레임 진폭. ref = 원본 최대 편차 px. 첫 키프레임 기준이라 순환 유지.
   *  exclude: 해당 프리픽스로 시작하는 레이어는 제외 (광택 스윕 등 보호). */
  | { kind: 'ampPos'; ref: number; exclude?: string }
  /** 회전 키프레임 진폭. ref = 원본 최대 편차 °. */
  | { kind: 'ampRot'; ref: number }
  /**
   * 도형 크기(el/rc 치수, sr 반지름). ref = 원본 대표 치수 px.
   * pos: 도형 자체 위치(p)의 해당 축도 같은 배율로 스케일 — 끝점 고정형 도형
   * (프로그레스 채움 바처럼 p = 끝점 + 크기/2 패턴)의 정렬을 유지할 때 사용.
   */
  | { kind: 'shape'; ref: number; shapes?: ('el' | 'rc' | 'sr')[]; dims?: number[]; pos?: number[] }

export interface TemplateKnob {
  id: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit: string
  op: KnobOp
  /** 지정 시 슬라이더 대신 선택 칩으로 렌더 — 값은 옵션 인덱스. */
  options?: string[]
  /** 지정 시 체크박스로 렌더 — 값은 0/1. */
  toggle?: boolean
  /** 옵션 패널 탭 그룹 — 미지정은 '기본' 탭. */
  group?: string
  /** 지정 시 폰트 드롭다운으로 렌더 — 값은 프리셋 인덱스(number) 또는 로컬 폰트 패밀리(string). */
  fontPicker?: boolean
}

/** 폰트 프리셋 — fontPicker 노브의 숫자 인덱스가 가리키는 CSS font-family. */
export const FONT_PRESETS = [
  { label: 'Pretendard', family: 'Pretendard, sans-serif' },
  { label: '시스템 고딕', family: '-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif' },
  { label: '세리프', family: 'Georgia, "Times New Roman", serif' },
  { label: '모노', family: '"SF Mono", Menlo, Consolas, monospace' },
]

/** 노브 값 → CSS font-family. 문자열이면 로컬 폰트 패밀리(공백 대비 인용). */
export function resolveFontFamily(v: number | string | undefined): string {
  if (typeof v === 'string' && v) return `"${v.replace(/"/g, '')}", sans-serif`
  return FONT_PRESETS[Math.round(Number(v ?? 0))]?.family ?? FONT_PRESETS[0].family
}

/** 템플릿 원본 길이(초) 기준의 재생 길이 노브 — 로드 시 자동 추가. */
export function durationKnob(data: LottieJson): TemplateKnob {
  const sec = Math.round(((data.op - data.ip) / data.fr) * 10) / 10
  return {
    id: 'duration',
    label: '재생 길이',
    min: 0.4,
    max: 4,
    step: 0.1,
    default: sec,
    unit: 's',
    op: { kind: 'timeStretch' },
  }
}

interface AnimatableProp {
  a?: number
  k?: unknown
}

interface Keyframe {
  s?: number[]
  [key: string]: unknown
}

export function applyKnobs(
  base: LottieJson,
  knobs: TemplateKnob[],
  values: Record<string, number | string>,
): LottieJson {
  const out = structuredClone(base)
  for (const knob of knobs) {
    const raw = values[knob.id] ?? knob.default
    // 문자열 값(로컬 폰트 등)은 자체 변환 없는 노브(none)에만 실림 — 수치 연산은 기본값으로 대체
    const v = typeof raw === 'number' ? raw : knob.default
    // 기본값 = 원본 그대로. 단 아래 연산들은 기본값이 원본과 다른 변환이므로 항상 적용.
    const ALWAYS = ['arcChase', 'vanish', 'pickLayer', 'coinDepth', 'countStyle', 'barCount']
    if (raw === knob.default && !ALWAYS.includes(knob.op.kind)) continue
    const op = knob.op
    switch (op.kind) {
      case 'zoom': {
        // 스케일만 키우면 요소가 제자리에서 커져 캔버스 밖으로 잘린다.
        // 중심 기준 줌: 위치도 함께 변환해 구도 전체가 균일하게 움직이게 한다.
        const f = v / op.ref
        const cx = out.w / 2
        const cy = out.h / 2
        out.layers.forEach((l) => {
          // 패런팅된 레이어는 부모 좌표계 — 부모의 스케일이 전파되므로 건드리지 않는다
          if ((l as Record<string, unknown>).parent !== undefined) return
          scaleProp(ksProp(l, 's'), f, [0, 1])
          zoomPosition(ksProp(l, 'p'), f, cx, cy)
        })
        break
      }
      case 'stroke': {
        const f = v / op.ref
        eachShapeNode(out, (node) => {
          if (node.ty === 'st') scaleProp(node.w as AnimatableProp, f, [0])
        })
        break
      }
      case 'arcChase': {
        // 토글 off: 꼬리물기 없이 고정 아크만 설정 (회전은 원본 등속 유지)
        const chaseOn = op.toggleId === undefined || (values[op.toggleId] ?? 1) !== 0
        if (!chaseOn) {
          eachShapeNode(out, (node) => {
            if (node.ty !== 'tm') return
            const e = node.e as AnimatableProp | undefined
            if (e) node.e = { a: 0, k: Math.min(v / 3.6, 100) }
          })
          break
        }
        const mid = Math.round((out.ip + out.op) / 2)
        const ease = () => ({ i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } })
        // 기본 아크(%) — 피크는 3배, 단 한 바퀴(100%)를 넘지 않게 클램프
        const basePct = Math.min(v / 3.6, 88)
        const stretchPct = Math.min(basePct * 2, 100 - basePct)
        eachShapeNode(out, (node) => {
          if (node.ty !== 'tm') return
          const e = node.e as AnimatableProp | undefined
          const s = node.s as AnimatableProp | undefined
          if (!e || !s) return
          // 전반: 머리가 앞서간다 (아크 성장). 후반: 머리는 정속(홀드) — 회전이 계속 옮겨준다.
          node.e = {
            a: 1,
            k: [
              { ...ease(), t: out.ip, s: [basePct] },
              { ...ease(), t: mid, s: [basePct + stretchPct] },
              { t: out.op, s: [basePct + stretchPct] },
            ],
          }
          // 전반: 꼬리는 대기. 후반: 꼬리가 따라잡는다 (아크 수축). 둘 다 전진만 한다.
          node.s = {
            a: 1,
            k: [
              { ...ease(), t: out.ip, s: [0] },
              { ...ease(), t: mid, s: [0] },
              { t: out.op, s: [stretchPct] },
            ],
          }
        })
        // 사이클 동안 트림이 stretch%만큼 전진했으므로 회전을 그만큼 줄여야
        // 끝 프레임과 첫 프레임의 시각적 위치가 일치한다 (심리스 루프).
        if (stretchPct > 0) {
          const stretchDeg = stretchPct * 3.6
          out.layers.forEach((l) => {
            const r = ksProp(l, 'r')
            if (!r || r.a !== 1 || !Array.isArray(r.k) || r.k.length < 2) return
            const kfs = r.k as Keyframe[]
            const first = kfs[0]?.s?.[0]
            const last = kfs[kfs.length - 1]?.s
            if (typeof first !== 'number' || !Array.isArray(last)) return
            // 한 바퀴(0→360) 회전에만 적용
            if (Math.abs(last[0] - first - 360) < 0.01) last[0] = first + 360 - stretchDeg
          })
        }
        break
      }
      case 'barCount': {
        const N = Math.max(2, Math.min(8, Math.round(v)))
        const layers = out.layers as LottieLayer[]
        const proto = layers.find((l) => l.nm === 'Bar 1')
        if (!proto) break
        const others = layers.filter((l) => typeof l.nm !== 'string' || !l.nm.startsWith('Bar'))
        const e2 = () => ({ i: { x: [0.4, 0.4], y: [1, 1] }, o: { x: [0.6, 0.6], y: [0, 0] } })
        // 파동 순서 — 바 i의 시차 랭크 계산
        const orderIdx = op.orderId ? Math.round((values[op.orderId] as number) ?? 0) : 0
        let ranks: number[]
        if (orderIdx === 1) {
          ranks = Array.from({ length: N }, (_, i) => N - 1 - i)
        } else if (orderIdx === 2 || orderIdx === 3) {
          // 중앙/바깥부터 — 중심 거리로 랭크, 대칭 쌍은 같은 위상(미러 파동)
          const dists = Array.from({ length: N }, (_, i) => Math.abs(i - (N - 1) / 2))
          const uniq = [...new Set(dists)].sort((a, b) => a - b)
          ranks = dists.map((d) =>
            orderIdx === 2 ? uniq.indexOf(d) : uniq.length - 1 - uniq.indexOf(d),
          )
        } else if (orderIdx === 4) {
          // 랜덤 — 시드 고정 LCG 셔플: 노브 재계산마다 결과 동일
          let seed = N * 1103 + 12345
          const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
          ranks = Array.from({ length: N }, (_, i) => i)
          for (let i = N - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1))
            ;[ranks[i], ranks[j]] = [ranks[j], ranks[i]]
          }
        } else {
          ranks = Array.from({ length: N }, (_, i) => i)
        }
        const maxRank = Math.max(...ranks, 1)
        const flowOn = op.flowId !== undefined && ((values[op.flowId] as number) ?? 0) !== 0
        const seedVal = op.seedId ? Math.max(0, Math.round((values[op.seedId] as number) ?? 0)) : 0
        // 시드 0 = 규칙적, 1+ = 풀 변주 — 시드 값마다 완전히 다른 패턴, 같은 시드는 항상 동일
        const chaos = seedVal > 0 ? 1 : 0
        let cseed = seedVal * 9973 + N * 733 + orderIdx * 97 + 41
        const crnd = () => ((cseed = (cseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
        const PERIOD = 32 // 상승 16f + 하강 16f
        // 연속 모드는 루프를 2주기로 — 그리드가 주기 배수라 t0 == t64, 심리스
        if (flowOn) out.op = PERIOD * 2
        // 기본 시차 8f — 마지막 파동(32f)이 루프 80f 안에 끝나도록 압축
        const step = Math.min(8, 48 / maxRank)
        const bars: LottieLayer[] = []
        for (let i = 0; i < N; i++) {
          const b = structuredClone(proto)
          b.ind = i + 1
          ;(b as Record<string, unknown>).nm = `Bar ${i + 1}`
          if (flowOn) b.op = out.op
          const ks = (b as Record<string, unknown>).ks as Record<string, unknown>
          ;(ks.p as AnimatableProp).k = [256 + (i - (N - 1) / 2) * 60, 256, 0]
          const rc = (
            ((b as Record<string, unknown>).shapes as Record<string, unknown>[])[0]
              .it as Record<string, unknown>[]
          ).find((s) => s.ty === 'rc')
          if (!rc) continue
          // 불규칙 변주 — 지터(±), 피크 2종(아래로 최대 80px 변주)
          const jit = (crnd() - 0.5) * chaos
          const pk1 = 170 - crnd() * 80 * chaos
          const pk2 = 170 - crnd() * 80 * chaos
          const kfs: Record<string, unknown>[] = []
          if (flowOn) {
            // 위상을 주기에 균등 분산(+지터), 음수 시각부터 격자 생성 — t=0에서도 진동
            // 중간값을 베지어 그대로 보간(선행 키프레임을 lottie가 평가), 쉬는 구간 없음
            // 지터 포함 위상을 [0, PERIOD)로 정규화 — 격자 시작이 항상 t≤0이어야
            // 루프 앞구간까지 키프레임이 커버된다
            const raw = (ranks[i] / (maxRank + 1)) * PERIOD + jit * PERIOD
            const phase = ((raw % PERIOD) + PERIOD) % PERIOD
            let t = phase - PERIOD
            let m = 0 // 격자 칸 — 홀수 = 피크, 피크 값은 4칸(64f) 주기라 루프 이음새 유지
            while (t < out.op + 16) {
              const val = m % 2 === 1 ? (m % 4 === 1 ? pk1 : pk2) : 60
              kfs.push({ ...e2(), t: Math.round(t * 10) / 10, s: [36, Math.round(val)] })
              t += 16
              m++
            }
          } else {
            const st =
              Math.round(Math.max(0, Math.min(48, step * ranks[i] + jit * 16)) * 10) / 10
            kfs.push({ ...e2(), t: 0, s: [36, 60] })
            if (st > 0) kfs.push({ ...e2(), t: st, s: [36, 60] })
            kfs.push({ ...e2(), t: st + 16, s: [36, Math.round(pk1)] })
            kfs.push({ ...e2(), t: st + 32, s: [36, 60] })
            if (st + 32 < out.op) kfs.push({ t: out.op, s: [36, 60] })
          }
          ;(rc as { s: unknown }).s = { a: 1, k: kfs }
          bars.push(b)
        }
        out.layers = [...bars, ...others]
        break
      }
      case 'dirRotate': {
        const ang = Math.round(v) * 90
        if (ang % 360 === 0) break
        const rad = (ang * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const cx = out.w / 2
        const cy = out.h / 2
        const rot = (pt: number[]) => {
          const dx = pt[0] - cx
          const dy = pt[1] - cy
          pt[0] = cx + dx * cos - dy * sin
          pt[1] = cy + dx * sin + dy * cos
        }
        out.layers.forEach((l) => {
          if ((l as Record<string, unknown>).parent !== undefined) return
          const p = ksProp(l, 'p')
          if (p) {
            if (p.a === 1 && Array.isArray(p.k)) {
              for (const kf of p.k as Keyframe[]) if (Array.isArray(kf.s)) rot(kf.s)
            } else if (Array.isArray(p.k)) {
              rot(p.k as number[])
            }
          }
          const r = ksProp(l, 'r')
          if (r) {
            if (r.a === 1 && Array.isArray(r.k)) {
              for (const kf of r.k as Keyframe[]) if (Array.isArray(kf.s)) (kf.s as number[])[0] += ang
            } else if (typeof r.k === 'number') {
              r.k = r.k + ang
            }
          }
        })
        break
      }
      case 'ampPos': {
        const m = v / op.ref
        out.layers.forEach((l) => {
          if (op.exclude && typeof l.nm === 'string' && l.nm.startsWith(op.exclude)) return
          ampProp(ksProp(l, 'p'), m)
        })
        eachShapeNode(out, (node) => {
          if (node.ty === 'tr') ampProp(node.p as AnimatableProp, m)
        })
        break
      }
      case 'ampRot': {
        const m = v / op.ref
        out.layers.forEach((l) => ampProp(ksProp(l, 'r'), m))
        eachShapeNode(out, (node) => {
          if (node.ty === 'tr') ampProp(node.r as AnimatableProp, m)
        })
        break
      }
      case 'shape': {
        const f = v / op.ref
        const targets = op.shapes ?? ['el', 'rc', 'sr']
        const dims = op.dims ?? [0, 1]
        eachShapeNode(out, (node) => {
          const ty = node.ty as string
          if (!targets.includes(ty as 'el' | 'rc' | 'sr')) return
          if (ty === 'sr') {
            scaleProp(node.or as AnimatableProp, f, [0])
            scaleProp(node.ir as AnimatableProp, f, [0])
          } else {
            scaleProp(node.s as AnimatableProp, f, dims)
            if (op.pos) scaleProp(node.p as AnimatableProp, f, op.pos)
          }
        })
        break
      }
      case 'none':
        break
      case 'spreadX': {
        const f = v / op.ref
        const cx = out.w / 2
        for (const l of out.layers as LottieLayer[]) {
          const p = ksProp(l, 'p')
          if (!p) continue
          if (p.a === 1 && Array.isArray(p.k)) {
            for (const kf of p.k as Keyframe[]) {
              if (Array.isArray(kf.s)) kf.s[0] = cx + (kf.s[0] - cx) * f
              for (const key of ['ti', 'to'] as const) {
                const t = kf[key]
                if (Array.isArray(t)) t[0] = (t[0] as number) * f
              }
            }
          } else if (Array.isArray(p.k)) {
            const k = p.k as number[]
            k[0] = cx + (k[0] - cx) * f
          }
        }
        break
      }
      case 'corner': {
        const f = v / op.ref
        eachShapeNode(out, (node) => {
          if (node.ty === 'rc') scaleProp(node.r as AnimatableProp, f, [0])
        })
        break
      }
      case 'layerVis': {
        if (v === 0) {
          for (const l of out.layers as LottieLayer[]) {
            if (typeof l.nm === 'string' && l.nm.startsWith(op.match)) l.hd = true
          }
        }
        break
      }
      case 'pickLayer': {
        const keep = op.items[v] ?? null
        for (const l of out.layers as LottieLayer[]) {
          if (typeof l.nm === 'string' && l.nm.startsWith(op.prefix)) {
            l.hd = l.nm !== keep
          }
        }
        break
      }
      case 'countStyle': {
        // 숫자 크기(px) 기준 배율 — 줄 간격/베이스라인/슬롯 폭/창 크기를 함께 스케일
        const num = (id: string, dflt: number) => {
          const r = values[id]
          return typeof r === 'number' ? r : dflt
        }
        const digitSizeReq = Math.max(40, Math.min(130, Math.round(num(op.ids.digitSize, 90))))
        const n = Math.max(0, Math.min(999999999, Math.round(v)))
        const commaOn = num(op.ids.comma, 1) !== 0
        const curIdx = Math.round(num(op.ids.currency, 1))
        const curSizeReq = Math.max(24, Math.min(120, Math.round(num(op.ids.curSize, 62))))
        // lottie-web은 fStyle 키워드(Regular/Medium/Bold/Black)를 font-weight로 매핑
        const WEIGHTS = ['Regular', 'Medium', 'Bold', 'Black']
        const dWeight = WEIGHTS[Math.round(num(op.ids.digitWeight, 0))] ?? 'Regular'
        const cWeight = WEIGHTS[Math.round(num(op.ids.curWeight, 0))] ?? 'Regular'
        // wr = 글자폭/글자크기 비율 — 화폐 크기 노브에 비례해 슬롯 폭 산출
        const CUR: ({ t: string; suffix: boolean; wr: number } | null)[] = [
          null,
          { t: '원', suffix: true, wr: 1.13 },
          { t: '₩', suffix: false, wr: 0.69 },
          { t: '$', suffix: false, wr: 0.6 },
          { t: '%', suffix: true, wr: 0.86 },
        ]
        const fam = resolveFontFamily(values[op.ids.font])
        ;(out as Record<string, unknown>).fonts = {
          list: [
            { fName: 'Main', fFamily: fam, fStyle: dWeight, ascent: 72 },
            { fName: 'Cur', fFamily: fam, fStyle: cWeight, ascent: 72 },
          ],
        }
        const layers = out.layers as LottieLayer[]
        const docOf = (l: LottieLayer) => {
          const t = (l as Record<string, unknown>).t as Record<string, unknown> | undefined
          const d = t?.d as Record<string, unknown> | undefined
          const k = d?.k as Record<string, unknown>[] | undefined
          return k?.[0]?.s as Record<string, unknown> | undefined
        }
        // 레이아웃 계산 — 요청 크기 기준 폭이 캔버스를 넘으면 전체 비례 축소(9자리 대비)
        const str = String(n)
        const D = str.length
        const cur = CUR[curIdx] ?? null
        const useComma = commaOn && D > 3
        const nCommas = useComma ? Math.floor((D - 1) / 3) : 0
        const reqF = digitSizeReq / 90
        const rawW = D * 58 * reqF + nCommas * 24 * reqF + (cur ? cur.wr * curSizeReq : 0)
        const fit = Math.min(1, 484 / rawW)
        const digitSize = digitSizeReq * fit
        const curSize = curSizeReq * fit
        const f = digitSize / 90
        const LH = 110 * f
        const BASE = 256 + 35 * f // 창 중앙(256)에 베이스라인이 오도록 한 오프셋
        const Wd = 58 * f
        const Wc = 24 * f
        const curW = cur ? cur.wr * curSize : 0
        const totalW = D * Wd + nCommas * Wc + curW
        let x = 256 - totalW / 2
        type Item = { kind: 'strip'; i: number } | { kind: 'comma' } | { kind: 'cur' }
        const order: Item[] = []
        if (cur && !cur.suffix) order.push({ kind: 'cur' })
        for (let i = 0; i < D; i++) {
          order.push({ kind: 'strip', i })
          // 남은 자릿수가 3의 배수인 지점마다 쉼표 (예: 123,456,789)
          if (useComma && i < D - 1 && (D - 1 - i) % 3 === 0) order.push({ kind: 'comma' })
        }
        if (cur && cur.suffix) order.push({ kind: 'cur' })
        const centers: { item: Item; cx: number }[] = []
        for (const item of order) {
          const w = item.kind === 'strip' ? Wd : item.kind === 'comma' ? Wc : curW
          centers.push({ item, cx: x + w / 2 })
          x += w
        }
        // 스트립/창 배치 + 롤 종점
        const usedStrip = new Set<number>()
        for (const { item, cx } of centers) {
          if (item.kind !== 'strip') continue
          const k = item.i
          usedStrip.add(k)
          const digit = Number(str[k])
          const cycles = k >= D - 2 ? 2 : 1
          const dur = D === 1 ? 70 : Math.round(50 + (k / (D - 1)) * 40)
          const strip = layers.find((l) => l.nm === `Strip ${k + 1}`)
          const win = layers.find((l) => l.nm === `Window ${k + 1}`)
          if (!strip || !win) continue
          strip.hd = false
          win.hd = false
          const yf = BASE - (cycles * 10 + digit) * LH
          const p = ((strip as Record<string, unknown>).ks as Record<string, unknown>).p as AnimatableProp
          const kfs = p.k as (Keyframe & { t?: number })[]
          ;(kfs[0].s as number[])[0] = cx
          ;(kfs[0].s as number[])[1] = BASE
          kfs[1].t = dur - 9
          ;(kfs[1].s as number[])[0] = cx
          ;(kfs[1].s as number[])[1] = yf - 12 * f
          kfs[2].t = dur
          ;(kfs[2].s as number[])[0] = cx
          ;(kfs[2].s as number[])[1] = yf
          const wp = ((win as Record<string, unknown>).ks as Record<string, unknown>).p as AnimatableProp
          ;(wp.k as number[])[0] = cx
          // 매트 창 사각형도 글자 크기에 비례
          const winShapes = (win as Record<string, unknown>).shapes as Record<string, unknown>[] | undefined
          const winRc = (winShapes?.[0]?.it as Record<string, unknown>[] | undefined)?.find(
            (s) => s.ty === 'rc',
          )
          if (winRc) (winRc.s as AnimatableProp).k = [68 * f, 120 * f]
          const doc = docOf(strip)
          if (doc) {
            doc.f = 'Main'
            doc.s = digitSize
            doc.lh = LH
          }
        }
        for (let k = 0; k < 9; k++) {
          if (usedStrip.has(k)) continue
          const strip = layers.find((l) => l.nm === `Strip ${k + 1}`)
          const win = layers.find((l) => l.nm === `Window ${k + 1}`)
          if (strip) strip.hd = true
          if (win) win.hd = true
        }
        // 쉼표(최대 2개) / 화폐
        const commaCenters = centers.filter((c) => c.item.kind === 'comma')
        for (let ci = 0; ci < 2; ci++) {
          const commaL = layers.find((l) => l.nm === `Comma ${ci + 1}`)
          if (!commaL) continue
          const at = commaCenters[ci]
          commaL.hd = !at
          if (at) {
            const p = ((commaL as Record<string, unknown>).ks as Record<string, unknown>).p as AnimatableProp
            ;(p.k as number[])[0] = at.cx
            ;(p.k as number[])[1] = BASE
            const doc = docOf(commaL)
            if (doc) {
              doc.f = 'Main'
              doc.s = digitSize
            }
          }
        }
        const curL = layers.find((l) => l.nm === 'Currency')
        if (curL) {
          const at = centers.find((c) => c.item.kind === 'cur')
          curL.hd = !at || !cur
          if (at && cur) {
            const p = ((curL as Record<string, unknown>).ks as Record<string, unknown>).p as AnimatableProp
            ;(p.k as number[])[0] = at.cx
            ;(p.k as number[])[1] = BASE
            const doc = docOf(curL)
            if (doc) {
              doc.f = 'Cur' // 별도 폰트 엔트리 — 굵기를 숫자와 독립 제어
              doc.t = cur.t
              doc.s = curSize
            }
          }
        }
        break
      }
      case 'coinSpins': {
        const N = Math.max(1, Math.min(6, Math.round(v)))
        const layers = out.layers as LottieLayer[]
        const coin = layers.find((l) => l.nm === 'Coin')
        const sideL = layers.find((l) => l.nm === 'Side')
        if (!coin || !sideL) break
        const e3 = (ox: number, oy: number, ix: number, iy: number) => ({
          i: { x: [ix, ix, ix], y: [iy, iy, iy] },
          o: { x: [ox, ox, ox], y: [oy, oy, oy] },
        })
        // 1. 코인 스케일/워블 재생성 — 첫 플립은 20f 축소, 이후는 12f
        const sK: Keyframe[] = [{ ...e3(0.42, 0, 0.999, 1), t: 0, s: [100, 100, 100] } as Keyframe]
        const pK: Keyframe[] = [{ ...e3(0.42, 0, 0.999, 1), t: 0, s: [256, 256, 0] } as Keyframe]
        let end = 0
        for (let i = 0; i < N; i++) {
          const thin = i === 0 ? 20 : end + 12
          sK.push({ ...e3(0.167, 0, 0.833, 1), t: thin, s: [2.6, 100, 100] } as Keyframe)
          sK.push({ ...e3(0.167, 0.167, 0.833, 0.833), t: thin + 1, s: [12, 100, 100] } as Keyframe)
          sK.push({ ...e3(0.167, 0.165, 0.999, 1), t: thin + 12, s: [100, 100, 100] } as Keyframe)
          pK.push({ ...e3(0.167, 0, 0.833, 1), t: thin, s: [277, 256, 0] } as Keyframe)
          pK.push({ ...e3(0.167, 0.167, 0.833, 0.833), t: thin + 1, s: [236.7, 256, 0] } as Keyframe)
          pK.push({ ...e3(0.167, 0.167, 0.999, 1), t: thin + 12, s: [256, 256, 0] } as Keyframe)
          end = thin + 12
        }
        const coinKs = (coin as Record<string, unknown>).ks as Record<string, unknown>
        coinKs.s = { a: 1, k: sK }
        coinKs.p = { a: 1, k: pK }
        // 2. 사이드 모프: 원본(3회) 키프레임에서 그룹 추출 후 재배치
        let sideSh: AnimatableProp | null = null
        const findSh = (items: unknown) => {
          if (!Array.isArray(items)) return
          for (const it of items) {
            const node = it as Record<string, unknown>
            if (node.ty === 'sh' && (node.ks as AnimatableProp)?.a === 1) sideSh = node.ks as AnimatableProp
            if (node.ty === 'gr') findSh(node.it)
          }
        }
        findSh((sideL as Record<string, unknown>).shapes)
        if (sideSh) {
          const src = (sideSh as AnimatableProp).k as (Keyframe & { t: number })[]
          const clone = (kf: Keyframe, t: number) => ({ ...JSON.parse(JSON.stringify(kf)), t })
          const g1 = src.filter((k) => k.t <= 32)
          const mid = src.filter((k) => k.t > 32 && k.t <= 56)
          const g3 = src.filter((k) => k.t > 56 && k.t <= 88)
          const newK: Keyframe[] = g1.map((k) => clone(k, k.t))
          for (let j = 0; j < Math.max(0, N - 2); j++) {
            const base = 32 + 24 * j
            for (const k of mid) newK.push(clone(k, base + (k.t - 32)))
          }
          if (N >= 2) {
            const base = 32 + 24 * (N - 2)
            for (const k of g3) newK.push(clone(k, base + (k.t - 56)))
          }
          const newOp = end + 52
          const last = newK[newK.length - 1]
          newK.push({ t: newOp, s: JSON.parse(JSON.stringify(last.s)) } as Keyframe)
          ;(sideSh as AnimatableProp).k = newK
        }
        // 3. 광택/반짝이 타이밍 + 전체 길이 이동 (원본 플립 종료 80 기준)
        const delta = end - 80
        const newOp = end + 52
        for (const l of layers) {
          if (typeof l.nm === 'string' && (l.nm.startsWith('Light') || l.nm.startsWith('Sparkle'))) {
            const ks = (l as Record<string, unknown>).ks as Record<string, unknown>
            for (const key of ['p', 'r', 's', 'o']) {
              const prop = ks[key] as AnimatableProp | undefined
              if (!prop || prop.a !== 1 || !Array.isArray(prop.k)) continue
              for (const kf of prop.k as (Keyframe & { t?: number })[]) {
                if (typeof kf.t === 'number' && kf.t > 80) kf.t += delta
              }
            }
          }
          l.op = newOp
        }
        out.op = newOp
        break
      }
      case 'coinDepth': {
        // 사이드 패스 모프의 슬랩(폭이 좁은) 키프레임 x 좌표를 배율 조정. 원본 슬랩 폭 42px.
        const f = v / 42
        eachShapeNode(out, (node) => {
          if (node.ty !== 'sh') return
          const ks = node.ks as AnimatableProp
          if (!ks || ks.a !== 1 || !Array.isArray(ks.k)) return
          for (const kfr of ks.k as Keyframe[]) {
            const sh = (kfr.s as unknown[])?.[0] as
              | { v: number[][]; i: number[][]; o: number[][] }
              | undefined
            if (!sh || !Array.isArray(sh.v)) continue
            const xs = sh.v.map((p) => p[0])
            const span = Math.max(...xs) - Math.min(...xs)
            if (span < 70) {
              sh.v.forEach((p) => (p[0] *= f))
              sh.i.forEach((p) => (p[0] *= f))
              sh.o.forEach((p) => (p[0] *= f))
            }
          }
        })
        break
      }
      case 'vanish': {
        if (v === 1) break // 오퍼시티 = 원본 페이드 유지
        const easeS = { i: { x: [0.6, 0.6, 0.6], y: [1, 1, 1] }, o: { x: [0.7, 0.7, 0.7], y: [0, 0, 0] } }
        for (const l of out.layers as LottieLayer[]) {
          const ks = (l as Record<string, unknown>).ks as Record<string, unknown>
          const o = ks.o as AnimatableProp
          if (!o || o.a !== 1 || !Array.isArray(o.k)) continue
          const okfs = o.k as (Keyframe & { t?: number })[]
          // 페이드아웃 꼬리 탐지: 끝에서 이어지는 0 값 키프레임 구간
          let zi = okfs.length - 1
          if (((okfs[zi].s as number[] | undefined)?.[0] ?? 1) !== 0) continue
          while (zi > 0 && ((okfs[zi - 1].s as number[] | undefined)?.[0] ?? 1) === 0) zi--
          if (zi === 0) continue
          const holdVal = (okfs[zi - 1].s as number[])[0]
          const t1 = okfs[zi - 1].t as number
          const t2 = okfs[zi].t as number
          // 페이드 제거: 꼬리 0 값들을 직전 값으로 유지 (페이드인 등 앞부분은 보존)
          for (let j = zi; j < okfs.length; j++) okfs[j].s = [holdVal]
          // 같은 구간에 스케일 0 수렴 추가
          const s = ks.s as AnimatableProp
          if (s.a !== 1 || !Array.isArray(s.k)) {
            const val = Array.isArray(s.k) ? [...(s.k as number[])] : [100, 100, 100]
            ks.s = { a: 1, k: [
              { ...easeS, t: t1, s: val },
              { t: t2, s: [0, 0, val[2] ?? 100] },
            ] }
          } else {
            // 이미 스케일 애니메이션이 있으면: 페이드 종점(t2) 이전 키프레임만 유지하고
            // t2에 0 수렴을 삽입 — 이후 홀드 키프레임은 버린다 (단조증가 보장)
            const skfs = s.k as (Keyframe & { t?: number })[]
            const kept = skfs.filter((kf) => typeof kf.t === 'number' && kf.t < t2)
            if (kept.length === 0) kept.push(skfs[0])
            Object.assign(kept[kept.length - 1], easeS) // 마지막이 아니게 되므로 핸들 부여
            const zAxis = (kept[kept.length - 1].s as number[])[2] ?? 100
            kept.push({ t: t2, s: [0, 0, zAxis] })
            s.k = kept
          }
        }
        break
      }
      case 'stagger': {
        const f = v / op.ref
        let maxStart = 0
        let maxSpan = 0
        for (const l of out.layers as LottieLayer[]) {
          const ks = (l as Record<string, unknown>).ks as Record<string, unknown>
          const p = ks.p as AnimatableProp
          if (!p || p.a !== 1 || !Array.isArray(p.k)) continue
          const t0 = ((p.k[0] as Keyframe & { t?: number }).t as number) ?? 0
          const delta = t0 * (f - 1)
          // 레이어의 모든 애니메이션 키프레임을 delta만큼 이동 — 내부 타이밍은 그대로
          for (const key of ['p', 'r', 's', 'o'] as const) {
            const prop = ks[key] as AnimatableProp | undefined
            if (!prop || prop.a !== 1 || !Array.isArray(prop.k)) continue
            for (const kf of prop.k as (Keyframe & { t?: number })[]) {
              if (typeof kf.t === 'number') kf.t += delta
            }
            const last = prop.k[prop.k.length - 1] as Keyframe & { t?: number }
            if (typeof last.t === 'number') maxSpan = Math.max(maxSpan, last.t)
          }
          maxStart = Math.max(maxStart, t0 * f)
        }
        // 시차가 늘면 재생 구간도 늘어난다 (소멸 스타일 재구성 여유분 포함)
        const newOp = Math.round(Math.max(maxSpan + 8, maxStart + 88))
        out.op = newOp
        for (const l of out.layers as LottieLayer[]) l.op = newOp
        break
      }
      case 'burstStyle': {
        const e3 = (ox: number, oy: number, ix: number, iy: number) => ({
          i: { x: [ix, ix, ix], y: [iy, iy, iy] },
          o: { x: [ox, ox, ox], y: [oy, oy, oy] },
        })
        const e1 = (ox: number, oy: number, ix: number, iy: number) => ({
          i: { x: [ix], y: [iy] },
          o: { x: [ox], y: [oy] },
        })
        const move = e3(0.333, 0, 0.2, 1) // 발사 강감속 (레퍼런스)
        const grow = e3(0.333, 0, 0.3, 1)
        const fall = e3(0.5, 0, 0.75, 0.6) // 중력 가속
        for (const l of out.layers as LottieLayer[]) {
          const ks = (l as Record<string, unknown>).ks as Record<string, unknown>
          const p = ks.p as AnimatableProp
          if (!p || p.a !== 1 || !Array.isArray(p.k)) continue
          const pk = p.k as (Keyframe & { t?: number })[]
          const t0 = typeof pk[0].t === 'number' ? pk[0].t : 0 // 파티클 스태거 유지
          const c = [...(pk[0].s as number[])]
          const e = [...(pk[pk.length - 1].s as number[])]
          switch (v) {
            case 1: // 낙하: 감속 도착 → 중력 가속 낙하 + 페이드
              ks.p = { a: 1, k: [
                { ...move, t: t0, s: c },
                { ...fall, t: t0 + 52, s: e },
                { t: t0 + 84, s: [e[0], e[1] + 170, 0] },
              ] }
              ks.s = { a: 1, k: [
                { ...grow, t: t0, s: [0, 0, 100] },
                { t: t0 + 30, s: [100, 100, 100] },
              ] }
              ks.o = { a: 1, k: [
                { ...e1(0.6, 0, 0.4, 1), t: t0 + 56, s: [100] },
                { t: t0 + 84, s: [0] },
              ] }
              break
            case 2: // 페이드: 제자리에서 서서히 투명해짐 (수축 없음)
              ks.p = { a: 1, k: [
                { ...move, t: t0, s: c },
                { t: t0 + 80, s: e },
              ] }
              ks.s = { a: 1, k: [
                { ...grow, t: t0, s: [0, 0, 100] },
                { t: t0 + 36, s: [100, 100, 100] },
              ] }
              ks.o = { a: 1, k: [
                { ...e1(0.6, 0, 0.4, 1), t: t0 + 52, s: [100] },
                { t: t0 + 84, s: [0] },
              ] }
              break
            case 3: // 팝: 도착 후 살짝 부풀었다 순간 소멸
              ks.p = { a: 1, k: [
                { ...move, t: t0, s: c },
                { t: t0 + 72, s: e },
              ] }
              ks.s = { a: 1, k: [
                { ...grow, t: t0, s: [0, 0, 100] },
                { ...grow, t: t0 + 36, s: [100, 100, 100] },
                { ...e3(0.3, 0, 0.3, 1), t: t0 + 66, s: [100, 100, 100] },
                { ...e3(0.3, 0, 0.3, 1), t: t0 + 74, s: [130, 130, 100] },
                { t: t0 + 80, s: [0, 0, 100] },
              ] }
              ks.o = { a: 0, k: 100 }
              break
            case 4: // 흡수: 퍼졌다가 중심으로 빨려들며 축소 소멸
              ks.p = { a: 1, k: [
                { ...move, t: t0, s: c },
                { ...e3(0.55, 0, 0.8, 0.4), t: t0 + 48, s: e },
                { t: t0 + 84, s: c },
              ] }
              ks.s = { a: 1, k: [
                { ...grow, t: t0, s: [0, 0, 100] },
                { ...grow, t: t0 + 30, s: [100, 100, 100] },
                { ...e3(0.6, 0, 0.4, 1), t: t0 + 56, s: [100, 100, 100] },
                { t: t0 + 84, s: [20, 20, 100] },
              ] }
              ks.o = { a: 1, k: [
                { ...e1(0.6, 0, 0.4, 1), t: t0 + 72, s: [100] },
                { t: t0 + 84, s: [0] },
              ] }
              break
          }
        }
        break
      }
      case 'timeStretch': {
        const span = out.op - out.ip
        if (span <= 0) break
        const newOp = Math.round(v * out.fr)
        const f = newOp / span
        const visit = (node: unknown) => {
          if (Array.isArray(node)) {
            node.forEach(visit)
            return
          }
          if (node === null || typeof node !== 'object') return
          const obj = node as Record<string, unknown>
          if (obj.a === 1 && Array.isArray(obj.k) && obj.k.length && typeof obj.k[0] === 'object' && !Array.isArray(obj.k[0])) {
            for (const kf of obj.k as (Keyframe & { t?: number })[]) {
              if (typeof kf.t === 'number') kf.t = (kf.t - out.ip) * f + out.ip
            }
          }
          for (const key of Object.keys(obj)) visit(obj[key])
        }
        visit(out.layers)
        for (const l of out.layers as LottieLayer[]) {
          l.ip = Math.round((l.ip - out.ip) * f + out.ip)
          l.op = Math.round((l.op - out.ip) * f + out.ip)
        }
        out.op = newOp
        break
      }
    }
  }
  return out
}


/** 레이어 ks 트랜스폼 프로퍼티 접근 — LottieLayer 타입엔 ks가 인덱스 시그니처라 캐스팅 필요. */
function ksProp(layer: LottieLayer, key: string): AnimatableProp | undefined {
  const ks = (layer as Record<string, unknown>).ks as Record<string, unknown> | undefined
  return ks?.[key] as AnimatableProp | undefined
}

/** 레이어 shapes 트리의 모든 셰이프 노드 방문. */
function eachShapeNode(data: LottieJson, fn: (node: Record<string, unknown>) => void) {
  const visit = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const it of items) {
      if (it === null || typeof it !== 'object') continue
      const node = it as Record<string, unknown>
      fn(node)
      if (node.ty === 'gr') visit(node.it)
    }
  }
  for (const l of data.layers as LottieLayer[]) visit(l.shapes)
}

/** 정적/키프레임 수치 프로퍼티의 지정 인덱스에 배율 적용. 스칼라 k도 처리. */
function scaleProp(prop: AnimatableProp | undefined, f: number, idx: number[]) {
  if (!prop) return
  if (prop.a === 1 && Array.isArray(prop.k)) {
    for (const kf of prop.k as Keyframe[]) {
      if (!Array.isArray(kf.s)) continue
      for (const i of idx) if (typeof kf.s[i] === 'number') kf.s[i] *= f
    }
  } else if (Array.isArray(prop.k)) {
    const k = prop.k as number[]
    for (const i of idx) if (typeof k[i] === 'number') k[i] *= f
  } else if (typeof prop.k === 'number') {
    prop.k *= f
  }
}

/** 위치를 캔버스 중심 기준으로 줌 변환. 정적/키프레임 모두, 스페이셜 탄젠트(ti/to)도 배율. */
function zoomPosition(prop: AnimatableProp | undefined, f: number, cx: number, cy: number) {
  if (!prop) return
  const map = (arr: number[]) => {
    arr[0] = cx + (arr[0] - cx) * f
    arr[1] = cy + (arr[1] - cy) * f
  }
  if (prop.a === 1 && Array.isArray(prop.k)) {
    for (const kf of prop.k as Keyframe[]) {
      if (Array.isArray(kf.s)) map(kf.s)
      for (const key of ['ti', 'to'] as const) {
        const t = kf[key]
        if (Array.isArray(t)) {
          t[0] = (t[0] as number) * f
          t[1] = (t[1] as number) * f
        }
      }
    }
  } else if (Array.isArray(prop.k)) {
    map(prop.k as number[])
  }
}

/**
 * 키프레임 진폭 조절: 첫 키프레임 값을 기준점으로 각 키프레임의 편차를 배율만큼 늘리거나 줄인다.
 * 첫 값 == 마지막 값인 순환 애니메이션은 배율 적용 후에도 순환이 유지된다.
 */
function ampProp(prop: AnimatableProp | undefined, m: number) {
  if (!prop || prop.a !== 1 || !Array.isArray(prop.k)) return
  const kfs = prop.k as Keyframe[]
  const first = kfs[0]?.s
  if (!Array.isArray(first)) return
  const base = [...first]
  for (const kf of kfs) {
    if (!Array.isArray(kf.s)) continue
    for (let i = 0; i < Math.min(base.length, kf.s.length); i++) {
      kf.s[i] = base[i] + (kf.s[i] - base[i]) * m
    }
  }
}
