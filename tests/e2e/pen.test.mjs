// 펜 툴 — 베지어 핸들을 당겨도 고스트 앵커와 실제 렌더가 정합해야 한다.
// (bbox를 핸들 끝점/앵커로 각각 다르게 계산하던 버그의 회귀 테스트)
import { launchApp, checker } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('PEN')
const layersBefore = await page.locator('.timeline__label--row').count()

// 펜 툴 선택
await page.waitForSelector('.drawbar', { timeout: 10000 })
await page.locator('.drawbar button[title*="펜"]').click()
await page.waitForTimeout(200)

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})
const CW = 512
const toClient = (x, y) => [wrap.x + (x / CW) * wrap.w, wrap.y + (y / CW) * wrap.w]

// A 클릭 → B 클릭+드래그(핸들 생성) → C 클릭
const [ax, ay] = toClient(150, 200)
await page.mouse.click(ax, ay)
const [bx, by] = toClient(300, 200)
await page.mouse.move(bx, by)
await page.mouse.down()
await page.mouse.move(...toClient(300, 320), { steps: 6 }) // 핸들 크게 당김
await page.mouse.up()
await page.mouse.click(...toClient(420, 140))
await page.waitForTimeout(400)

ok((await page.locator('.drawghost__anchor').count()) === 3, '앵커 3개')
ok((await page.locator('.drawghost__hdot').count()) >= 2, '핸들 표시')
// 편집 커서 — 앵커/핸들 글리프, ⌥=변환
const curOf = (sel) => page.$eval(sel, (e) => getComputedStyle(e).cursor)
const aCur = await curOf('.drawghost__anchor')
ok(aCur.includes('url(') && aCur.includes('move'), '앵커 커서 글리프(move 폴백)')
ok((await curOf('.drawghost__hdot')).includes('url('), '핸들 커서 글리프(near_me)')
await page.keyboard.down('Alt')
await page.waitForTimeout(120)
ok((await curOf('.drawghost__anchor')) !== aCur, '⌥ → 변환 커서')
await page.keyboard.up('Alt')
await page.waitForTimeout(120)

// 고스트 앵커 vs 실제 렌더된 패스 끝점 정합 측정 (캔버스 좌표)
const align = await page.evaluate(() => {
  const wrapEl = document.querySelector('.preview__lottiewrap')
  const wr = wrapEl.getBoundingClientRect()
  const f = 512 / wr.width
  const toCanvas = (clientX, clientY) => [(clientX - wr.left) * f, (clientY - wr.top) * f]
  // 고스트 첫/마지막 앵커 (svg 좌표 = 캔버스 좌표)
  const anchors = [...document.querySelectorAll('.drawghost__anchor')]
  const ghostFirst = [Number(anchors[0].getAttribute('cx')), Number(anchors[0].getAttribute('cy'))]
  const ghostLast = [
    Number(anchors[anchors.length - 1].getAttribute('cx')),
    Number(anchors[anchors.length - 1].getAttribute('cy')),
  ]
  // 렌더된 펜 패스 — 파랑 스트로크
  const paths = [...wrapEl.querySelectorAll('svg path')]
  const pen = paths.find((p) => {
    const st = p.getAttribute('stroke') ?? ''
    return /51,\s*128,\s*245|3380f5/i.test(st) || /51,\s*128,\s*245/.test(getComputedStyle(p).stroke)
  })
  if (!pen) return { err: 'pen path 못 찾음', n: paths.length }
  const ctm = pen.getScreenCTM()
  const at = (len) => {
    const pt = pen.getPointAtLength(len)
    const sp = new DOMPoint(pt.x, pt.y).matrixTransform(ctm)
    return toCanvas(sp.x, sp.y)
  }
  const start = at(0)
  const end = at(pen.getTotalLength())
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  // 열린 패스 방향은 그대로 — start↔첫 앵커, end↔마지막 앵커 (뒤집힘 대비 min)
  const d1 = Math.min(dist(start, ghostFirst), dist(start, ghostLast))
  const d2 = Math.min(dist(end, ghostLast), dist(end, ghostFirst))
  return { d1, d2 }
})
ok(!align.err && align.d1 < 3 && align.d2 < 3, `고스트-렌더 정합 (d1=${align.d1?.toFixed(2)}, d2=${align.d2?.toFixed(2)})`)

// Backspace = 마지막 앵커 삭제 (레이어 삭제로 새면 안 됨)
await page.keyboard.press('Backspace')
await page.waitForTimeout(200)
ok((await page.locator('.drawghost__anchor').count()) === 2, 'Backspace → 앵커 2개')
const layerRows = await page.locator('.timeline__label--row').count()
ok(layerRows === layersBefore + 1, `그리던 레이어 유지 (${layerRows})`)

// Backspace 소진 — 점 1개 남으면 그리던 라이브 레이어도 정리
await page.keyboard.press('Backspace')
await page.waitForTimeout(300)
ok((await page.locator('.timeline__label--row').count()) === layersBefore, '점 소진 → 라이브 레이어 정리')

// 닫힌 패스 — 3점 후 시작점 클릭
await page.locator('.drawbar button[title*="펜"]').click()
await page.mouse.click(...toClient(150, 350))
await page.mouse.click(...toClient(300, 300))
await page.mouse.click(...toClient(360, 430))
await page.waitForTimeout(200)
await page.mouse.click(...toClient(150, 350)) // 시작점 = 닫기
await page.waitForTimeout(1300)
ok((await page.locator('.drawghost__anchor').count()) === 0, '시작점 클릭 → 닫힘·고스트 정리')
const d = await page.evaluate(() => JSON.parse(localStorage.getItem('lottiemaker.session.custom.v1') ?? 'null')?.sourceData)
ok(d?.layers?.length === layersBefore + 1, `닫힌 패스 레이어 확정 (${d?.layers?.length})`)

// ── 앵커 선택 + ⌥ 포인트 변환 (AE) ──
await page.locator('.drawbar button[title*="펜"]').click()
await page.mouse.click(...toClient(120, 120))
await page.mouse.click(...toClient(250, 80))
await page.mouse.click(...toClient(380, 140))
await page.waitForTimeout(200)
// 가운데 앵커 클릭(무이동) = 선택
const anchorAt = async (i) => (await page.$$('.drawghost__anchor'))[i]
let b = await (await anchorAt(1)).boundingBox()
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
await page.waitForTimeout(150)
ok((await page.locator('.drawghost__anchor--sel').count()) === 1, '앵커 클릭 → 선택')
// ⌥드래그 = 핸들 뽑기 (코너 → 스무스)
b = await (await anchorAt(1)).boundingBox()
await page.keyboard.down('Alt')
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
await page.mouse.down()
await page.mouse.move(...toClient(250, 160), { steps: 5 })
await page.mouse.up()
await page.keyboard.up('Alt')
await page.waitForTimeout(150)
ok((await page.locator('.drawghost__hdot').count()) === 2, `⌥드래그 → 핸들 생성 (${await page.locator('.drawghost__hdot').count()})`)
// ⌥클릭 = 핸들 제거 (스무스 → 코너)
b = await (await anchorAt(1)).boundingBox()
await page.keyboard.down('Alt')
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
await page.keyboard.up('Alt')
await page.waitForTimeout(150)
ok((await page.locator('.drawghost__hdot').count()) === 0, '⌥클릭 → 핸들 제거')
// 선택된 가운데 앵커 Backspace = 그 점 삭제
b = await (await anchorAt(1)).boundingBox()
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
await page.waitForTimeout(120)
await page.keyboard.press('Backspace')
await page.waitForTimeout(200)
const rest = await page.$$eval('.drawghost__anchor', (els) => els.map((e) => Math.round(Number(e.getAttribute('cx')))))
ok(rest.length === 2 && !rest.some((x) => Math.abs(x - 250) < 5), `선택 앵커 삭제 (남은 x=${rest})`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// ── 완성 패스 재편집 (일러 직접 선택) — 펜 툴에서 포인트 표시·드래그·선 옵션 ──
await page.locator('.drawbar button[title*="펜"]').click()
await page.mouse.click(...toClient(140, 240))
await page.mouse.move(...toClient(260, 200))
await page.mouse.down()
await page.mouse.move(...toClient(260, 280), { steps: 4 })
await page.mouse.up()
await page.mouse.click(...toClient(390, 260))
await page.keyboard.press('Enter') // 완성 → 이동 툴
await page.waitForTimeout(1300)
ok((await page.locator('.drawghost__anchor').count()) === 0, '완성 후 고스트 없음')
// 펜 툴 재선택 → 선택 레이어의 포인트 표시 (편집 모드)
await page.locator('.drawbar button[title*="펜"]').click()
await page.waitForTimeout(400)
ok((await page.locator('.drawghost__anchor').count()) === 3, `펜 툴 재진입 → 포인트 표시 (${await page.locator('.drawghost__anchor').count()})`)
// 가운데 앵커 드래그 → 셰이프 데이터 반영
const src = () => page.evaluate(() => JSON.parse(localStorage.getItem('lottiemaker.session.custom.v1') ?? 'null')?.sourceData)
const shOf = (d2) => {
  const g = d2.layers[0].shapes[0]
  const stack = [...(g.it ?? [])]
  while (stack.length) {
    const it = stack.shift()
    if (it.ty === 'sh') return it.ks.k
    if (it.ty === 'gr') stack.unshift(...(it.it ?? []))
  }
  return null
}
let k0 = shOf(await src())
const midBefore = [...k0.v[1]]
let ab = await (await page.$$('.drawghost__anchor'))[1].boundingBox()
await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2)
await page.mouse.down()
await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2 + 50, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(1300)
let k1 = shOf(await src())
ok(Math.abs(k1.v[1][1] - midBefore[1]) > 10, `편집 드래그 → 셰이프 v 반영 (${midBefore[1].toFixed(1)} → ${k1.v[1][1].toFixed(1)})`)
// 편집 후 바운딩 박스가 새 지오메트리를 따라오는지 (중심 오프셋 메타 회귀)
const boxCmp = await page.evaluate(() => {
  const wrapEl = document.querySelector('.preview__lottiewrap')
  const wr = wrapEl.getBoundingClientRect()
  const f = 512 / wr.width
  const box = document.querySelector('.selbox')?.getBoundingClientRect()
  // 고스트 패스 = 지금 편집 중인 그 패스 (CTM 매핑이라 렌더와 동일 기하)
  const pb = document.querySelector('.drawghost__path')?.getBoundingClientRect()
  if (!box || !pb) return null
  return {
    dx: (box.x + box.width / 2 - (pb.x + pb.width / 2)) * f,
    dy: (box.y + box.height / 2 - (pb.y + pb.height / 2)) * f,
  }
})
ok(boxCmp && Math.abs(boxCmp.dx) < 6 && Math.abs(boxCmp.dy) < 6, `편집 후 박스-지오메트리 정합 (Δ${boxCmp?.dx.toFixed(1)},${boxCmp?.dy.toFixed(1)})`)

// ⌥클릭 = 핸들 제거 (스무스 앵커 → 코너)
ab = await (await page.$$('.drawghost__anchor'))[1].boundingBox()
await page.keyboard.down('Alt')
await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2)
await page.keyboard.up('Alt')
await page.waitForTimeout(1300)
k1 = shOf(await src())
ok(k1.o[1][0] === 0 && k1.o[1][1] === 0 && k1.i[1][0] === 0 && k1.i[1][1] === 0, '편집 ⌥클릭 → 핸들 제거')
// 앵커 선택 + Backspace = 그 점 삭제
ab = await (await page.$$('.drawghost__anchor'))[1].boundingBox()
await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2)
await page.waitForTimeout(150)
ok((await page.locator('.drawghost__anchor--sel').count()) === 1, '편집 앵커 선택')
await page.keyboard.press('Backspace')
await page.waitForTimeout(1300)
k1 = shOf(await src())
ok(k1.v.length === 2, `편집 Backspace → 점 삭제 (${k1.v.length})`)
// 선 옵션 — 두께 입력 반영
const strokeKnob = page
  .locator('.knob')
  .filter({ has: page.locator('.knob__name', { hasText: /^선$/ }) })
  .first()
ok((await strokeKnob.count()) === 1, "'선' 섹션 표시")
await strokeKnob.locator('.posinput input').first().fill('20')
await strokeKnob.locator('.posinput input').press('Enter')
await page.waitForTimeout(1300)
const d3 = await src()
const findSt = (items) => {
  for (const it of items ?? []) {
    if (it.ty === 'st') return it
    if (it.ty === 'gr') { const r = findSt(it.it); if (r) return r }
  }
  return null
}
const st0 = findSt(d3.layers[0].shapes[0].it)
ok(st0?.w?.k === 20, `선 두께 반영 (${st0?.w?.k})`)
// 이동 툴로 나가면 오버레이 정리
await page.keyboard.press('v')
await page.waitForTimeout(200)
ok((await page.locator('.drawghost__anchor').count()) === 0, 'V → 편집 오버레이 정리')

// ── 언두: 그리는 중 ⌘Z = 점 취소 / 완성 후 ⌘Z 1회 = 스트로크 통째 ──
const rows = () => page.locator('.timeline__label--row').count()
const rowsBase = await rows()
await page.locator('.drawbar button[title*="펜"]').click()
await page.mouse.click(...toClient(60, 60))
await page.mouse.click(...toClient(160, 90))
await page.mouse.click(...toClient(240, 40))
await page.waitForTimeout(300)
ok((await rows()) === rowsBase + 1, '새 패스 레이어 생성')
// 그리는 중 ⌘Z → 점만 하나 취소 (레이어 유지)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
ok((await page.locator('.drawghost__anchor').count()) === 2, '드로잉 중 ⌘Z → 앵커 2개')
ok((await rows()) === rowsBase + 1, '드로잉 중 ⌘Z → 레이어 유지')
// 한 번 더 → 점 1개, 라이브 레이어 정리
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
ok((await rows()) === rowsBase, '점 소진 → 레이어 정리')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
// 완성 스트로크 = 언두 1회
await page.locator('.drawbar button[title*="펜"]').click()
await page.mouse.click(...toClient(60, 120))
await page.mouse.click(...toClient(150, 150))
await page.mouse.click(...toClient(230, 100))
await page.keyboard.press('Enter')
await page.waitForTimeout(1300)
ok((await rows()) === rowsBase + 1, '스트로크 완성')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(400)
ok((await rows()) === rowsBase, '⌘Z 1회 → 스트로크 통째 언두')
await page.keyboard.press('Meta+Shift+z')
await page.waitForTimeout(400)
ok((await rows()) === rowsBase + 1, '⇧⌘Z → 리두 복원')

// ── 휠(가운데) 버튼 드래그 = 팬 ──
const panOf = () => page.$eval('.preview__lottiewrap', (e) => e.style.transform)
const t0 = await panOf()
const [cx0, cy0] = toClient(256, 256)
await page.mouse.move(cx0, cy0)
await page.mouse.down({ button: 'middle' })
await page.mouse.move(cx0 + 90, cy0 + 40, { steps: 5 })
await page.mouse.up({ button: 'middle' })
await page.waitForTimeout(150)
const t1 = await panOf()
ok(t0 !== t1 && /translate\(9?0?px|translate\([0-9]+px/.test(t1), `휠버튼 팬 (${t1})`)
await done(browser)
