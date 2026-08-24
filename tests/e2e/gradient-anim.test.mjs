// 그라디언트 키프레임(gk) — 토글, 편집 = 재생헤드 자동 키, 모핑 렌더, 타임라인 ◆.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('GRADIENT-ANIM')
const src = () => sessionSource(page)

const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(120, 120)))
await page.mouse.down()
await page.mouse.move(...(await tc(360, 300)), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)

const fillKnob = page.locator('.knob', { hasText: /^칠/ })
await fillKnob.locator('select').selectOption('linear')
await page.waitForTimeout(1000)

const gkKeysOf = (d) => (d.layers[0].xkf?.keys ?? []).filter((k) => k.gk !== undefined)
const gfOf = (d) => {
  const find = (items) => {
    for (const it of items ?? []) {
      if (it.ty === 'gf') return it
      if (it.ty === 'gr') { const r = find(it.it); if (r) return r }
    }
    return null
  }
  return find(d.layers[0].shapes[0].it)
}

// 켜기 → 첫 키
await fillKnob.locator('.linkbtn', { hasText: '애니메이션 켜기' }).click()
await page.waitForTimeout(1300)
let d = await src()
ok(gkKeysOf(d).length === 1, `켜기 → gk 키 1개 (t=${gkKeysOf(d)[0]?.t})`)
// 패널 스톱 %가 NaN이면 파싱 회귀 — 보간 스냅샷으로 표시돼야
{
  const pctVals = await fillKnob
    .locator('.posinput', { hasText: /^%/ })
    .locator('input')
    .evaluateAll((els) => els.map((e) => e.value))
  ok(pctVals.length >= 2 && pctVals.every((v) => v !== 'NaN' && v.trim() !== ''), `패널 % 값 정상 (${pctVals.join(',')})`)
}
ok(gfOf(d).g.k.a !== 1, '키 1개 = 정적 유지')

// 60f 스크럽 → 스톱 색 변경 = 자동 키
const op = (await src()).op
const ruler = await page.locator('.timeline__ruler').boundingBox()
await page.mouse.click(ruler.x + (60 / op) * ruler.width, ruler.y + ruler.height / 2)
await page.waitForTimeout(300)
await fillKnob.locator('.cswatch').first().click()
await page.waitForTimeout(200)
await page.locator('.cpicker__hex').fill('FF2200')
await page.locator('.cpicker__hex').press('Enter')
await page.keyboard.press('Escape')
await page.waitForTimeout(1300)
d = await src()
const keys2 = gkKeysOf(d)
ok(keys2.length === 2, `스톱 색 변경 → gk 키 2개 (${keys2.map((k) => k.t).join(',')})`)
ok(Math.abs(keys2[1].t - 60) < 3, `둘째 키 = 재생헤드 (t=${keys2[1].t})`)
const gf = gfOf(d)
ok(gf.g.k.a === 1 && gf.g.k.k.length === 2, `g 모핑 (a=${gf.g.k.a}, ${gf.g.k.k?.length}키)`)
ok(gf.s.a === 1 && gf.e.a === 1, 's/e 끝점도 애니메이션')
ok(gf.g.k.k[0].s[1] !== gf.g.k.k[1].s[1], '두 키 색 상이')

// 끝점 드래그도 자동 키 (같은 프레임 = 같은 키 갱신)
const knob = await (await page.$$('.gradline__knob'))[1].boundingBox()
await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
await page.mouse.down()
await page.mouse.move(knob.x + knob.width / 2 + 50, knob.y + knob.height / 2, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
ok(gkKeysOf(d).length === 2, '끝점 드래그 → 키 수 유지 (같은 프레임 갱신)')
ok(Math.abs(gkKeysOf(d)[1].gk.e[0] - gkKeysOf(d)[0].gk.e[0]) > 30, '둘째 키 끝점 이동 반영')

// 타임라인 그라디언트 행 + ◆
await page.keyboard.press('u')
await page.waitForTimeout(300)
const gkRow = page.locator('.timeline__label--prop', { hasText: /그라디언트/ })
ok((await gkRow.count()) === 1, '타임라인 그라디언트 행')
await page.mouse.click(ruler.x + (85 / op) * ruler.width, ruler.y + ruler.height / 2)
await page.waitForTimeout(250)
await gkRow.locator('.timeline__propkey').click()
await page.waitForTimeout(1300)
d = await src()
ok(gkKeysOf(d).length === 3, `◆ → 스냅샷 키 3개 (${gkKeysOf(d).map((k) => k.t).join(',')})`)

// 끄기 = 현재 프레임 형태 고정
await page.mouse.click(ruler.x + (60 / op) * ruler.width, ruler.y + ruler.height / 2)
await page.waitForTimeout(250)
await fillKnob.locator('.linkbtn', { hasText: '애니메이션 끄기' }).click()
await page.waitForTimeout(1300)
d = await src()
ok(gkKeysOf(d).length === 0, '끄기 → gk 채널 제거')
const gfOff = gfOf(d)
ok(gfOff.g.k.a !== 1, '끄기 → 정적 그라디언트')
ok(gfOff.g.k.k[1] > 0.9, `고정 형태 = 60f 빨강 (r=${gfOff.g.k.k[1].toFixed(2)})`)

// 언두 → 복원
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
d = await src()
ok(gkKeysOf(d).length === 3 && gfOf(d).g.k.a === 1, '⌘Z → 그라디언트 애니메이션 복원')

await done(browser)
