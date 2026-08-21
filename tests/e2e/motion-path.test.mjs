// 모션 패스 캔버스 편집 — 키 도트 드래그 = 위치 키 이동, 탄젠트 드래그 = 곡선(수동 pto/pti).
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('MOTION-PATH')
const src = () => sessionSource(page)

// 레이어 추가/패널 변화로 캔버스가 이동하므로 좌표는 매번 재측정
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
// P 채널 공개 + 0f 키
await page.keyboard.press('p')
await page.waitForTimeout(200)
const pRow = page.locator('.timeline__label--prop', { hasText: /위치/ })
await pRow.locator('.timeline__propkey').click()
await page.waitForTimeout(800)
// 60f로 스크럽 → 레이어 드래그 이동 = 두 번째 키
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

// 모션 패스 표시 — 키 2개 + 탄젠트 핸들 (직선 시드 포함)
ok((await page.locator('.motionpath').count()) === 1, '모션 패스 오버레이')
ok((await page.locator('.motionpath__key').count()) === 2, '키 도트 2개')
ok((await page.locator('.motionpath__handle').count()) === 2, '탄젠트 핸들 (시드)')

// 키 도트 드래그 = 위치 키 이동
const k1 = await (await page.$$('.motionpath__key'))[1].boundingBox()
await page.mouse.move(k1.x + k1.width / 2, k1.y + k1.height / 2)
await page.mouse.down()
await page.mouse.move(k1.x + k1.width / 2, k1.y + k1.height / 2 + 80 * ((await page.$eval('.preview__lottiewrap', (e) => e.getBoundingClientRect().width)) / 512), { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
pKeys = d.layers[0].xkf.keys.filter((k) => k.p !== undefined)
ok(Math.abs(pKeys[1].p[1] - 336) < 4, `키 도트 드래그 → p (${pKeys[1].p.map((v) => v.toFixed(0))})`)

// 탄젠트(첫 키 out) 드래그 = 수동 pto + 대칭 미러 없음(첫 키) + 곡선 d
const h0 = await (await page.$$('.motionpath__handle'))[0].boundingBox()
await page.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2)
await page.mouse.down()
await page.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2 - 90 * ((await page.$eval('.preview__lottiewrap', (e) => e.getBoundingClientRect().width)) / 512), { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
pKeys = d.layers[0].xkf.keys.filter((k) => k.p !== undefined)
ok(Array.isArray(pKeys[0].pto) && pKeys[0].pto[1] < -40, `수동 pto 저장 (${JSON.stringify(pKeys[0].pto)})`)
ok(pKeys[0].pti === undefined, '첫 키 → 미러 없음')
// 렌더 ks.p에 to 반영
const ksP = d.layers[0].ks.p
ok(ksP.a === 1 && Array.isArray(ksP.k[0].to) && ksP.k[0].to[1] < -40, 'ks.p 키프레임에 to 반영')

// 중간 프레임 위치가 곡선 위 (직선이면 y=296 근처, 곡선이면 위로 휨)
await page.mouse.click(ruler.x + (30 / op) * ruler.width, ruler.y + ruler.height / 2)
await page.waitForTimeout(400)
const curY = await page.$eval('.motionpath__cur', (e) => Number(e.getAttribute('cy')))
ok(curY < 285, `30f 위치가 곡선 위로 휨 (y=${curY.toFixed(0)})`)

// ⌘Z — 탄젠트 롤백
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
d = await src()
pKeys = d.layers[0].xkf.keys.filter((k) => k.p !== undefined)
ok(pKeys[0].pto === undefined, '⌘Z → 탄젠트 롤백')

await done(browser)
