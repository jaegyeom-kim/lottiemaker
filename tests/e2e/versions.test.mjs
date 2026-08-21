// 버전 스냅샷 — 저장, 목록, 복원(직전 자동 백업), 삭제.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('VERSIONS')
const src = () => sessionSource(page)
const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}
const drawRect = async (x0, y0, x1, y1) => {
  await page.locator('.drawbar button[title*="사각형"]').click()
  await page.mouse.move(...(await tc(x0, y0)))
  await page.mouse.down()
  await page.mouse.move(...(await tc(x1, y1)), { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(900)
}

// 레이어 1개 상태 → 스냅샷 'v1'
await drawRect(100, 100, 200, 180)
await page.locator('.tabs__btn', { hasText: '내보내기' }).click()
await page.waitForTimeout(300)
await page.locator('.versions__save input').fill('v1')
await page.locator('.versions__save button').click()
await page.waitForTimeout(600)
ok((await page.locator('.versions__item').count()) === 1, '스냅샷 저장 → 목록 1개')

// 레이어 하나 더 → 2개 상태
await page.locator('.tabs__btn', { hasText: '편집' }).click()
await page.waitForTimeout(200)
await drawRect(300, 300, 380, 360)
let d = await src()
ok(d.layers.length === 2, '레이어 2개')

// v1 복원 → 레이어 1개 + 자동 백업 생김
await page.locator('.tabs__btn', { hasText: '내보내기' }).click()
await page.waitForTimeout(300)
await page.locator('.versions__item', { hasText: 'v1' }).locator('.linkbtn', { hasText: '복원' }).click()
await page.waitForTimeout(1500)
d = await src()
ok(d.layers.length === 1, `복원 → 레이어 1개 (${d.layers.length})`)
const items = await page.$$eval('.versions__item strong', (els) => els.map((e) => e.textContent))
ok(items.some((n) => n.includes('자동 백업')), `복원 전 자동 백업 (${items.join(' | ')})`)

// 자동 백업 복원 → 2개 상태로
await page.locator('.versions__item', { hasText: '자동 백업' }).first().locator('.linkbtn', { hasText: '복원' }).click()
await page.waitForTimeout(1500)
d = await src()
ok(d.layers.length === 2, '백업 복원 → 레이어 2개')

// 삭제
const before = await page.locator('.versions__item').count()
await page.locator('.versions__item').first().locator('.versions__del').click()
await page.waitForTimeout(500)
ok((await page.locator('.versions__item').count()) === before - 1, '삭제')

// 새로고침 후 목록 유지 (IDB)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.locator('.tabs__btn', { hasText: '내보내기' }).click()
await page.waitForTimeout(400)
ok((await page.locator('.versions__item').count()) >= 1, '새로고침 후 버전 유지')

await done(browser)
