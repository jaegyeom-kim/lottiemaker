// 선 추가/제거 + 대시 — 닫힌 도형에 스트로크 토글.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('STROKE-OPT')
const src = () => sessionSource(page)
const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}
const strokesOf = (d) => {
  const out = []
  const walk = (items) => {
    for (const it of items ?? []) {
      if (it.ty === 'st') out.push(it)
      else if (it.ty === 'gr') walk(it.it)
    }
  }
  walk(d.layers[0].shapes[0].it)
  return out
}

// 사각형 (선 없음) → '선 추가'
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(120, 120)))
await page.mouse.down()
await page.mouse.move(...(await tc(280, 240)), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)
let d = await src()
ok(strokesOf(d).length === 0, '초기 선 없음')
const strokeKnob = page.locator('.knob', { hasText: /^선/ }).first()
await strokeKnob.locator('.linkbtn', { hasText: '선 추가' }).click()
await page.waitForTimeout(1300)
d = await src()
const st1 = strokesOf(d)
ok(st1.length === 1, '선 추가 → st 1개')
ok(st1[0].w.k === 2 && st1[0].lc === 2, `기본 두께/캡 (${st1[0].w.k}px)`)

// 대시 8 → d 배열
const dashIn = page.locator('.posinput', { hasText: /대시/ }).locator('input')
await dashIn.fill('8')
await dashIn.press('Enter')
await page.waitForTimeout(1300)
d = await src()
const dArr = strokesOf(d)[0].d
ok(Array.isArray(dArr) && dArr[0].v.k === 8, `대시 반영 (${JSON.stringify(dArr?.[0]?.v)})`)

// 대시 0 = 실선 복귀
await dashIn.fill('0')
await dashIn.press('Enter')
await page.waitForTimeout(1300)
d = await src()
ok(strokesOf(d)[0].d === undefined, '대시 0 → 실선')

// 선 제거
await page.locator('.knob', { hasText: /^선/ }).first().locator('.linkbtn', { hasText: '선 제거' }).click()
await page.waitForTimeout(1300)
d = await src()
ok(strokesOf(d).length === 0, '선 제거')
// ⌘Z → 복원
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
d = await src()
ok(strokesOf(d).length === 1, '⌘Z → 선 복원')

await done(browser)
