// 플랜 채점 — 입력은 플랜이 아니라 applyAiMotion을 통과한 뒤의 sourceData다.
// 엔진이 플랜을 조용히 바꾸는 지점(자동 아크, 스프링 베이크, 클립, 이징 폴백)이
// 전부 적용 이후에 있어서, 플랜 JSON만 보면 통과하는데 화면은 틀린 경우를 놓친다.

const CH = ['p', 's', 'r', 'o', 'ts', 'te']
const LINEAR = (b) => !b || (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 1)

/** 레이어의 xkf(정규화 전 원본) — 키 배열과 플래그. */
const kfOf = (layer) => {
  const x = layer?.xkf
  return { on: !!x?.on, keys: Array.isArray(x?.keys) ? x.keys : [], smooth: !!x?.smooth, ease: x?.ease ?? 1 }
}

/**
 * @returns {{ pass: boolean, checks: {name: string, ok: boolean, detail: string}[] }}
 */
export function score(src, expect) {
  const checks = []
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail })
  const animated = src.layers
    .map((l, i) => ({ i, kf: kfOf(l) }))
    .filter((x) => x.kf.on && x.kf.keys.length)

  if (expect.layers) {
    const got = animated.map((a) => a.i)
    add(
      'layers',
      expect.layers.length === got.length && expect.layers.every((i) => got.includes(i)),
      `expected [${expect.layers}] got [${got}]`,
    )
  }

  const targets = animated.filter((a) => !expect.layers || expect.layers.includes(a.i))
  const chOf = (a) => new Set(CH.filter((c) => a.kf.keys.some((k) => k[c] !== undefined)))

  if (expect.channels)
    for (const a of targets) {
      const have = chOf(a)
      add(
        `channels@${a.i}`,
        expect.channels.every((c) => have.has(c)),
        `expected ⊇[${expect.channels}] got [${[...have]}]`,
      )
    }

  if (expect.forbidChannels)
    for (const a of targets) {
      const have = chOf(a)
      const bad = expect.forbidChannels.filter((c) => have.has(c))
      add(`forbidChannels@${a.i}`, !bad.length, bad.length ? `found [${bad}]` : '')
    }

  if (expect.minKeys)
    for (const a of targets)
      add(`minKeys@${a.i}`, a.kf.keys.length >= expect.minKeys, `${a.kf.keys.length} < ${expect.minKeys}`)

  // 컴포지션 밖 키는 렌더되지 않는다
  for (const a of targets) {
    const out = a.kf.keys.filter((k) => k.t < 0 || k.t > src.op)
    add(`inComp@${a.i}`, !out.length, out.length ? `${out.length} key(s) outside [0,${src.op}]` : '')
  }

  if (expect.keysWithinClip)
    for (const a of targets) {
      const clip = src.layers[a.i]?.xsel?.clip
      if (!clip) {
        add(`keysWithinClip@${a.i}`, true, 'no clip')
        continue
      }
      const out = a.kf.keys.filter((k) => k.t < clip[0] || k.t > clip[1])
      add(`keysWithinClip@${a.i}`, !out.length, out.length ? `${out.length} key(s) outside [${clip}]` : '')
    }

  if (expect.endsSettled)
    for (const a of targets) {
      // 마지막 키가 컴포지션 끝을 넘지 않고, 그 뒤로 움직임이 없다
      const last = a.kf.keys[a.kf.keys.length - 1]
      add(`endsSettled@${a.i}`, last.t <= src.op, `last key at ${last.t}, op ${src.op}`)
    }

  if (expect.constantVelocity) {
    const ch = expect.constantVelocity
    for (const a of targets) {
      const keys = a.kf.keys.filter((k) => k[ch] !== undefined)
      // xkf.ease 0 = 선형 폴백. e가 있으면 [0,0,1,1]이어야 등속.
      const easedOk = a.kf.ease === 0 && keys.slice(0, -1).every((k) => LINEAR(k.e?.[ch]))
      add(`constantVelocity:${ch}@${a.i}`, easedOk, `ease=${a.kf.ease}`)
    }
  }

  if (expect.loopClosure) {
    const ch = expect.loopClosure
    for (const a of targets) {
      const keys = a.kf.keys.filter((k) => k[ch] !== undefined)
      const first = keys[0]?.[ch]
      const last = keys[keys.length - 1]?.[ch]
      const same =
        ch === 'r'
          ? Math.abs(((last - first) % 360) - 0) < 0.5 && Math.abs(last - first) >= 1
          : JSON.stringify(first) === JSON.stringify(last)
      add(`loopClosure:${ch}@${a.i}`, same, `${JSON.stringify(first)} → ${JSON.stringify(last)}`)
    }
  }

  if (expect.smooth !== undefined)
    for (const a of targets) add(`smooth@${a.i}`, a.kf.smooth === expect.smooth, `smooth=${a.kf.smooth}`)

  if (expect.stagger) {
    const starts = targets.map((a) => a.kf.keys[0].t)
    add('stagger', new Set(starts).size === starts.length, `starts [${starts}]`)
  }

  return { pass: checks.every((c) => c.ok), checks }
}
