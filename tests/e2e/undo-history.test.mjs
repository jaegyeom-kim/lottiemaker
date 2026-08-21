// 언두/리두 종합 — 생성(빈 캔버스 포함)·이동·리사이즈·도형·선·칠·가이드·복제 전 구간 왕복.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('UNDO-HISTORY')
const src = () => sessionSource(page)
const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}
const undo = async () => { await page.keyboard.press('Meta+z'); await page.waitForTimeout(1100) }
const redo = async () => { await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(1100) }
const st = async () => {
  const d = await src()
  // 빈 상태 정규화 — 저장 전(null)과 0레이어 문서를 동일 취급
  if (!d || d.layers.length === 0) return { n: 0 }
  const l = d.layers[0] ?? {}
  const strokes = JSON.stringify(l.shapes ?? '').match(/"ty":"st"/g)?.length ?? 0
  const painter = JSON.stringify(l.shapes ?? '').includes('"ty":"gf"') ? 'gf' : 'fl'
  return {
    n: d.layers.length,
    x: l.xbase?.[0], y: l.xbase?.[1],
    size: l.xsel?.size,
    w: l.xshape?.w, r: l.xshape?.r,
    strokes, painter,
    gv: d.xguides?.v?.length ?? 0,
  }
}

const states = []
const record = async (label) => { states.push({ label, s: await st() }) }

// 0) 빈 캔버스
await record('빈')
// 1) rect
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(100, 100))); await page.mouse.down()
await page.mouse.move(...(await tc(220, 200)), { steps: 4 }); await page.mouse.up()
await page.waitForTimeout(1100); await record('rect')
// 2) 이동
await page.mouse.move(...(await tc(160, 150))); await page.mouse.down()
await page.mouse.move(...(await tc(300, 260)), { steps: 6 }); await page.mouse.up()
await page.waitForTimeout(1100); await record('move')
// 3) 리사이즈 (se 핸들)
{
  const hb = await page.locator('.selhandle--se').boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down()
  await page.mouse.move(hb.x + 50, hb.y + 50, { steps: 5 }); await page.mouse.up()
  await page.waitForTimeout(1100); await record('resize')
}
// 4) 도형 W
{
  const wIn = page.locator('.knob', { hasText: /도형/ }).locator('.posinput', { hasText: /^W/ }).locator('input')
  await wIn.fill('200'); await wIn.press('Enter'); await page.waitForTimeout(1100); await record('shapeW')
}
// 5) 라운드
{
  const rIn = page.locator('.knob', { hasText: /도형/ }).locator('.posinput', { hasText: /라운드/ }).locator('input')
  await rIn.fill('16'); await rIn.press('Enter'); await page.waitForTimeout(1100); await record('round')
}
// 6) 선 추가
await page.locator('.knob', { hasText: /^선/ }).first().locator('.linkbtn', { hasText: '선 추가' }).click()
await page.waitForTimeout(1100); await record('stroke')
// 7) 그라디언트
await page.locator('.knob', { hasText: /^칠/ }).locator('select').selectOption('linear')
await page.waitForTimeout(1100); await record('gradient')
// 8) 가이드
{
  const lr = await page.locator('.ruler--left').boundingBox()
  const [gx] = await tc(250, 0)
  await page.mouse.move(lr.x + lr.width / 2, lr.y + 150); await page.mouse.down()
  await page.mouse.move(gx, lr.y + 160, { steps: 5 }); await page.mouse.up()
  await page.waitForTimeout(1100); await record('guide')
}
// 9) 복제 (⌘D)
await page.keyboard.press('Meta+d'); await page.waitForTimeout(1100); await record('dup')

// ── 역순 언두 — 각 단계가 이전 record와 일치해야 ──
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
for (let i = states.length - 1; i >= 1; i--) {
  await undo()
  const cur = await st()
  ok(eq(cur, states[i - 1].s), `undo → ${states[i - 1].label} (${states[i].label}에서) ${eq(cur, states[i-1].s) ? '' : JSON.stringify({expect: states[i-1].s, got: cur})}`)
}
// ── 리두 전진 ──
for (let i = 1; i < states.length; i++) {
  await redo()
  const cur = await st()
  ok(eq(cur, states[i].s), `redo → ${states[i].label} ${eq(cur, states[i].s) ? '' : JSON.stringify({expect: states[i].s, got: cur})}`)
}
await done(browser)
