// 최근 색 스와치 — hex 커밋 시 기록, 클릭 = 활성 그룹 적용, 세션 간 유지.
import { launchApp, checker } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('SWATCHES')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]

// 사각형 2개 (색 그룹 1개 — 같은 DRAW_FILL)
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...tc(80, 80))
await page.mouse.down()
await page.mouse.move(...tc(180, 160), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)

// hex 입력으로 색 변경 → 최근 색 기록
const hexIn = page.locator('.colors__hexinput').first()
await hexIn.fill('ff4d00')
await hexIn.press('Enter')
await page.waitForTimeout(1300)
ok((await page.locator('.swatches__chip').count()) >= 1, '최근 색 스와치 생성')
// 다른 색으로 또 변경 → 스와치 2개, 최신이 앞
await hexIn.fill('00c46a')
await hexIn.press('Enter')
await page.waitForTimeout(1300)
const chips = await page.$$eval('.swatches__chip', (els) => els.map((e) => e.title.slice(0, 7)))
ok(chips.length === 2 && chips[0] === '#00c46a', `스와치 2개, 최신 앞 (${chips.join(',')})`)

// 스와치 클릭 = 활성 그룹에 적용 (첫 색으로 되돌리기)
const back = page.locator('.swatches__chip').nth(1) // #ff4d00
await back.click()
await page.waitForTimeout(1300)
const hexNow = await page.locator('.colors__hexinput').first().inputValue()
ok(hexNow === '#ff4d00', `스와치 클릭 → 적용 (${hexNow})`)

// 새로고침 후에도 최근 색 유지 (localStorage)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
ok((await page.locator('.swatches__chip').count()) >= 2, '새로고침 후 최근 색 유지')

await done(browser)
