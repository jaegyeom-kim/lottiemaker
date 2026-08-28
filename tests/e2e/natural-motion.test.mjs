// 자연 모션 도구 — 스프링 정착 베이크(선택 키), 언두 왕복.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('NATURAL-MOTION')
const src = () => sessionSource(page)

const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}

// 사각형 + 키프레임 모드 + 위치 키 2개 (0f: 128,256 → 60f: 384,256)
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(88, 216)))
await page.mouse.down()
await page.mouse.move(...(await tc(168, 296)), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)
await page.locator('.opttab', { hasText: /^키프레임$/ }).click()
await page.waitForTimeout(400)
await page.keyboard.press('p')
await page.waitForTimeout(200)
const pRow = page.locator('.timeline__label--prop', { hasText: /위치/ })
await pRow.locator('.timeline__propkey').click()
await page.waitForTimeout(800)
const op = (await src()).op
const ruler = await page.locator('.timeline__ruler').boundingBox()
await page.mouse.click(ruler.x + (60 / op) * ruler.width, ruler.y + ruler.height / 2)
await page.waitForTimeout(250)
await page.mouse.move(...(await tc(128, 256)))
await page.mouse.down()
await page.mouse.move(...(await tc(384, 256)), { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
let d = await src()
let pKeys = d.layers[0].xkf.keys.filter((k) => k.p !== undefined)
ok(pKeys.length === 2, `위치 키 2개 (${pKeys.map((k) => k.t).join(',')})`)
const destX = pKeys[1].p[0]

// 스프링 칩 — 선택 없으면 비활성
const springChip = page.locator('.knob__chips button.chip', { hasText: /^보통$/ })
ok(await springChip.isDisabled(), '선택 없음 → 스프링 칩 비활성')

// 도착 키(마지막 p키) 선택 → 스프링 '보통' 베이크
await page.locator('.timeline__kf--prop').last().click()
await page.waitForTimeout(300)
ok((await page.locator('.timeline__kf--sel').count()) === 1, '도착 키 선택')
ok(!(await springChip.isDisabled()), '키 선택 → 스프링 칩 활성')
await springChip.click()
await page.waitForTimeout(1300)
d = await src()
pKeys = d.layers[0].xkf.keys.filter((k) => k.p !== undefined)
ok(pKeys.length >= 4, `스프링 베이크 — 극값 키 삽입 (${pKeys.length}키)`)
const xs = pKeys.map((k) => k.p[0])
ok(xs.some((x) => x > destX + 1), `오버슛 (${xs.map((x) => x.toFixed(0)).join('→')})`)
ok(Math.abs(xs[xs.length - 1] - destX) < 0.5, '최종값 목표 정착')
ok(!!pKeys[0].e?.p, '진입 구간 이징 부여')

// 언두 → 원래 2키
await page.keyboard.press('Meta+z')
await page.waitForTimeout(800)
d = await src()
pKeys = d.layers[0].xkf.keys.filter((k) => k.p !== undefined)
ok(pKeys.length === 2, `언두 → 2키 복귀 (${pKeys.length})`)

// 리두 → 베이크 복원
await page.keyboard.press('Meta+Shift+z')
await page.waitForTimeout(800)
d = await src()
pKeys = d.layers[0].xkf.keys.filter((k) => k.p !== undefined)
ok(pKeys.length >= 4, `리두 → 베이크 복원 (${pKeys.length}키)`)

await done(browser)
