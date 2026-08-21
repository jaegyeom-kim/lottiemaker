// 스크러비 넘버 — 라벨 드래그로 값 조절 + 빈 캔버스 온보딩 힌트.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('SCRUBBY')

// 온보딩 힌트 — 빈 캔버스에 표시
ok((await page.locator('.canvashint').count()) === 1, '빈 캔버스 힌트 표시')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...tc(100, 100))
await page.mouse.down()
await page.mouse.move(...tc(220, 200), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)
ok((await page.locator('.canvashint').count()) === 0, '레이어 생기면 힌트 사라짐')

// X 라벨 스크럽 — +40px 드래그 = +40
const d0 = await sessionSource(page)
const x0 = d0.layers[0].xbase[0]
const xLabel = page.locator('.posinput', { hasText: /^X/ }).first().locator('.posinput__label')
const lb = await xLabel.boundingBox()
await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
await page.mouse.down()
await page.mouse.move(lb.x + lb.width / 2 + 40, lb.y + lb.height / 2, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(1300)
let d = await sessionSource(page)
ok(Math.abs(d.layers[0].xbase[0] - (x0 + 40)) < 1.5, `스크럽 +40px → x ${x0}→${d.layers[0].xbase[0]}`)

// 클릭만(무이동) = 값 불변
await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 2)
await page.waitForTimeout(600)
d = await sessionSource(page)
ok(Math.abs(d.layers[0].xbase[0] - (x0 + 40)) < 1.5, '라벨 클릭만 → 값 불변')

// ⇧ 스크럽 = ×10
const lb2 = await xLabel.boundingBox()
await page.mouse.move(lb2.x + lb2.width / 2, lb2.y + lb2.height / 2)
await page.mouse.down()
await page.keyboard.down('Shift')
await page.mouse.move(lb2.x + lb2.width / 2 + 10, lb2.y + lb2.height / 2, { steps: 5 })
await page.keyboard.up('Shift')
await page.mouse.up()
await page.waitForTimeout(1300)
d = await sessionSource(page)
ok(d.layers[0].xbase[0] > x0 + 100, `⇧ 스크럽 ×10 (${d.layers[0].xbase[0]})`)

await done(browser)
