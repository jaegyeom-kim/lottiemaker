// 스마트 가이드 — 드래그 시 다른 레이어 엣지/중앙 흡착 + 가이드라인 표시.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('SNAP-GUIDES')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
const drawRect = async (x0, y0, x1, y1) => {
  await page.locator('.drawbar button[title*="사각형"]').click()
  await page.mouse.move(...tc(x0, y0))
  await page.mouse.down()
  await page.mouse.move(...tc(x1, y1), { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(900)
}

// A: 좌엣지 x=100 · B: 좌엣지 x=300 (중앙 340)
await drawRect(100, 100, 200, 180)
await drawRect(300, 300, 380, 360)
await page.waitForTimeout(600)
let d = await sessionSource(page)
ok(d.layers.length === 2, '레이어 2개')

// B(레이어 0 = 최신) 드래그 — 좌엣지가 A 좌엣지(x=100) 근처로 → 흡착 기대 (B 중앙 = 140)
await page.mouse.move(...tc(340, 330))
await page.mouse.down()
await page.mouse.move(...tc(144, 330), { steps: 10 })
// 드래그 중 세로 가이드라인 표시
const gv = await page.locator('.snapguide--v').count()
await page.mouse.up()
await page.waitForTimeout(1300)
ok(gv === 1, '드래그 중 세로 스냅 가이드 표시')
d = await sessionSource(page)
const bx = d.layers[0].xbase[0]
ok(Math.abs(bx - 140) < 0.6, `좌엣지 흡착 → 중앙 x=140 (${bx.toFixed(1)})`)

// 중앙-중앙 흡착 — B를 A 중앙(x=150) 근처로
await page.mouse.move(...tc(140, 330))
await page.mouse.down()
await page.mouse.move(...tc(153, 330), { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await sessionSource(page)
ok(Math.abs(d.layers[0].xbase[0] - 150) < 0.6, `중앙 흡착 x=150 (${d.layers[0].xbase[0].toFixed(1)})`)

// ⌘ 홀드 = 스냅 해제 — 같은 위치라도 흡착 없이 그대로
await page.mouse.move(...tc(150, 330))
await page.mouse.down()
await page.keyboard.down('Meta')
await page.mouse.move(...tc(146, 330), { steps: 6 })
await page.keyboard.up('Meta')
await page.mouse.up()
await page.waitForTimeout(1300)
d = await sessionSource(page)
ok(Math.abs(d.layers[0].xbase[0] - 146) < 1.5, `⌘ = 스냅 해제 (${d.layers[0].xbase[0].toFixed(1)})`)

await done(browser)
