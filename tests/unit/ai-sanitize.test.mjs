// sanitizePlan 유닛 테스트 — 모델 출력이 조용히 훼손되지 않는지, 훼손했으면 말하는지.
// 실행: node tests/unit/ai-sanitize.test.mjs
import { rolldown } from 'rolldown'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
globalThis.document = { documentElement: { lang: 'ko' }, createElement: () => ({}) }

const bundle = await rolldown({ input: path.join(ROOT, 'src', 'lib', 'ai.ts'), logLevel: 'silent' })
const { output } = await bundle.generate({ format: 'esm' })
const tmp = path.join(os.tmpdir(), `lm-sanitize-${process.pid}.mjs`)
fs.writeFileSync(tmp, output[0].code)
let sanitizePlan
try {
  ;({ sanitizePlan } = await import(tmp))
} finally {
  fs.unlinkSync(tmp)
}

let failed = 0
const ok = (c, m) => {
  if (c) console.log('✓', m)
  else {
    failed++
    console.error('✗', m)
  }
}
const has = (issues, frag) => (issues ?? []).some((s) => s.includes(frag))
const S = (raw, layers = 2, op = 60) => sanitizePlan(raw, layers, op)

// ── 위치 좌표 coercion — {x,y}가 오면 p 채널만 조용히 탈락하던 자리 ──
{
  const p = S({ layers: [{ index: 0, keys: [{ t: 0, p: { x: -200, y: 256 }, o: 0 }, { t: 30, p: [256, 256], o: 100 }] }] })
  const k0 = p.layers[0].keys[0]
  ok(Array.isArray(k0.p) && k0.p[0] === -200 && k0.p[1] === 256, `{x,y} → [x,y] (${JSON.stringify(k0.p)})`)
  ok(has(p.issues, '위치 값'), '보정 사실을 issues로 보고')
}

// ── 컴포지션 길이 초과 — 잘린 걸 말한다 ──
{
  const p = S({ layers: [{ index: 0, keys: [{ t: 0, o: 0 }, { t: 90, o: 100 }, { t: 120, o: 50 }] }] })
  ok(p.layers[0].keys.every((k) => k.t <= 60), '초과 키가 [0,op]로 클램프')
  ok(has(p.issues, '컴포지션 길이'), '초과 사실을 issues로 보고')
}

// ── 없는 레이어 인덱스 ──
{
  const p = S({ layers: [{ index: 7, keys: [{ t: 0, o: 0 }] }, { index: 1, keys: [{ t: 0, o: 0 }, { t: 10, o: 100 }] }] })
  ok(p.layers.length === 1 && p.layers[0].index === 1, '범위 밖 인덱스 폐기')
  ok(has(p.issues, '없는 인덱스'), '폐기 사실을 issues로 보고')
}

// ── 값 없는 키 ──
{
  const p = S({ layers: [{ index: 0, keys: [{ t: 0, o: 0 }, { t: 10 }, { t: 20, o: 100 }] }] })
  ok(p.layers[0].keys.length === 2, `값 없는 키 폐기 (${p.layers[0].keys.length})`)
  ok(has(p.issues, '값이 없는 키'), '폐기 사실을 issues로 보고')
}

// ── spring 유효 범위 — 0.6 초과는 베이크가 키를 0개 만든다 ──
{
  const p = S({ layers: [{ index: 0, keys: [{ t: 0, s: 0 }, { t: 20, s: 100, spring: 0.8 }] }] })
  ok(p.layers[0].keys.length > 2, `0.8도 실제로 베이크됨 (${p.layers[0].keys.length}키)`)
  ok(has(p.issues, '스프링 감쇠'), '낮춘 사실을 issues로 보고')
}
{
  // spring:0 = "끄기" 의도. 하한 클램프로 가장 출렁이는 값이 되면 안 된다.
  const p = S({ layers: [{ index: 0, keys: [{ t: 0, s: 0 }, { t: 20, s: 100, spring: 0 }] }] })
  ok(p.layers[0].keys.length === 2, `spring:0은 베이크 안 함 (${p.layers[0].keys.length}키)`)
}

// ── clip — 뒤집힘 교정 + 키 범위 커버 ──
{
  const p = S({ layers: [{ index: 0, clip: [50, 10], keys: [{ t: 20, o: 0 }, { t: 40, o: 100 }] }] })
  ok(p.layers[0].clip[0] === 10 && p.layers[0].clip[1] === 50, `뒤집힌 clip 정렬 (${p.layers[0].clip})`)
}
{
  const p = S({ layers: [{ index: 0, clip: [0, 30], keys: [{ t: 0, o: 0 }, { t: 45, o: 100 }] }] })
  ok(p.layers[0].clip[1] >= 45, `클립 밖 키 → 구간 확장 (${p.layers[0].clip})`)
  ok(has(p.issues, '표시 구간'), '확장 사실을 issues로 보고')
}

// ── mode / path 통과 ──
{
  const p = S({ layers: [{ index: 0, mode: 'merge', path: 'linear', keys: [{ t: 0, r: 0 }, { t: 20, r: 90 }] }] })
  ok(p.layers[0].mode === 'merge' && p.layers[0].path === 'linear', 'mode·path 보존')
  const q = S({ layers: [{ index: 0, mode: '엉뚱', path: 'wobble', keys: [{ t: 0, r: 0 }] }] })
  ok(q.layers[0].mode === undefined && q.layers[0].path === undefined, '모르는 값은 무시')
}

// ── anchor — 분율 클램프 + 통과 ──
{
  const p = S({ layers: [{ index: 0, anchor: [0.5, 1], keys: [{ t: 0, r: 0 }, { t: 20, r: 90 }] }] })
  ok(JSON.stringify(p.layers[0].anchor) === '[0.5,1]', `anchor 보존 (${JSON.stringify(p.layers[0].anchor)})`)
  const q = S({ layers: [{ index: 0, anchor: { x: -1, y: 4 }, keys: [{ t: 0, r: 0 }] }] })
  ok(JSON.stringify(q.layers[0].anchor) === '[0,1]', `분율 밖 anchor 클램프 (${JSON.stringify(q.layers[0].anchor)})`)
}

// ── 유효 레이어 0 — issues를 담아 throw ──
{
  let msg = ''
  try {
    S({ layers: [{ index: 9, keys: [{ t: 0, o: 0 }] }] })
  } catch (e) {
    msg = e.message
  }
  ok(msg.includes('없는 인덱스'), `throw 메시지에 원인 포함 (${msg.slice(0, 60)}…)`)
}

// ── 키 상한 60 — 베이크 후 시각 순으로 자른다 ──
{
  const keys = Array.from({ length: 80 }, (_, i) => ({ t: i * 0.7, o: i % 2 ? 100 : 0 }))
  const p = S({ layers: [{ index: 0, keys }] })
  ok(p.layers[0].keys.length === 60, `60키로 절단 (${p.layers[0].keys.length})`)
  ok(has(p.issues, '키 상한'), '절단 사실을 issues로 보고')
}

console.log(failed ? `\nAI-SANITIZE FAIL (${failed})` : '\nAI-SANITIZE PASS')
process.exit(failed ? 1 : 0)
