// 드래그 이동 오버레이 — 재구축 없는 라이브 미리보기 회귀 (구조 수정).
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('DRAG-PERF')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
// 레이어 선택
const row0 = (await page.$$('.timeline__label--row'))[0]
const rb = await row0.boundingBox()
await page.mouse.click(rb.x + 14, rb.y + rb.height / 2)
await page.waitForTimeout(300)
const d0 = await sessionSource(page)
const base0 = [...d0.layers[0].xbase]

// 재구축 계수기
await page.evaluate(() => {
  window.__rebuilds = 0
  new MutationObserver((muts) => {
    for (const m of muts)
      if ([...m.addedNodes].some((n) => n.nodeName === 'svg')) window.__rebuilds++
  }).observe(document.querySelector('.preview__lottiewrap'), { childList: true, subtree: true })
})

// 1.5초 드래그 → (+80,+40) 지점에서 릴리즈
await page.mouse.move(...tc(base0[0], base0[1]))
await page.mouse.down()
const t0 = Date.now()
let i = 0
while (Date.now() - t0 < 1200) {
  await page.mouse.move(...tc(base0[0] + 60 * Math.sin(i / 5), base0[1] + 40 * Math.cos(i / 5)), { steps: 1 })
  i++
}
await page.mouse.move(...tc(base0[0] + 80, base0[1] + 40), { steps: 2 })
await page.mouse.up()
await page.waitForTimeout(1300)

const rebuilds = await page.evaluate(() => window.__rebuilds)
ok(rebuilds <= 4, `드래그 중 재구축 억제 (${rebuilds}회 — 기존 ~28회)`)

const d1 = await sessionSource(page)
const b1 = d1.layers[0].xbase
ok(
  Math.abs(b1[0] - (base0[0] + 80)) < 12 && Math.abs(b1[1] - (base0[1] + 40)) < 12,
  `릴리즈 위치 정확 (${b1.map((v) => v.toFixed(0))} ≈ ${base0[0] + 80},${base0[1] + 40})`,
)
// 렌더도 데이터와 일치 (오버레이 잔재 없이 재구축이 대체했는지)
const visOk = await page.evaluate(() => {
  const wrapEl = document.querySelector('.preview__lottiewrap')
  const svg = wrapEl.querySelector('svg')
  // 오버레이 translate 잔재 여부 — 어떤 g도 이중 translate 프리픽스 없어야
  const stray = [...svg.querySelectorAll(':scope > g > g')].filter((g) =>
    /^translate\([^)]*\)\s*translate/.test(g.getAttribute('transform') ?? ''),
  )
  return { stray: stray.length }
})
ok(visOk.stray === 0, '오버레이 잔재 없음')

// 언두 1스텝 → 원위치
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
const d2 = await sessionSource(page)
ok(Math.abs(d2.layers[0].xbase[0] - base0[0]) < 0.5, `⌘Z 1회 → 원위치 (${d2.layers[0].xbase[0]})`)

// Escape 취소 — store 무변경 + 시각 복원
await page.mouse.move(...tc(base0[0], base0[1]))
await page.mouse.down()
await page.mouse.move(...tc(base0[0] + 100, base0[1]), { steps: 4 })
await page.keyboard.press('Escape')
await page.mouse.up()
await page.waitForTimeout(1300)
const d3 = await sessionSource(page)
ok(Math.abs(d3.layers[0].xbase[0] - base0[0]) < 0.5, 'Esc 취소 → store 무변경')
await done(browser)
