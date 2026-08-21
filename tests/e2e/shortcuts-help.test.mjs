// 단축키 치트시트 — ? 토글, Esc 닫기, 입력 필드에선 무시.
import { launchApp, checker } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('SHORTCUTS')

await page.keyboard.press('?')
await page.waitForTimeout(250)
ok((await page.locator('.shortcuts__panel').count()) === 1, '? → 치트시트 오픈')
ok((await page.locator('.shortcuts__sec').count()) >= 5, '섹션 렌더')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
ok((await page.locator('.shortcuts').count()) === 0, 'Esc → 닫기')
await page.keyboard.press('?')
await page.waitForTimeout(200)
await page.keyboard.press('?')
await page.waitForTimeout(200)
ok((await page.locator('.shortcuts').count()) === 0, '? 재입력 = 토글 닫기')
// 입력 필드 안에서는 열리지 않음
await page.locator('.colors__hexinput, input[type=text]').first().click().catch(() => {})
const inp = page.locator('input').first()
if (await inp.count()) {
  await inp.focus()
  await page.keyboard.press('?')
  await page.waitForTimeout(200)
  ok((await page.locator('.shortcuts').count()) === 0, '입력 중엔 무시')
}
await done(browser)
