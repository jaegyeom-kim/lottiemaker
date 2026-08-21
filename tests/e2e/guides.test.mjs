// 고정 가이드 — 룰러 드래그 생성, 스냅 대상, 이동, 룰러 밖 드롭 삭제.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('GUIDES')
const src = () => sessionSource(page)
const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}

ok((await page.locator('.ruler--top').count()) === 1, '상단 눈금자')
ok((await page.locator('.ruler--left').count()) === 1, '좌측 눈금자')

// 좌측 룰러 → 세로 가이드 (x=200)
const lr = await page.locator('.ruler--left').boundingBox()
const [gx] = await tc(200, 0)
await page.mouse.move(lr.x + lr.width / 2, lr.y + 200)
await page.mouse.down()
await page.mouse.move(gx, lr.y + 220, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
let d = await src()
ok(d.xguides?.v?.length === 1 && Math.abs(d.xguides.v[0] - 200) < 2, `세로 가이드 생성 (${JSON.stringify(d.xguides?.v)})`)
ok((await page.locator('.fixedguide--v').count()) === 1, '가이드 라인 렌더')

// 상단 룰러 → 가로 가이드 (y=300)
const tr = await page.locator('.ruler--top').boundingBox()
const [, gy] = await tc(0, 300)
await page.mouse.move(tr.x + 300, tr.y + tr.height / 2)
await page.mouse.down()
await page.mouse.move(tr.x + 300, gy, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
ok(d.xguides?.h?.length === 1 && Math.abs(d.xguides.h[0] - 300) < 2, `가로 가이드 생성 (${JSON.stringify(d.xguides?.h)})`)

// 스냅 — 사각형을 세로 가이드(x=200) 근처로 드래그 → 중앙 흡착
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(60, 60)))
await page.mouse.down()
await page.mouse.move(...(await tc(140, 140)), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)
await page.mouse.move(...(await tc(100, 100)))
await page.mouse.down()
await page.mouse.move(...(await tc(196, 100)), { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
ok(Math.abs(d.layers[0].xbase[0] - 200) < 0.6, `가이드에 흡착 (${d.layers[0].xbase[0].toFixed(1)})`)

// 가이드 이동 — 세로 가이드를 x=250으로
const gv = await page.locator('.fixedguide--v').boundingBox()
const [gx2] = await tc(250, 0)
await page.mouse.move(gv.x + gv.width / 2, gv.y + gv.height / 2)
await page.mouse.down()
await page.mouse.move(gx2, gv.y + gv.height / 2, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
ok(Math.abs(d.xguides.v[0] - 250) < 2, `가이드 이동 (${d.xguides.v[0]})`)

// 룰러 밖(캔버스 밖) 드롭 = 삭제
const gv2 = await page.locator('.fixedguide--v').boundingBox()
await page.mouse.move(gv2.x + gv2.width / 2, gv2.y + gv2.height / 2)
await page.mouse.down()
const lr2 = await page.locator('.ruler--left').boundingBox()
await page.mouse.move(lr2.x - 40, gv2.y + gv2.height / 2, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
ok((d.xguides?.v?.length ?? 0) === 0, '캔버스 밖 드롭 → 삭제')

// 내보내기엔 xguides 미포함 (최적화 경로)
await page.locator('.tabs__btn', { hasText: '내보내기' }).click()
await page.waitForTimeout(300)
const [dl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: 'JSON 다운로드' }).click(),
])
const fs = await import('node:fs')
const doc = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'))
ok(!('xguides' in doc), '내보내기에 가이드 제외')

await done(browser)
