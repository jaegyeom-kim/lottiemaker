// AI 모션 평가 러너 — 프롬프트 품질 회귀를 잡는다.
//
//   node tests/eval/run.mjs                 골든 재생 (네트워크·과금 없음, CI용)
//   node tests/eval/run.mjs --live          실제 프로바이더 호출 + 골든 갱신
//   node tests/eval/run.mjs --live fade-in  한 케이스만
//
// 라이브 환경변수:
//   LM_EVAL_PROVIDER  anthropic(기본) | glm | deepseek | gemini | ling | local
//   LM_EVAL_KEY       해당 프로바이더 API 키 (local은 불필요)
//   LM_EVAL_MODEL     모델 id 오버라이드 (선택)
//   LM_EVAL_N         케이스당 반복 횟수 (기본 1) — 표본 흔들림 확인용
//
// 골든은 sanitizePlan을 통과한 플랜이다. 검증 단계 자체의 복구 동작은
// tests/unit/ai-sanitize.test.mjs가 따로 본다.
//
// 주의: summarizeDoc(모델에 보내는 컨텍스트)이나 systemPrompt를 고치면 기존 프로바이더
// 골든은 옛 입력으로 만든 응답이라 전부 무효다 — --live로 다시 캡처할 것.
// 반대로 디코딩 설정(effort·max_tokens·temperature) 변경은 정의상 골든 재생에 나타나지
// 않는다. 그건 --live로만 잰다.
//
// tests/e2e/run.mjs는 tests/e2e만 훑으므로 이 러너는 CI에서 자동 실행되지 않는다.
import { rolldown } from 'rolldown'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { CASES } from './cases.mjs'
import { score } from './score.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const GOLDEN = path.join(HERE, 'golden')

const args = process.argv.slice(2)
const live = args.includes('--live')
const only = args.find((a) => !a.startsWith('--'))
// 라이브가 아니면 손으로 쓴 레퍼런스 플랜을 본다 — 프로바이더 골든은 --live로 캡처된다
const provider = process.env.LM_EVAL_PROVIDER || (live ? 'anthropic' : 'reference')
const reps = Number(process.env.LM_EVAL_N || 1)

// ── 브라우저 전역 스텁 (store/ai 의존 체인) ──
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
globalThis.document = { documentElement: { lang: 'ko' }, createElement: () => ({}) }

const load = async (entry, tag) => {
  const bundle = await rolldown({ input: path.join(ROOT, entry), logLevel: 'silent' })
  const { output } = await bundle.generate({ format: 'esm' })
  const tmp = path.join(os.tmpdir(), `lm-eval-${tag}-${process.pid}.mjs`)
  fs.writeFileSync(tmp, output[0].code)
  try {
    return await import(tmp)
  } finally {
    fs.unlinkSync(tmp)
  }
}

const { useEditor } = await load('src/store.ts', 'store')
const ai = await load('src/lib/ai.ts', 'ai')

const generate = (doc, prompt) => {
  const key = process.env.LM_EVAL_KEY || ''
  const model = process.env.LM_EVAL_MODEL
  const common = { prompt, doc }
  switch (provider) {
    case 'glm':
      return ai.generateMotionGlm({ ...common, apiKey: key, model: model || ai.DEFAULT_GLM_MODEL })
    case 'deepseek':
      return ai.generateMotionDeepseek({ ...common, apiKey: key, model: model || ai.DEFAULT_DEEPSEEK_MODEL })
    case 'gemini':
      return ai.generateMotionGemini({ ...common, apiKey: key, model: model || ai.DEFAULT_GEMINI_MODEL })
    case 'ling':
      return ai.generateMotionLing({ ...common, apiKey: key, model: model || ai.DEFAULT_LING_MODEL })
    case 'local':
      return ai.generateMotionLocal({ ...common, url: ai.DEFAULT_LOCAL_URL, model: model || '' })
    default:
      return ai.generateMotion({ ...common, apiKey: key })
  }
}

const goldenPath = (id) => path.join(GOLDEN, `${id}.${provider}.json`)

let total = 0
let passed = 0
const rows = []

for (const c of CASES) {
  if (only && c.id !== only) continue
  for (let rep = 0; rep < (live ? reps : 1); rep++) {
    total++
    // 케이스마다 깨끗한 문서에서 시작 — 앞 케이스의 키가 남으면 채점이 오염된다
    useEditor.setState({ sourceData: null, animationData: null, past: [], future: [], customIdxs: [] })
    useEditor.getState().importLottieLayers(structuredClone(c.doc))
    useEditor.setState({ customIdxs: c.select ?? [] })

    const st = useEditor.getState()
    const doc = ai.summarizeDoc(st.sourceData, c.select ?? [], 0)

    let plan
    try {
      if (live) {
        plan = await generate(doc, c.prompt)
        fs.mkdirSync(GOLDEN, { recursive: true })
        if (rep === 0) fs.writeFileSync(goldenPath(c.id), JSON.stringify(plan, null, 2))
      } else {
        const f = goldenPath(c.id)
        if (!fs.existsSync(f)) {
          rows.push({ id: c.id, state: 'SKIP', why: `골든 없음 (${path.relative(ROOT, f)}) — --live로 캡처` })
          total--
          break
        }
        plan = JSON.parse(fs.readFileSync(f, 'utf8'))
      }
    } catch (e) {
      rows.push({ id: c.id, state: 'ERR', why: e.message })
      continue
    }

    // 골든이 손으로 쓴 raw 플랜일 수 있다 — 항상 검증 단계를 통과시킨다 (스프링 베이크 포함).
    // 이미 sanitize를 거친 플랜에는 무해하다.
    plan = ai.sanitizePlan(plan, doc.layers.length, doc.op)
    const applied = useEditor.getState().applyAiMotion(plan)
    if (!applied) {
      rows.push({ id: c.id, state: 'FAIL', why: '적용된 레이어 0' })
      continue
    }
    const r = score(useEditor.getState().sourceData, c.expect)
    if (r.pass) passed++
    rows.push({
      id: c.id,
      state: r.pass ? 'PASS' : 'FAIL',
      why: r.checks.filter((x) => !x.ok).map((x) => `${x.name}: ${x.detail}`).join(' · '),
      issues: plan.issues,
    })
  }
}

for (const r of rows) {
  const mark = r.state === 'PASS' ? '✓' : r.state === 'SKIP' ? '·' : '✗'
  console.log(`${mark} ${r.id.padEnd(16)} ${r.state}${r.why ? `  ${r.why}` : ''}`)
  if (r.issues?.length) console.log(`  ↳ ${r.issues.join(' / ')}`)
}
console.log(`\n${provider}${live ? ' (live)' : ' (golden)'} — ${total}본 중 ${passed} 통과`)
process.exit(total && passed === total ? 0 : 1)
