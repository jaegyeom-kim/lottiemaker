// 내장 템플릿 레지스트리. 노브 ref 값은 각 JSON에서 측정한 원본 치수(px/°).
import spinnerRing from './spinner-ring.json'
import dotsBounce from './dots-bounce.json'
import checkSuccess from './check-success.json'
import crossError from './cross-error.json'
import heartLike from './heart-like.json'
import starFavorite from './star-favorite.json'
import bellShake from './bell-shake.json'
import confettiBurst from './confetti-burst.json'
import arrowSwipe from './arrow-swipe.json'
import progressFill from './progress-fill.json'
import pulseRing from './pulse-ring.json'
import typingDots from './typing-dots.json'
import waveBars from './wave-bars.json'
import coinFlip from './coin-flip.json'
import sparkleTwinkle from './sparkle-twinkle.json'
import confettiRain from './confetti-rain.json'
import confettiCannon from './confetti-cannon.json'
import toggleSwitch from './toggle-switch.json'
import radarSweep from './radar-sweep.json'
import checkboxPop from './checkbox-pop.json'
import pinDrop from './pin-drop.json'
import dotOrbit from './dot-orbit.json'
import heartbeatLine from './heartbeat-line.json'
import starRating from './star-rating.json'
import countUp from './count-up.json'
import type { TemplateKnob } from '../lib/lottieKnobs'

export interface TemplateDef {
  id: string
  label: string
  category: 'loading' | 'feedback' | 'interaction' | 'effect'
  data: unknown
  knobs: TemplateKnob[]
  /** 커스텀 그래픽(SVG) 교체 슬롯들 — match로 시작하는 레이어의 셰이프를 교체. fit = 맞춤 크기 px. */
  swapSlots?: { match: string; label: string; fit: number }[]
}

export const categories = [
  { id: 'loading', label: '로딩' },
  { id: 'feedback', label: '피드백' },
  { id: 'interaction', label: '인터랙션' },
  { id: 'effect', label: '이펙트' },
] as const

const zoom = (label: string, ref: number, min: number, max: number, step = 10): TemplateKnob => ({
  id: 'zoom', label, min, max, step, default: ref, unit: 'px', op: { kind: 'zoom', ref },
})
const stroke = (label: string, ref: number, min = 8, max = 72): TemplateKnob => ({
  id: 'stroke', label, min, max, step: 2, default: ref, unit: 'px', op: { kind: 'stroke', ref },
})
const ampPos = (id: string, label: string, ref: number, min: number, max: number, step = 5): TemplateKnob => ({
  id, label, min, max, step, default: ref, unit: 'px', op: { kind: 'ampPos', ref },
})
const ampRot = (id: string, label: string, ref: number, min: number, max: number, step: number): TemplateKnob => ({
  id, label, min, max, step, default: ref, unit: '°', op: { kind: 'ampRot', ref },
})
const shape = (
  id: string, label: string, ref: number, min: number, max: number, step = 2,
  shapes?: ('el' | 'rc' | 'sr')[], dims?: number[],
): TemplateKnob => ({
  id, label, min, max, step, default: ref, unit: 'px', op: { kind: 'shape', ref, shapes, dims },
})
const spreadX = (label: string, ref: number, min: number, max: number): TemplateKnob => ({
  id: 'spread-x', label, min, max, step: 5, default: ref, unit: 'px', op: { kind: 'spreadX', ref },
})
const corner = (ref: number, min: number, max: number): TemplateKnob => ({
  id: 'corner', label: '모서리', min, max, step: 2, default: ref, unit: 'px', op: { kind: 'corner', ref },
})
const vis = (id: string, label: string, match: string): TemplateKnob => ({
  id, label, min: 0, max: 1, step: 1, default: 1, unit: '', toggle: true, op: { kind: 'layerVis', match },
})

export const templates: TemplateDef[] = [
  // ── 로딩 ──────────────────────────────────
  {
    id: 'spinner-ring', label: '스피너 링', category: 'loading', data: spinnerRing,
    knobs: [
      zoom('링 지름', 340, 160, 440),
      stroke('선 두께', 36),
      // 기본 아크 각도 — 꼬리물기 on이면 피크 자동 3배, off면 고정 아크
      { id: 'arc', label: '아크 각도', min: 36, max: 216, step: 6, default: 90, unit: '°', op: { kind: 'arcChase', toggleId: 'chase' } },
      { id: 'chase', label: '꼬리물기 (길어졌다 짧아짐)', min: 0, max: 1, step: 1, default: 1, unit: '', toggle: true, op: { kind: 'none' } },
      vis('track', '배경 링 표시', 'Track Ring'),
    ],
  },
  {
    id: 'dots-bounce', label: '점 세 개 바운스', category: 'loading', data: dotsBounce,
    swapSlots: [{ match: 'Dot', label: '점', fit: 84 }],
    knobs: [
      shape('dot', '점 크기', 84, 40, 120, 4, ['el']),
      spreadX('점 간격', 100, 60, 160),
      ampPos('bounce', '바운스 높이', 56, 16, 120),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  {
    id: 'typing-dots', label: '타이핑 점', category: 'loading', data: typingDots,
    swapSlots: [{ match: 'Dot', label: '점', fit: 56 }],
    knobs: [
      shape('dot', '점 크기', 56, 24, 96, 4, ['el']),
      spreadX('점 간격', 80, 50, 130),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  {
    id: 'wave-bars', label: '웨이브 바', category: 'loading', data: waveBars,
    knobs: [
      shape('width', '바 너비', 36, 16, 64, 2, ['rc'], [0]),
      shape('height', '최대 높이', 170, 80, 260, 5, ['rc'], [1]),
      spreadX('바 간격', 90, 60, 130),
      corner(18, 0, 32),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  {
    id: 'pulse-ring', label: '펄스 링', category: 'loading', data: pulseRing,
    swapSlots: [{ match: 'Center Dot', label: '중앙 도트', fit: 120 }, { match: 'Pulse Ring', label: '확산 링', fit: 120 }],
    knobs: [
      shape('dot', '도트 크기', 120, 60, 200, 4, ['el']),
      stroke('링 두께', 12, 4, 32),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  {
    id: 'dot-orbit', label: '궤도 점', category: 'loading', data: dotOrbit,
    knobs: [
      shape('dot', '점 크기', 40, 16, 64, 2, ['el']),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  {
    id: 'progress-fill', label: '프로그레스 바', category: 'loading', data: progressFill,
    knobs: [
      shape('height', '바 높이', 56, 20, 120, 4, ['rc'], [1]),
      // pos [0]: 채움 바의 p.x(왼쪽 끝 고정 패턴)도 함께 스케일해야 트랙과 시작점이 맞는다
      {
        id: 'length', label: '바 길이', min: 200, max: 460, step: 10, default: 420, unit: 'px',
        op: { kind: 'shape', ref: 420, shapes: ['rc'], dims: [0], pos: [0] },
      },
      corner(28, 0, 60),
      vis('track', '트랙 표시', 'Track'),
    ],
  },
  // ── 피드백 ────────────────────────────────
  {
    id: 'check-success', label: '체크 성공', category: 'feedback', data: checkSuccess,
    knobs: [
      zoom('원 지름', 360, 200, 460),
      stroke('체크 두께', 40, 12, 72),
      vis('circle', '배경 원 표시', 'green circle'),
    ],
  },
  {
    id: 'cross-error', label: '엑스 오류', category: 'feedback', data: crossError,
    knobs: [
      zoom('원 지름', 380, 200, 460),
      stroke('엑스 두께', 40, 12, 72),
      vis('circle', '배경 원 표시', 'red circle'),
    ],
  },
  {
    id: 'checkbox-pop', label: '체크박스 팝', category: 'feedback', data: checkboxPop,
    knobs: [
      zoom('박스 크기', 300, 160, 420),
      stroke('체크 두께', 34, 12, 64),
      corner(64, 0, 150),
    ],
  },
  // ── 인터랙션 ──────────────────────────────
  {
    id: 'heart-like', label: '하트 좋아요', category: 'interaction', data: heartLike,
    swapSlots: [{ match: 'heart', label: '하트', fit: 300 }, { match: 'particle', label: '파티클', fit: 26 }],
    knobs: [
      zoom('전체 크기', 512, 300, 640),
      ampPos('burst', '파티클 퍼짐', 175, 60, 350),
      shape('particle', '파티클 크기', 26, 10, 52, 2, ['el']),
      {
        id: 'vanish', label: '사라지는 방식', min: 0, max: 1, step: 1, default: 0, unit: '',
        options: ['스케일', '오퍼시티'],
        op: { kind: 'vanish' },
      },
      vis('particles', '파티클 표시', 'particle'),
    ],
  },
  {
    id: 'star-favorite', label: '별 즐겨찾기', category: 'interaction', data: starFavorite,
    swapSlots: [{ match: 'star', label: '별', fit: 300 }, { match: 'sparkle', label: '파티클', fit: 24 }],
    knobs: [
      shape('star', '별 크기', 150, 80, 220, 5, ['sr']),
      shape('particle', '파티클 크기', 24, 10, 48, 2, ['el']),
      ampPos('sparkle', '파티클 퍼짐', 85, 30, 170),
      {
        id: 'vanish', label: '사라지는 방식', min: 0, max: 1, step: 1, default: 0, unit: '',
        options: ['스케일', '오퍼시티'],
        op: { kind: 'vanish' },
      },
      vis('particles', '파티클 표시', 'sparkle'),
    ],
  },
  {
    id: 'bell-shake', label: '벨 알림', category: 'interaction', data: bellShake,
    swapSlots: [{ match: 'bell', label: '벨', fit: 280 }, { match: 'badge', label: '배지', fit: 60 }],
    knobs: [
      zoom('전체 크기', 512, 300, 640),
      ampRot('swing', '흔들림 각도', 18, 4, 45, 1),
      vis('badge', '배지 표시', 'badge'),
    ],
  },
  {
    id: 'arrow-swipe', label: '화살표 스와이프', category: 'interaction', data: arrowSwipe,
    knobs: [
      zoom('전체 크기', 512, 300, 640),
      stroke('선 두께', 40, 12, 72),
      ampPos('travel', '이동 거리', 80, 24, 160, 4),
      // 축 기준 연산(이동 거리) 뒤에 회전 — 회전 후 좌표계에서 진폭이 안 틀어진다
      {
        id: 'dir', label: '방향', min: 0, max: 3, step: 1, default: 0, unit: '',
        options: ['위', '오른쪽', '아래', '왼쪽'], op: { kind: 'dirRotate' },
      },
    ],
  },
  {
    id: 'coin-flip', label: '코인 플립', category: 'interaction', data: coinFlip,
    knobs: [
      // 회전 횟수 — 사이드 모프/광택/반짝이/길이까지 재조립하므로 맨 앞
      { id: 'spins', label: '회전 횟수', min: 1, max: 5, step: 1, default: 3, unit: '회', op: { kind: 'coinSpins' } },
      // 크기 = 중심 줌 — 사이드 모프·패런팅된 안쪽 원까지 전부 일관 스케일
      zoom('코인 크기', 512, 300, 640),
      // 사이드 모프의 슬랩 구간 폭 = z축 두께 (원본 42px)
      {
        id: 'depth', label: '두께(z축)', min: 12, max: 80, step: 2, default: 42, unit: 'px',
        op: { kind: 'coinDepth' },
      },
      stroke('기호 두께', 14, 6, 28),
      {
        id: 'symbol', label: '화폐 기호', min: 0, max: 3, step: 1, default: 1, unit: '',
        options: ['없음', '₩', '$', '¥'],
        op: { kind: 'pickLayer', prefix: 'Symbol', items: [null, 'Symbol KRW', 'Symbol USD', 'Symbol JPY'] },
      },
      vis('inner', '안쪽 원 표시', 'Inner'),
      vis('shine', '광택 효과', 'Light'),
      vis('sparkles', '반짝이 표시', 'Sparkle'),
    ],
  },
  {
    id: 'toggle-switch', label: '토글 스위치', category: 'interaction', data: toggleSwitch,
    swapSlots: [{ match: 'Knob', label: '노브', fit: 96 }],
    knobs: [
      shape('knob', '노브 크기', 96, 56, 120, 4, ['el']),
      corner(60, 8, 60),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  {
    id: 'pin-drop', label: '핀 드롭', category: 'interaction', data: pinDrop,
    swapSlots: [{ match: 'Pin', label: '핀', fit: 250 }],
    knobs: [
      // 몸통이 베지어 패스라 부분 스케일 불가 — 전체 줌으로 크기 조절
      zoom('전체 크기', 512, 300, 640),
      vis('shadow', '그림자 표시', 'Shadow'),
    ],
  },
  {
    id: 'star-rating', label: '별점', category: 'interaction', data: starRating,
    swapSlots: [{ match: 'Star', label: '별', fit: 76 }],
    knobs: [
      shape('star', '별 크기', 38, 16, 52, 2, ['sr']),
      spreadX('별 간격', 160, 130, 200),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  {
    id: 'count-up', label: '숫자 카운트', category: 'interaction', data: countUp,
    knobs: [
      // 통합 레이아웃 연산 — 아래 보조 노브(쉼표/화폐/폰트)를 함께 읽는다
      {
        id: 'target', label: '숫자', min: 0, max: 999999999, step: 1, default: 1280, unit: '',
        op: {
          kind: 'countStyle',
          ids: {
            comma: 'comma', currency: 'currency', font: 'font',
            digitSize: 'digitSize', digitWeight: 'digitWeight',
            curSize: 'curSize', curWeight: 'curWeight',
          },
        },
      },
      { id: 'comma', label: '천 단위 쉼표', min: 0, max: 1, step: 1, default: 1, unit: '', toggle: true, op: { kind: 'none' } },
      {
        id: 'currency', label: '화폐 단위', min: 0, max: 4, step: 1, default: 1, unit: '',
        options: ['없음', '원', '₩', '$', '%'], op: { kind: 'none' },
      },
      // ── 폰트 탭 ──
      {
        id: 'font', label: '서체', min: 0, max: 3, step: 1, default: 0, unit: '',
        fontPicker: true, group: 'font', op: { kind: 'none' },
      },
      { id: 'digitSize', label: '숫자 크기', min: 40, max: 130, step: 1, default: 90, unit: 'px', group: 'font', op: { kind: 'none' } },
      {
        id: 'digitWeight', label: '숫자 굵기', min: 0, max: 3, step: 1, default: 0, unit: '',
        options: ['레귤러', '미디엄', '볼드', '블랙'], group: 'font', op: { kind: 'none' },
      },
      { id: 'curSize', label: '화폐 크기', min: 24, max: 120, step: 1, default: 62, unit: 'px', group: 'font', op: { kind: 'none' } },
      {
        id: 'curWeight', label: '화폐 굵기', min: 0, max: 3, step: 1, default: 0, unit: '',
        options: ['레귤러', '미디엄', '볼드', '블랙'], group: 'font', op: { kind: 'none' },
      },
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  // ── 이펙트 ────────────────────────────────
  {
    id: 'confetti-burst', label: '컨페티 버스트', category: 'effect', data: confettiBurst,
    swapSlots: [{ match: 'Piece', label: '조각', fit: 38 }],
    knobs: [
      // 소멸 방식(burstStyle)이 시작 시각을 읽으므로 그보다 앞에 배치
      {
        id: 'stagger', label: '분출 시차', min: 0, max: 1.2, step: 0.1, default: 0.6, unit: 's',
        op: { kind: 'stagger', ref: 0.6 },
      },
      {
        // 위치를 재구성하므로 퍼짐/회전보다 앞에 — 이후 amp가 재구성된 키프레임에 적용된다
        id: 'style', label: '사라지는 방식', min: 0, max: 4, step: 1, default: 0, unit: '',
        options: ['스케일 아웃', '낙하', '페이드', '팝', '흡수'],
        op: { kind: 'burstStyle' },
      },
      ampPos('spread', '퍼짐', 190, 60, 380, 10),
      ampRot('spin', '회전량', 540, 0, 1080, 30),
      shape('piece', '조각 크기', 40, 16, 80, 2), // 혼합 도형(사각/원/별) 전체
    ],
  },
  {
    id: 'confetti-rain', label: '컨페티 레인', category: 'effect', data: confettiRain,
    swapSlots: [{ match: 'Drop', label: '조각', fit: 26 }],
    knobs: [
      // 낙하 경로는 화면 밖 워프와 맞물려 있어 퍼짐/줌 노브는 제외
      shape('piece', '조각 크기', 24, 10, 48, 2),
      // 회전은 한 사이클에 정수 바퀴여야 루프가 이어진다 — 360° 단위만
      ampRot('spin', '회전량', 360, 0, 1080, 360),
    ],
  },
  {
    id: 'confetti-cannon', label: '컨페티 캐논', category: 'effect', data: confettiCannon,
    swapSlots: [{ match: 'Shot', label: '조각', fit: 32 }],
    knobs: [
      ampPos('spread', '발사 거리', 310, 120, 500, 10),
      ampRot('spin', '회전량', 480, 0, 960, 30),
      shape('piece', '조각 크기', 36, 14, 68, 2),
      {
        id: 'vanish', label: '사라지는 방식', min: 0, max: 1, step: 1, default: 0, unit: '',
        options: ['스케일', '오퍼시티'],
        op: { kind: 'vanish' },
      },
    ],
  },
  {
    id: 'sparkle-twinkle', label: '반짝임', category: 'effect', data: sparkleTwinkle,
    swapSlots: [{ match: 'Sparkle', label: '반짝이', fit: 120 }],
    knobs: [
      shape('size', '반짝이 크기', 60, 20, 120, 4, ['sr']),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
  {
    id: 'radar-sweep', label: '레이더', category: 'effect', data: radarSweep,
    knobs: [
      zoom('전체 크기', 512, 300, 640),
      // ref 26 = 스윕 아크 두께 (링들은 비례 스케일)
      stroke('스윕 두께', 26, 10, 48),
    ],
  },
  {
    id: 'heartbeat-line', label: '심박 라인', category: 'effect', data: heartbeatLine,
    knobs: [
      stroke('선 두께', 18, 8, 40),
      zoom('전체 크기', 512, 300, 640),
    ],
  },
]
