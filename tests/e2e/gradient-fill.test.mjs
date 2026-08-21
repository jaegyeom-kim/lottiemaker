// 칠 — 단색 ↔ 그라디언트(선형/방사) 전환, 색·각도, 렌더 반영.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('GRADIENT')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...tc(120, 120))
await page.mouse.down()
await page.mouse.move(...tc(360, 300), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)
const src = () => sessionSource(page)
const painterOf = (d) => {
  let found = null
  const walk = (items) => {
    for (const it of items ?? []) {
      if ((it.ty === 'fl' || it.ty === 'gf') && !found) found = it
      else if (it.ty === 'gr') walk(it.it)
    }
  }
  walk(d.layers[0].shapes[0].it)
  return found
}

const fillKnob = page.locator('.knob', { hasText: /^칠/ })
ok((await fillKnob.count()) === 1, '칠 섹션 표시')
ok((await fillKnob.locator('select').inputValue()) === 'solid', '초기 = 단색')

// 선형 그라디언트 전환
await fillKnob.locator('select').selectOption('linear')
await page.waitForTimeout(1300)
let d = await src()
let pt = painterOf(d)
ok(pt.ty === 'gf' && pt.t === 1, `gf 선형 (${pt.ty}, t=${pt.t})`)
ok(Array.isArray(pt.g.k.k) && pt.g.k.k.length === 8, '2스톱 그라디언트')
ok(pt.e.k[0] > pt.s.k[0], `끝점 방향 (0° → s.x ${pt.s.k[0].toFixed(0)} < e.x ${pt.e.k[0].toFixed(0)})`)
// 렌더 반영 — linearGradient DOM 존재
ok((await page.locator('.preview__lottiewrap linearGradient').count()) >= 1, '렌더에 linearGradient')

// 각도 90° — 세로 방향
const angleIn = fillKnob.locator('.posinput', { hasText: /각도/ }).locator('input')
await angleIn.fill('90')
await angleIn.press('Enter')
await page.waitForTimeout(1300)
d = await src()
pt = painterOf(d)
ok(Math.abs(pt.e.k[0] - pt.s.k[0]) < 1 && pt.e.k[1] > pt.s.k[1], '90° → 세로 끝점')

// 끝 색 변경
const toPicker = fillKnob.locator('input[type=color]').nth(1)
await toPicker.evaluate((el) => {
  // React 컨트롤드 인풋 — 네이티브 세터 + input 이벤트로 onChange 트리거
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, '#ff2200')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(1300)
d = await src()
pt = painterOf(d)
ok(Math.abs(pt.g.k.k[5] - 1) < 0.02 && pt.g.k.k[6] < 0.2, `끝 색 반영 (r=${pt.g.k.k[5].toFixed(2)})`)

// 방사 전환
await fillKnob.locator('select').selectOption('radial')
await page.waitForTimeout(1300)
d = await src()
pt = painterOf(d)
ok(pt.ty === 'gf' && pt.t === 2, '방사 그라디언트 (t=2)')
ok((await page.locator('.preview__lottiewrap radialGradient').count()) >= 1, '렌더에 radialGradient')

// 단색 복귀
await fillKnob.locator('select').selectOption('solid')
await page.waitForTimeout(1300)
d = await src()
pt = painterOf(d)
ok(pt.ty === 'fl', '단색 복귀 (fl)')

// 언두 체인 — 방사로 롤백
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
d = await src()
ok(painterOf(d).ty === 'gf', '⌘Z → 그라디언트 복원')

await done(browser)
