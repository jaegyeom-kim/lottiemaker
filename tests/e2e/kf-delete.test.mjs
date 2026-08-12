// 키프레임 삭제 회귀 — 플레이헤드가 키 클릭을 가로채 Delete가 레이어를 지우던 버그.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('KF-DELETE')
const src = () => sessionSource(page)

// 레이어 선택 → U로 키 채널 공개
const row0 = (await page.$$('.timeline__label--row'))[0]
const rb = await row0.boundingBox()
await page.mouse.click(rb.x + 14, rb.y + rb.height / 2)
await page.waitForTimeout(200)
await page.keyboard.press('u')
await page.waitForTimeout(300)

const kfs = await page.$$('.timeline__kf--prop')
ok(kfs.length >= 2, `키 다이아몬드 표시 (${kfs.length})`)
const layersBefore = (await src())?.layers?.length

// 플레이헤드(t=0)와 겹친 첫 키 클릭 — 키가 선택돼야 한다
const kb = await kfs[0].boundingBox()
await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height / 2)
await page.waitForTimeout(200)
ok((await page.locator('.timeline__kf--sel').count()) === 1, '플레이헤드와 겹친 키 클릭 → 선택')

// Delete = 키 삭제, 레이어는 유지
await page.keyboard.press('Delete')
await page.waitForTimeout(1300)
let d = await src()
ok(d?.layers?.length === layersBefore, `Delete → 레이어 유지 (${d?.layers?.length})`)

// 더블클릭 삭제도 플레이헤드에 안 막힘
const kfs2 = await page.$$('.timeline__kf--prop')
if (kfs2.length) {
  const before = kfs2.length
  await kfs2[0].dblclick({ timeout: 5000 })
  await page.waitForTimeout(1300)
  d = await src()
  ok(d?.layers?.length === layersBefore, '더블클릭 삭제 → 레이어 유지')
  ok((await page.$$('.timeline__kf--prop')).length < before, '더블클릭 → 키 삭제됨')
}
await done(browser)
