// 앵커 포인트 툴 (Y) — 바운딩박스 ⊕ 마커 + 드래그로 피벗 이동 (그래픽 제자리).
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('ANCHOR-TOOL')

// 레이어 선택 → 마커 표시 (이동 툴에서도)
const row0 = (await page.$$('.timeline__label--row'))[0]
const rb = await row0.boundingBox()
await page.mouse.click(rb.x + 14, rb.y + rb.height / 2)
await page.waitForTimeout(300)
ok((await page.locator('.anchorpoint').count()) === 1, '바운딩박스에 앵커 마커 표시')

// Y → 앵커 툴
await page.keyboard.press('y')
await page.waitForTimeout(200)
ok((await page.locator('.anchorpoint--active').count()) === 1, 'Y → 앵커 툴 활성')
ok((await page.locator('.preview__canvas--anchor').count()) === 1, '캔버스 앵커 모드')

const before = await sessionSource(page)
const l0 = before.layers[0]
const base0 = [...l0.xbase]
const off0 = [0, 0] // centerOffset 비교는 화면 좌표로
const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
// 그래픽(선택 박스) 화면 위치 기록
const boxBefore = await page.$eval('.selbox', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})

// 앵커를 좌상 방향으로 드래그 (base → base-100,-60)
await page.mouse.move(...tc(base0[0], base0[1]))
await page.mouse.down()
await page.mouse.move(...tc(base0[0] - 100, base0[1] - 60), { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)

const after = await sessionSource(page)
const l1 = after.layers[0]
ok(
  Math.abs(l1.xbase[0] - (base0[0] - 100)) < 3 && Math.abs(l1.xbase[1] - (base0[1] - 60)) < 3,
  `앵커 월드가 커서 위치로 (${l1.xbase.map((v) => v.toFixed(1))})`,
)
const [ax, ay] = l1.xsel.anchor
ok(ax < 0.5 && ay < 0.5, `anchor 분율 감소 (${ax.toFixed(2)}, ${ay.toFixed(2)})`)
// 그래픽은 제자리 — 선택 박스 화면 위치 불변
const boxAfter = await page.$eval('.selbox', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
ok(
  Math.abs(boxAfter.x - boxBefore.x) < 2 && Math.abs(boxAfter.y - boxBefore.y) < 2,
  `그래픽 제자리 (박스 Δ=${(boxAfter.x - boxBefore.x).toFixed(1)},${(boxAfter.y - boxBefore.y).toFixed(1)})`,
)
// 마커가 새 앵커 위치로 이동
const mk = await page.$eval('.anchorpoint', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const [ex, ey] = tc(l1.xbase[0], l1.xbase[1])
ok(Math.hypot(mk.x - ex, mk.y - ey) < 4, `마커 = 앵커 위치 (Δ${Math.hypot(mk.x - ex, mk.y - ey).toFixed(1)}px)`)
// V 복귀 시 마커는 남고 드래그 모드 해제
await page.keyboard.press('v')
await page.waitForTimeout(200)
ok((await page.locator('.anchorpoint--active').count()) === 0, 'V → 앵커 툴 해제')
ok((await page.locator('.anchorpoint').count()) === 1, '마커는 유지 (정보성)')
// 언두 1회 = 앵커 드래그 전
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
const undone = await sessionSource(page)
ok(Math.abs(undone.layers[0].xbase[0] - base0[0]) < 0.5, '⌘Z → 앵커 복원')
await done(browser)
