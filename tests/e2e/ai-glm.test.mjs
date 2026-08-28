// AI 모션 GLM(Z.ai) — 키 저장 화면, OpenAI SSE 스트림 목, coding→paas 엔드포인트 폴백.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const plan = {
  layers: [
    {
      index: 0,
      keys: [
        { t: 0, p: [128, 256], o: 0, e: { p: [0.22, 1, 0.36, 1] } },
        { t: 30, p: [256, 256], o: 100 },
      ],
    },
    ],
  note: '왼쪽에서 페이드 인',
}
// 마크다운 펜스 포함 콘텐츠 — 펜스 제거 경로 검증. delta 조각으로 쪼개서 SSE 누적 검증.
const toSse = (obj, fence) => {
  const content = fence ? '```json\n' + JSON.stringify(obj) + '\n```' : JSON.stringify(obj)
  const chunks = []
  for (let i = 0; i < content.length; i += 40) chunks.push(content.slice(i, i + 40))
  return (
    chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') +
    'data: [DONE]\n\n'
  )
}
const sse = toSse(plan, true)
// 스프링 플랜 — 도착 키 spring:true → 엔진이 오버슛 정착 키 베이크
const springPlan = {
  layers: [
    { index: 0, keys: [{ t: 0, p: [100, 256] }, { t: 30, p: [300, 256], spring: true }] },
  ],
  note: '스프링 도착',
}
const sse2 = toSse(springPlan, false)

let codingCalls = 0
let paasCalls = 0
const { browser, page } = await launchApp({
  fixture: null,
  beforeGoto: async (pg) => {
    // coding 엔드포인트 = 401 → paas로 자동 폴백 유도
    await pg.route('https://api.z.ai/api/coding/paas/v4/chat/completions', (route) => {
      codingCalls++
      route.fulfill({ status: 401, json: { error: { message: 'unauthorized' } } })
    })
    await pg.route('https://api.z.ai/api/paas/v4/chat/completions', (route) => {
      paasCalls++
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: paasCalls >= 2 ? sse2 : sse,
      })
    })
  },
})
const { ok, done } = checker('AI-GLM')

const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(200, 200)))
await page.mouse.down()
await page.mouse.move(...(await tc(320, 320)), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)

// GLM 전환 → 키 화면
const aiPanel = page.locator('.aipanel')
await aiPanel.locator('select.aipanel__provider').selectOption('glm')
await page.waitForTimeout(300)
ok((await aiPanel.locator('input[type="password"]').count()) === 1, 'GLM = 키 입력 화면')
await aiPanel.locator('input[type="password"]').fill('zai-test-key-123')
await aiPanel.locator('button', { hasText: '저장' }).click()
await page.waitForTimeout(300)
ok((await aiPanel.locator('.aipanel__prompt').count()) === 1, '키 저장 → 프롬프트 화면')
const savedKey = await page.evaluate(() => localStorage.getItem('lottiemaker.glm.key'))
ok(savedKey === 'zai-test-key-123', '키 localStorage 저장')

// 모델 입력 기본값
const modelIn = aiPanel.locator('.aipanel__glmmodel')
ok((await modelIn.inputValue()) === 'glm-5.3-flash', `모델 기본값 (${await modelIn.inputValue()})`)

// 실행 — coding 401 → paas 폴백 → SSE 누적 + 펜스 제거 → 적용
await aiPanel.locator('.aipanel__prompt').fill('왼쪽에서 페이드 인')
await aiPanel.locator('button', { hasText: '모션 생성' }).click()
await page.waitForTimeout(2500)
ok(codingCalls === 1 && paasCalls === 1, `coding 401 → paas 폴백 (coding=${codingCalls}, paas=${paasCalls})`)
const savedBase = await page.evaluate(() => localStorage.getItem('lottiemaker.glm.base'))
ok(savedBase === 'https://api.z.ai/api/paas/v4', '성공 엔드포인트 기억')
const d = await sessionSource(page)
const keys = d.layers[0].xkf?.keys ?? []
ok(d.layers[0].xkf?.on === true && keys.length === 2, `플랜 적용 (${keys.length}키)`)
ok(keys[0].o === 0 && keys[1].o === 100, '키 내용 일치')

// 재실행 — 기억된 base 우선 (coding 재시도 없음) + spring 베이크
await aiPanel.locator('.aipanel__prompt').fill('스프링으로 도착')
await aiPanel.locator('button', { hasText: '모션 생성' }).click()
await page.waitForTimeout(2500)
ok(codingCalls === 1 && paasCalls === 2, `기억된 base 우선 (coding=${codingCalls}, paas=${paasCalls})`)
{
  const d2 = await sessionSource(page)
  const ks = d2.layers[0].xkf?.keys ?? []
  ok(ks.length >= 4, `spring 베이크 — 극값 키 삽입 (${ks.length}키)`)
  const over = ks.some((k) => Array.isArray(k.p) && k.p[0] > 300.5)
  const under = ks.some((k) => Array.isArray(k.p) && k.p[0] > 250 && k.p[0] < 299.5)
  const last = ks[ks.length - 1]
  ok(over && under, `오버슛→언더슛 정착 (${ks.map((k) => k.p?.[0]?.toFixed(0)).join('→')})`)
  ok(last.p?.[0] === 300, '최종값 목표 정착')
}

// ── OpenRouter 키(sk-or-…) 자동 인식 — 엔드포인트 전환 + 모델 슬러그 프리픽스 ──
let orBody = null
await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
  orBody = route.request().postDataJSON()
  route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse })
})
await page.evaluate(() => {
  localStorage.setItem('lottiemaker.glm.key', 'sk-or-v1-test-abc')
  localStorage.removeItem('lottiemaker.glm.base')
})
await page.reload()
await page.waitForTimeout(1500)
ok((await aiPanel.locator('.aipanel__prompt').count()) === 1, '리로드 후 GLM 프로바이더 유지')
await aiPanel.locator('.aipanel__prompt').fill('오픈라우터로')
await aiPanel.locator('button', { hasText: '모션 생성' }).click()
await page.waitForTimeout(2000)
ok(orBody !== null && codingCalls === 1, 'sk-or 키 → OpenRouter 엔드포인트')
ok(orBody?.model === 'z-ai/glm-5.3-flash', `모델 슬러그 자동 프리픽스 (${orBody?.model})`)
const orBase = await page.evaluate(() => localStorage.getItem('lottiemaker.glm.base'))
ok(orBase === null, 'OpenRouter는 base 기억 안 함')

await done(browser)
