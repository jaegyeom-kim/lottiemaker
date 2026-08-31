// AI 모션 DeepSeek — 프로바이더 선택·키 저장·기본 모델, 공식 API 호출,
// sk-or-… 키는 OpenRouter 엔드포인트 + deepseek/ 슬러그로 자동 전환.
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
const toSse = (obj) => {
  const content = JSON.stringify(obj)
  const chunks = []
  for (let i = 0; i < content.length; i += 40) chunks.push(content.slice(i, i + 40))
  return (
    chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') +
    'data: [DONE]\n\n'
  )
}
const sse = toSse(plan)

let dsBody = null
const { browser, page } = await launchApp({
  fixture: null,
  beforeGoto: async (pg) => {
    await pg.route('https://api.deepseek.com/chat/completions', (route) => {
      dsBody = route.request().postDataJSON()
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse })
    })
  },
})
const { ok, done } = checker('AI-DEEPSEEK')

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

const aiPanel = page.locator('.aipanel')
await aiPanel.locator('select.aipanel__provider').selectOption('deepseek')
await page.waitForTimeout(300)
ok((await aiPanel.locator('input[type="password"]').count()) === 1, 'DeepSeek = 키 입력 화면')
await aiPanel.locator('input[type="password"]').fill('sk-ds-test-123')
await aiPanel.locator('button', { hasText: '저장' }).click()
await page.waitForTimeout(300)
ok((await aiPanel.locator('.aipanel__prompt').count()) === 1, '키 저장 → 프롬프트 화면')
ok(
  (await page.evaluate(() => localStorage.getItem('lottiemaker.deepseek.key'))) === 'sk-ds-test-123',
  '키 localStorage 저장 (GLM 키와 별도 슬롯)',
)

const modelIn = aiPanel.locator('.aipanel__glmmodel')
ok((await modelIn.inputValue()) === 'deepseek-v4-flash', `모델 기본값 (${await modelIn.inputValue()})`)

// 실행 — 공식 API, 모델 id는 그대로(슬러그 프리픽스 없음)
await aiPanel.locator('.aipanel__prompt').fill('왼쪽에서 페이드 인')
await aiPanel.locator('button', { hasText: '모션 생성' }).click()
await page.waitForTimeout(2500)
ok(dsBody !== null, '공식 엔드포인트(api.deepseek.com) 호출')
ok(dsBody?.model === 'deepseek-v4-flash', `모델 id 그대로 전송 (${dsBody?.model})`)
ok(dsBody?.response_format?.type === 'json_object' && dsBody?.stream === true, 'JSON 모드 + 스트림')
{
  const d = await sessionSource(page)
  const keys = d.layers[0].xkf?.keys ?? []
  ok(d.layers[0].xkf?.on === true && keys.length === 2, `플랜 적용 (${keys.length}키)`)
  ok(keys[0].o === 0 && keys[1].o === 100, '키 내용 일치')
}

// ── sk-or-… 키 → OpenRouter + deepseek/ 슬러그 ──
let orBody = null
await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
  orBody = route.request().postDataJSON()
  route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse })
})
await page.evaluate(() => {
  localStorage.setItem('lottiemaker.deepseek.key', 'sk-or-v1-test-abc')
  localStorage.setItem('lottiemaker.deepseek.model', 'deepseek-v4-flash-0731')
})
await page.reload()
await page.waitForTimeout(1500)
ok((await aiPanel.locator('.aipanel__prompt').count()) === 1, '리로드 후 DeepSeek 프로바이더 유지')
ok(
  (await aiPanel.locator('.aipanel__glmmodel').inputValue()) === 'deepseek-v4-flash-0731',
  '모델 입력값 유지 — 날짜 스냅샷',
)
await aiPanel.locator('.aipanel__prompt').fill('오픈라우터로')
await aiPanel.locator('button', { hasText: '모션 생성' }).click()
await page.waitForTimeout(2000)
ok(orBody !== null, 'sk-or 키 → OpenRouter 엔드포인트')
ok(orBody?.model === 'deepseek/deepseek-v4-flash-0731', `슬러그 자동 프리픽스 (${orBody?.model})`)

await done(browser)
