// AI 모션 평가 케이스 — 한국어 프롬프트 + 컴포지션 상태 + 결정적 기대치.
//
// 각 케이스의 doc은 importLottieLayers에 그대로 넣는 최소 로티다. 앱이 그린 레이어처럼
// bboxW/bboxH를 넣어 둔다 (없으면 summarizeDoc이 renderedBox를 생략한다).

const gr = (w, h, at, opts = {}) => ({
  ty: 'gr',
  bboxW: w,
  bboxH: h,
  it: [
    { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [w, h] }, r: { a: 0, k: 0 } },
    ...(opts.stroke
      ? [{ ty: 'st', c: { a: 0, k: [0, 0, 0, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 } }]
      : [{ ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 }]),
    {
      ty: 'tr',
      p: { a: 0, k: at },
      a: { a: 0, k: [0, 0] },
      s: { a: 0, k: [100, 100] },
      r: { a: 0, k: 0 },
      o: { a: 0, k: 100 },
    },
  ],
})

const layer = (ind, nm, w, h, at, opts) => ({
  ty: 4, ind, nm, ks: {}, ip: 0, op: 90, st: 0, sr: 1, shapes: [gr(w, h, at, opts)],
})

const comp = (...layers) => ({
  v: '5.7.0', fr: 30, ip: 0, op: 90, w: 512, h: 512, assets: [], layers,
})

export const CASES = [
  {
    id: 'fade-in',
    prompt: '로고가 서서히 나타나게 해줘',
    doc: comp(layer(1, '로고', 160, 160, [256, 256])),
    select: [0],
    expect: { layers: [0], channels: ['o'], minKeys: 2, endsSettled: true, keysWithinClip: true },
  },
  {
    id: 'pop-in',
    prompt: '박스가 통통 튀며 등장',
    doc: comp(layer(1, '박스', 120, 120, [256, 256])),
    select: [0],
    // spring은 엔진이 극값 키를 베이크한다 — 키가 2개보다 늘어야 실제로 걸린 것
    expect: { layers: [0], channels: ['s'], minKeys: 3, endsSettled: true, keysWithinClip: true },
  },
  {
    id: 'spin-constant',
    prompt: '로딩 스피너처럼 일정한 속도로 한 바퀴 계속 돌게',
    doc: comp(layer(1, '스피너', 100, 100, [256, 256])),
    select: [0],
    expect: {
      layers: [0], channels: ['r'], forbidChannels: ['ts', 'te'], minKeys: 2,
      constantVelocity: 'r', loopClosure: 'r', keysWithinClip: true,
    },
  },
  {
    id: 'l-path',
    prompt: '오른쪽으로 갔다가 아래로 꺾어서 L자로 이동. 모서리는 각지게.',
    doc: comp(layer(1, '점', 60, 60, [120, 120])),
    select: [0],
    // 각진 경로 = 자동 아크가 꺼져야 한다 (path:'linear')
    expect: { layers: [0], channels: ['p'], minKeys: 3, smooth: false, keysWithinClip: true },
  },
  {
    id: 'draw-on',
    prompt: '선이 그려지듯 나타나게',
    doc: comp(layer(1, '선', 200, 8, [256, 256], { stroke: true })),
    select: [0],
    expect: { layers: [0], channels: ['te'], minKeys: 2, endsSettled: true, keysWithinClip: true },
  },
  {
    id: 'stagger',
    prompt: '두 카드가 순서대로 아래에서 올라오게',
    doc: comp(
      layer(1, '카드A', 120, 80, [180, 300]),
      layer(2, '카드B', 120, 80, [330, 300]),
    ),
    select: [],
    expect: { layers: [0, 1], channels: ['p'], minKeys: 2, stagger: true, keysWithinClip: true },
  },
]
