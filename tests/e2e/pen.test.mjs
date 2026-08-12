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
