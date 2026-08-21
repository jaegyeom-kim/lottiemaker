// 에셋 라이브러리 — properties에서 저장, 갤러리 그리드에서 재삽입, 세션 간 유지.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('LIBRARY')
const src = () => sessionSource(page)
const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}

// 사각형 → properties '라이브러리에 저장'
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(100, 100)))
await page.mouse.down()
await page.mouse.move(...(await tc(220, 200)), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)
const saveBtn = page.locator('.grouphead--row .linkbtn', { hasText: '라이브러리에 저장' })
ok((await saveBtn.count()) === 1, '저장 버튼 표시 (SVG 레이어)')
await saveBtn.click()
await page.waitForTimeout(600)
ok((await page.locator('.libgrid__item').count()) === 1, '라이브러리에 아이템 1개')

// 그리드 클릭 → 새 레이어 삽입
await page.locator('.libgrid__thumb').click()
await page.waitForTimeout(1300)
let d = await src()
ok(d.layers.length === 2, `클릭 삽입 → 레이어 2개 (${d.layers.length})`)
ok(typeof d.layers[0].xsrc === 'string', '삽입 레이어도 SVG 원본 보유')

// 새로고침 후 유지 (IDB)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
ok((await page.locator('.libgrid__item').count()) === 1, '새로고침 후 유지')

// 삭제
await page.locator('.libgrid__item').hover()
await page.locator('.libgrid__del').click()
await page.waitForTimeout(400)
ok((await page.locator('.libgrid__item').count()) === 0, '삭제')

await done(browser)
