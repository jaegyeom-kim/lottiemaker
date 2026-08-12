// 캔버스 밖(페이스트보드) 레이어 클릭 선택 — 픽 서피스 확장 회귀.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('OFFCANVAS')

// 레이어 0 선택 → X를 700으로 (캔버스 512 밖)
const row0 = (await page.$$('.timeline__label--row'))[0]
const rb = await row0.boundingBox()
await page.mouse.click(rb.x + 14, rb.y + rb.height / 2)
await page.waitForTimeout(200)
const xInput = page.locator('.posrow input').first()
await xInput.fill('700')
await xInput.press('Enter')
await page.waitForTimeout(1300)
const d = await sessionSource(page)
ok(Math.abs(d.layers[0].xbase[0] - 700) < 1, `레이어 캔버스 밖으로 (x=${d.layers[0].xbase[0]})`)

// 선택 해제 후 페이스트보드의 레이어 클릭
await page.keyboard.press('Escape')
await page.mouse.click(200, 900) // 빈 곳 — 해제 확실히
await page.waitForTimeout(200)
const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const y0 = d.layers[0].xbase[1]
await page.mouse.click(wrap.x + (700 / 512) * wrap.w, wrap.y + (y0 / 512) * wrap.w)
await page.waitForTimeout(300)
const selRows = await page.locator('.timeline__label--on').count()
ok(selRows >= 1, `캔버스 밖 레이어 클릭 → 선택 (${selRows})`)
// 주 선택이 레이어 0인지 — 속성 패널 이름으로 확인
const head = await page.locator('.panel__group .grouphead').first().textContent()
ok((head ?? '').includes(String(d.layers[0].nm)), `주 선택 = ${d.layers[0].nm} (${head})`)
await done(browser)
