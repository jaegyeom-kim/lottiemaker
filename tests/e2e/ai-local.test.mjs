// AI 모션 로컬(Ollama) — 프로바이더 전환, /api/chat JSON 모드 목, 적용/재시도.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

let chatCalls = 0
const { browser, page } = await launchApp({
  fixture: null,
  beforeGoto: async (pg) => {
    await pg.route('http://localhost:11434/api/tags', (route) =>
      route.fulfill({ json: { models: [{ name: 'gemma4:26b-mlx' }, { name: 'gemma4:31b-mlx' }] } }),
    )
    await pg.route('http://localhost:11434/api/chat', (route) => {
      chatCalls++
      // 1회차: 스키마 위반(빈 layers) → 재시도 유도, 2회차: 정상 플랜
      const bad = { layers: [] }
      const good = {
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
      route.fulfill({
        json: { message: { content: JSON.stringify(chatCalls === 1 ? bad : good) } },
      })
    })
  },
})
const { ok, done } = checker('AI-LOCAL')

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

// AI 섹션 — 프로바이더 로컬 전환 (키 없이 프롬프트 UI 진입)
const aiPanel = page.locator('.aipanel')
await aiPanel.locator('select.aipanel__provider').selectOption('local')
await page.waitForTimeout(500)
ok((await aiPanel.locator('.aipanel__prompt').count()) === 1, '로컬 = 키 없이 프롬프트 표시')
const modelSel = aiPanel.locator('select').nth(1)
ok((await modelSel.inputValue()) === 'gemma4:26b-mlx', `모델 목록 로드 (${await modelSel.inputValue()})`)

// 실행 — 1회차 스키마 위반 → 자동 재시도 → 적용
await aiPanel.locator('.aipanel__prompt').fill('왼쪽에서 페이드 인')
await aiPanel.locator('button', { hasText: '모션 생성' }).click()
await page.waitForTimeout(2500)
ok(chatCalls === 2, `스키마 위반 자동 재시도 (${chatCalls}회 호출)`)
const d = await sessionSource(page)
const keys = d.layers[0].xkf?.keys ?? []
ok(d.layers[0].xkf?.on === true && keys.length === 2, `플랜 적용 (${keys.length}키)`)
ok(keys[0].o === 0 && keys[1].o === 100, '키 내용 일치')
const msgText = await aiPanel.textContent()
ok(/페이드 인|적용/.test(msgText ?? ''), '성공 메시지')

await done(browser)
