// AI 키 저장 시 즉시 검증 — oat 토큰 거부 / 401 안내 / 정상 키 저장.
import { launchApp, checker } from './_helpers.mjs'

const { browser, page } = await launchApp({
  beforeGoto: async (page) => {
    await page.route('https://api.anthropic.com/v1/models**', async (route) => {
      const key = route.request().headers()['x-api-key']
      if (key === 'sk-ant-api-good') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }] }),
        })
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'invalid x-api-key' } }),
        })
      }
    })
  },
})
const { ok, done } = checker('AI-KEY')

const keyInput = page.locator('.aipanel input[type=password]')
ok((await keyInput.count()) === 1, '키 입력 패널 표시')
const panelText = () => page.locator('.aipanel').textContent()

await keyInput.fill('sk-ant-oat01-xxxx')
await page.locator('.aipanel button', { hasText: '저장' }).click()
await page.waitForTimeout(300)
ok(/앱 로그인 토큰/.test(await panelText()), 'oat 토큰 → 형식 안내')

await keyInput.fill('sk-ant-api-bad')
await page.locator('.aipanel button', { hasText: '저장' }).click()
await page.waitForTimeout(500)
ok(/유효하지 않습니다/.test(await panelText()), '무효 키 → 401 안내')
ok((await keyInput.count()) === 1, '무효 키는 저장 안 됨')

await keyInput.fill('sk-ant-api-good')
await page.locator('.aipanel button', { hasText: '저장' }).click()
await page.waitForTimeout(500)
ok((await page.locator('.aipanel textarea').count()) === 1, '정상 키 → 프롬프트 패널 전환')
ok(
  (await page.evaluate(() => localStorage.getItem('lottiemaker.anthropic.key'))) === 'sk-ant-api-good',
  '키 저장됨',
)
await done(browser)
