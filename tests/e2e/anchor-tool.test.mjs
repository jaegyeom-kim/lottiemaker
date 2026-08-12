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

// 그래픽 좌상단 지점(분율 0.25, 0.25)을 새 앵커로 드래그
const boxB = await page.$eval('.selbox', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})
await page.mouse.move(boxB.x + boxB.w / 2, boxB.y + boxB.h / 2)
await page.mouse.down()
await page.mouse.move(boxB.x + boxB.w * 0.25, boxB.y + boxB.h * 0.25, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)

const after = await sessionSource(page)
const l1 = after.layers[0]
// 핵심: 위치 값(xbase)은 그대로
ok(
  Math.abs(l1.xbase[0] - base0[0]) < 0.5 && Math.abs(l1.xbase[1] - base0[1]) < 0.5,
  `위치 값 불변 (${l1.xbase.map((v) => v.toFixed(1))})`,
)
const [ax, ay] = l1.xsel.anchor
ok(Math.abs(ax - 0.25) < 0.06 && Math.abs(ay - 0.25) < 0.06, `anchor 분율 = 드래그 지점 (${ax.toFixed(2)}, ${ay.toFixed(2)})`)
// 그래픽은 이동 — 앵커 지점이 고정 위치(base)로 오도록
const boxAfter = await page.$eval('.selbox', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
ok(Math.abs(boxAfter.x - boxBefore.x) > 10, `그래픽 이동 (박스 Δx=${(boxAfter.x - boxBefore.x).toFixed(1)})`)
// 마커는 고정 위치(base)에 그대로
const mk = await page.$eval('.anchorpoint', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const [ex, ey] = tc(base0[0], base0[1])
ok(Math.hypot(mk.x - ex, mk.y - ey) < 4, `마커 = 고정 위치 유지 (Δ${Math.hypot(mk.x - ex, mk.y - ey).toFixed(1)}px)`)
// V 복귀 시 마커는 남고 드래그 모드 해제
await page.keyboard.press('v')
await page.waitForTimeout(200)
ok((await page.locator('.anchorpoint--active').count()) === 0, 'V → 앵커 툴 해제')
ok((await page.locator('.anchorpoint').count()) === 1, '마커는 유지 (정보성)')
// 언두 1회 = 앵커 드래그 전
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
const undone = await sessionSource(page)
ok(
  Math.abs((undone.layers[0].xsel.anchor?.[0] ?? 0.5) - 0.5) < 0.01,
  `⌘Z → 앵커 복원 (${undone.layers[0].xsel.anchor})`,
)
await done(browser)
