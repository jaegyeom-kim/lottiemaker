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

// ── 스태거 — 두 번째 레이어 추가 후 ⇧선택 → 4f 계단 ──
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(100, 400)))
await page.mouse.down()
await page.mouse.move(...(await tc(180, 470)), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)
// 새 레이어(행 0) 선택 → 키프레임 모드 → 위치 키 2개
{
  const r0 = await (await page.$$('.timeline__label--row'))[0].boundingBox()
  await page.mouse.click(r0.x + 14, r0.y + r0.height / 2)
  await page.waitForTimeout(200)
}
await page.locator('.opttab', { hasText: /^키프레임$/ }).click()
await page.waitForTimeout(300)
// 행 트월 버튼으로 프로퍼티 공개 (키보드 P 대신 — 결정적)
await (await (await page.$$('.timeline__label--row'))[0].$('.timeline__twirl--end')).click()
await page.waitForTimeout(400)
await page.locator('.timeline__label--prop', { hasText: /위치/ }).first().locator('.timeline__propkey').click()
await page.waitForTimeout(800)
{
  const ruler2 = await page.locator('.timeline__ruler').boundingBox()
  await page.mouse.click(ruler2.x + (30 / op) * ruler2.width, ruler2.y + ruler2.height / 2)
  await page.waitForTimeout(250)
  await page.mouse.move(...(await tc(140, 435)))
  await page.mouse.down()
  await page.mouse.move(...(await tc(340, 435)), { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(1300)
}
// 행0 클릭 → ⇧행1 = 두 레이어 선택 → 스태거 버튼
{
  const rows = await page.$$('.timeline__label--row')
  const r0 = await rows[0].boundingBox()
  await page.mouse.click(r0.x + 14, r0.y + r0.height / 2)
  await page.waitForTimeout(200)
  const r1 = await (await page.$$('.timeline__label--row'))[1].boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.click(r1.x + 14, r1.y + r1.height / 2)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(300)
}
const staggerBtn = page.locator('.timeline__selact', { hasText: '스태거' })
ok((await staggerBtn.count()) === 1, '다중 선택 → 스태거 버튼 표시')
const before0 = (await src()).layers.map((l) => (l.xkf?.keys ?? []).map((k) => k.t))
await staggerBtn.click()
await page.waitForTimeout(1300)
d = await src()
const after0 = d.layers.map((l) => (l.xkf?.keys ?? []).map((k) => k.t))
ok(
  after0[0].every((t2, i) => t2 === before0[0][i]),
  `첫 레이어 기준 유지 (${after0[0].join(',')})`,
)
ok(
  after0[1].every((t2, i) => Math.abs(t2 - (before0[1][i] + 4)) < 0.11),
  `둘째 레이어 +4f (${before0[1].join(',')} → ${after0[1].join(',')})`,
)

// ── 팔로우스루 — 행0을 행1의 자식으로 걸고 '팔로우 중' 베이크 ──
{
  const r0 = await (await page.$$('.timeline__label--row'))[0].boundingBox()
  await page.mouse.click(r0.x + 14, r0.y + r0.height / 2)
  await page.waitForTimeout(300)
  const parentKnob = page.locator('.knob', { hasText: /^부모/ })
  const val = await parentKnob.locator('option').nth(1).getAttribute('value')
  await parentKnob.locator('select').selectOption(val)
  await page.waitForTimeout(1300)
  const ftBtn = page.locator('.chip', { hasText: /^팔로우 중$/ })
  ok((await ftBtn.count()) === 1, '부모 걸면 팔로우스루 칩 표시')
  await ftBtn.click()
  await page.waitForTimeout(1300)
  d = await src()
  const ks = (d.layers[0].xkf?.keys ?? []).filter((k) => k.p !== undefined)
  ok(ks.length >= 5, `팔로우스루 베이크 (${ks.length}키)`)
  const xs2 = ks.map((k) => k.p[0])
  const dev = Math.max(...xs2) - Math.min(...xs2)
  ok(dev > 1, `지연 델타 존재 (Δx ${dev.toFixed(1)}px)`)
  ok(ks[0].t === 0, '0프레임 기준 키')
  // 시작(부모 이동 전)과 끝(정착 후) 로컬 위치 동일 — 랙은 이동 중에만
  ok(Math.abs(xs2[0] - xs2[xs2.length - 1]) < 0.5, '시작=끝 정착 (랙은 과도 구간만)')
}

await done(browser)
