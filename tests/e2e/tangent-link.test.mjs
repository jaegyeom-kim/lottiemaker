// 그래프 에디터 탄젠트 링크 — 같은 키 반대쪽 핸들 대칭 회전, ⌥ = 브레이크.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('TANGENT-LINK')
const src = () => sessionSource(page)

// 레이어 0 선택 + 채널 공개 + 재생헤드 60f에 회전 키 추가 (0/60/120 3키)
await (await page.$$('.timeline__label--row'))[0].click()
await page.keyboard.press('u')
await page.waitForTimeout(300)
const ruler = await page.locator('.timeline__ruler').boundingBox()
const op = (await src()).op
await page.mouse.click(ruler.x + (60 / op) * ruler.width, ruler.y + ruler.height / 2)
await page.waitForTimeout(250)
const rRow = page.locator('.timeline__label--prop', { hasText: /회전/ })
await rRow.locator('.timeline__propkey').click()
await page.waitForTimeout(1300)
let d = await src()
const rKeys = d.layers[0].xkf.keys.filter((k) => k.r !== undefined)
ok(rKeys.length === 3, `회전 키 3개 (${rKeys.map((k) => k.t).join(',')})`)

// GE 오픈 → 가운데 키 클릭 = in/out 탄젠트 2개
await page.locator('.tlbtn').nth(1).click()
await page.waitForTimeout(400)
const mid = (await page.$$('.gepanel__key'))[1]
const mb = await mid.boundingBox()
await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2)
await page.waitForTimeout(200)
ok((await page.locator('.gepanel__handle').count()) === 2, '가운데 키 → in/out 탄젠트 페어')

const easeOf = (dd) => {
  const ks = dd.layers[0].xkf.keys.filter((k) => k.r !== undefined)
  return { a: ks[0].e?.r ?? null, b: ks[1].e?.r ?? null } // a = 0→60 구간, b = 60→120 구간
}
const before = easeOf(d)

// out 핸들(첫 번째) 드래그 → 링크: 이전 구간(in쪽)도 회전
const h0 = await (await page.$$('.gepanel__handle'))[0].boundingBox()
await page.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2)
await page.mouse.down()
await page.mouse.move(h0.x + 30, h0.y - 60, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
const after = easeOf(d)
ok(JSON.stringify(after.b) !== JSON.stringify(before.b), 'out 드래그 → 자기 구간 이즈 변경')
ok(JSON.stringify(after.a) !== JSON.stringify(before.a), '링크 → 이전 구간(in) 미러 회전')
// 기울기 일치 — in 탄젠트 slope ≈ out 탄젠트 slope
{
  const ks = d.layers[0].xkf.keys.filter((k) => k.r !== undefined)
  const dvA = ks[1].r - ks[0].r
  const dtA = ks[1].t - ks[0].t
  const dvB = ks[2].r - ks[1].r
  const dtB = ks[2].t - ks[1].t
  const eA = after.a
  const eB = after.b
  const slopeIn = (dvA * (eA[3] - 1)) / (dtA * (eA[2] - 1))
  const slopeOut = (dvB * eB[1]) / (dtB * eB[0])
  ok(Math.abs(slopeIn - slopeOut) < 0.05, `기울기 일치 (in ${slopeIn.toFixed(3)} ≈ out ${slopeOut.toFixed(3)})`)
}

// ⌥ 드래그 = 브레이크 — 이쪽만 변경, 반대쪽 유지
const brBefore = easeOf(await src())
const h1 = await (await page.$$('.gepanel__handle'))[0].boundingBox()
await page.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2)
await page.mouse.down()
await page.keyboard.down('Alt')
await page.mouse.move(h1.x - 20, h1.y + 70, { steps: 6 })
await page.keyboard.up('Alt')
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
const brAfter = easeOf(d)
ok(JSON.stringify(brAfter.b) !== JSON.stringify(brBefore.b), '⌥ 드래그 → 자기 구간 변경')
ok(JSON.stringify(brAfter.a) === JSON.stringify(brBefore.a), '⌥ = 브레이크 — 반대쪽 유지')

await done(browser)
