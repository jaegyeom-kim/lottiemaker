// 도형 properties — xshape 메타 태깅 + W/H/라운드 지오메트리 리빌드 (제자리 유지).
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('SHAPE-PROPS')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
const src = () => sessionSource(page)
const shOf = (d, li = 0) => {
  const find = (items) => {
    for (const it of items ?? []) {
      if (it.ty === 'sh') return it.ks.k
      if (it.ty === 'gr') { const r = find(it.it); if (r) return r }
    }
    return null
  }
  return find(d.layers[li].shapes)
}

// ── 사각형 드로잉 → xshape 태깅 + 도형 섹션 표시 ──
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...tc(100, 100))
await page.mouse.down()
await page.mouse.move(...tc(260, 220), { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(1300)
let d = await src()
ok(d.layers[0].xshape?.tool === 'rect', `xshape 태깅 (${JSON.stringify(d.layers[0].xshape)})`)
ok(Math.abs(d.layers[0].xshape.w - 160) < 3 && Math.abs(d.layers[0].xshape.h - 120) < 3,
  `메타 크기 = 그린 크기 (${d.layers[0].xshape.w}x${d.layers[0].xshape.h})`)
const shapeKnob = page.locator('.knob', { hasText: /도형/ }).first()
ok((await shapeKnob.count()) === 1, 'properties에 도형 섹션')

// ── 라운드 코너 — 직각 4점 → 라운드 8점 + 곡선 핸들 ──
const k0 = shOf(await src())
ok(k0.v.length === 4 && k0.o.every((p) => !p[0] && !p[1]), `초기 직각 (${k0.v.length}점)`)
const rInput = shapeKnob.locator('.posinput', { hasText: /라운드/ }).locator('input')
await rInput.fill('20')
await rInput.press('Enter')
await page.waitForTimeout(1300)
const k1 = shOf(await src())
ok(k1.v.length === 8, `라운드 → 8점 (${k1.v.length})`)
ok(k1.o.some((p) => Math.abs(p[0]) > 5 || Math.abs(p[1]) > 5), '라운드 → 곡선 핸들 생성')

// ── W 변경 — 중심 유지 + 폭만 확장 ──
const c0 = (() => {
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity
  for (const [x, y] of k1.v) { mnX = Math.min(mnX, x); mxX = Math.max(mxX, x); mnY = Math.min(mnY, y); mxY = Math.max(mxY, y) }
  return { cx: (mnX + mxX) / 2, cy: (mnY + mxY) / 2, w: mxX - mnX, h: mxY - mnY }
})()
const wInput = shapeKnob.locator('.posinput', { hasText: /^W/ }).locator('input')
await wInput.fill('240')
await wInput.press('Enter')
await page.waitForTimeout(1300)
d = await src()
const k2 = shOf(d)
const c1 = (() => {
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity
  for (const [x, y] of k2.v) { mnX = Math.min(mnX, x); mxX = Math.max(mxX, x); mnY = Math.min(mnY, y); mxY = Math.max(mxY, y) }
  return { cx: (mnX + mxX) / 2, cy: (mnY + mxY) / 2, w: mxX - mnX, h: mxY - mnY }
})()
ok(Math.abs(c1.w - 240) < 1 && Math.abs(c1.h - c0.h) < 1, `W 240 적용 (${c1.w.toFixed(0)}x${c1.h.toFixed(0)})`)
ok(Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy) < 1, `중심 유지 (Δ${Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy).toFixed(2)})`)
ok(d.layers[0].xshape.w === 240 && d.layers[0].xshape.r === 20, '메타 동기 (w/r)')

// ── 언두 1회 = W 변경만 롤백 ──
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
const k3 = shOf(await src())
ok(k3.v.length === 8 && Math.abs(Math.max(...k3.v.map((p) => p[0])) - Math.min(...k3.v.map((p) => p[0])) - c0.w) < 1,
  '⌘Z → W 변경만 롤백 (라운드 유지)')

// ── 원형 — xshape 태깅 + W/H 리빌드 ──
await page.locator('.drawbar button[title*="원"]').first().click()
await page.mouse.move(...tc(320, 320))
await page.mouse.down()
await page.mouse.move(...tc(420, 400), { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
ok(d.layers[0].xshape?.tool === 'ellipse', '원형 xshape 태깅')
const eKnob = page.locator('.knob', { hasText: /도형/ }).first()
ok((await eKnob.locator('.posinput', { hasText: /라운드/ }).count()) === 0, '원형엔 라운드 없음')

await done(browser)
