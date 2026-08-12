// 캔버스 밖(페이스트보드) 레이어 클릭 선택 — 픽 서피스 확장 회귀.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('OFFCANVAS')

// 레이어 0 선택 → X를 620으로 (캔버스 밖·패널 안 겹치는 페이스트보드)
const row0 = (await page.$$('.timeline__label--row'))[0]
const rb = await row0.boundingBox()
await page.mouse.click(rb.x + 14, rb.y + rb.height / 2)
await page.waitForTimeout(200)
const xInput = page.locator('.posrow input').first()
await xInput.fill('620')
await xInput.press('Enter')
await page.waitForTimeout(1300)
const d = await sessionSource(page)
ok(Math.abs(d.layers[0].xbase[0] - 620) < 1, `레이어 캔버스 밖으로 (x=${d.layers[0].xbase[0]})`)

// 왼쪽 빈 페이스트보드 클릭으로 확실히 해제 → 밖에 나간 레이어 클릭
const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
await page.keyboard.press('Meta+Shift+a') // 확실한 해제
await page.waitForTimeout(300)
ok((await page.locator('.timeline__label--on').count()) === 0, '⇧⌘A → 해제')
const y0 = d.layers[0].xbase[1]
await page.mouse.click(...tc(620, y0))
await page.waitForTimeout(300)
const selRows = await page.locator('.timeline__label--on').count()
ok(selRows >= 1, `캔버스 밖 레이어 클릭 → 선택 (${selRows})`)
const head = await page.locator('.panel__group .grouphead').first().textContent()
ok((head ?? '').includes(String(d.layers[0].nm)), `주 선택 = ${d.layers[0].nm} (${head})`)
// 휠(가운데) 클릭은 레이어 픽/드래그가 아니라 팬 — 캔버스 위 레이어에서 검증
const before = await sessionSource(page)
const xb1 = [...before.layers[1].xbase] // 캔버스 안 레이어
const panOf = () => page.$eval('.preview__lottiewrap', (e) => e.style.transform)
const t0 = await panOf()
await page.mouse.move(...tc(xb1[0], xb1[1]))
await page.mouse.down({ button: 'middle' })
await page.mouse.move(...tc(xb1[0] + 50, xb1[1] + 25), { steps: 4 })
await page.mouse.up({ button: 'middle' })
await page.waitForTimeout(1300)
const after = await sessionSource(page)
ok(
  Math.abs(after.layers[1].xbase[0] - xb1[0]) < 0.5 && Math.abs(after.layers[1].xbase[1] - xb1[1]) < 0.5,
  `휠클릭 드래그 → 레이어 안 움직임 (${after.layers[1].xbase})`,
)
ok((await panOf()) !== t0 && (await panOf()) !== '', `휠클릭 드래그 → 팬 동작 (${await panOf()})`)
ok((await page.locator('.timeline__label--on').count()) <= 1, '휠클릭 → 선택 변경 없음')
await done(browser)
