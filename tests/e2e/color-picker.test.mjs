// 피그마식 컬러 피커 — SV 스퀘어·휴 슬라이더·헥스, 라이브 + 닫힘 커밋(언두 1스텝).
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('COLOR-PICKER')
const src = () => sessionSource(page)

const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...(await tc(100, 100)))
await page.mouse.down()
await page.mouse.move(...(await tc(240, 220)), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)

const fillOf = (d) => {
  const find = (items) => {
    for (const it of items ?? []) {
      if (it.ty === 'fl') return it.c.k
      if (it.ty === 'gr') { const r = find(it.it); if (r) return r }
    }
    return null
  }
  return find(d.layers[0].shapes[0].it)
}

// 스와치 클릭 → 피커 오픈
await page.locator('.colors__item .cswatch').first().click()
await page.waitForTimeout(200)
ok((await page.locator('.cpicker').count()) === 1, '스와치 → 피커 오픈')
ok((await page.locator('.cpicker__sv').count()) === 1, 'SV 스퀘어')
ok((await page.locator('.cpicker__hue').count()) === 1, '휴 슬라이더')

// 휴 슬라이더 왼끝 = 빨강 계열 → SV 우상단 = 순색 (드래그 — 캡처 경로)
const hue = await page.locator('.cpicker__hue').boundingBox()
await page.mouse.move(hue.x + hue.width / 2, hue.y + hue.height / 2)
await page.mouse.down()
await page.mouse.move(hue.x + 1, hue.y + hue.height / 2, { steps: 4 })
await page.mouse.up()
const sv = await page.locator('.cpicker__sv').boundingBox()
await page.mouse.move(sv.x + sv.width / 2, sv.y + sv.height / 2)
await page.mouse.down()
await page.mouse.move(sv.x + sv.width + 20, sv.y - 20, { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(300)
// 라이브 반영 (커밋 전) — 렌더 색 빨강
let d = await src()
// 저장은 디바운스라 라이브 여부는 hex 표시로 확인
const hexShown = await page.locator('.cpicker__hex').inputValue()
ok(/^FF0[0-9A-F]0[0-9A-F]$/.test(hexShown) || hexShown === 'FF0000', `SV/휴 → 순빨강 (${hexShown})`)

// Esc = 닫힘 + 커밋
await page.keyboard.press('Escape')
await page.waitForTimeout(1300)
ok((await page.locator('.cpicker').count()) === 0, 'Esc → 닫힘')
d = await src()
const c = fillOf(d)
ok(c[0] > 0.98 && c[1] < 0.05 && c[2] < 0.05, `커밋된 fl 색 = 빨강 (${c.map((v) => v.toFixed(2))})`)

// 언두 1스텝 = 피커 세션 전체 롤백 (원래 DRAW_FILL 파랑)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
d = await src()
const c2 = fillOf(d)
ok(c2[2] > 0.8, `⌘Z 1회 → 원색 복원 (${c2.map((v) => v.toFixed(2))})`)

// 헥스 입력 경로 + 최근 색 기록
await page.locator('.colors__item .cswatch').first().click()
await page.waitForTimeout(200)
await page.locator('.cpicker__hex').fill('00C46A')
await page.locator('.cpicker__hex').press('Enter')
await page.keyboard.press('Escape')
await page.waitForTimeout(1300)
d = await src()
const c3 = fillOf(d)
ok(c3[1] > 0.7 && c3[0] < 0.1, `헥스 입력 커밋 (${c3.map((v) => v.toFixed(2))})`)
ok((await page.locator('.swatches__chip').count()) >= 1, '최근 색 기록')

// 바깥 클릭 = 닫힘
await page.locator('.colors__item .cswatch').first().click()
await page.waitForTimeout(200)
await page.mouse.click(...(await tc(400, 480)))
await page.waitForTimeout(300)
ok((await page.locator('.cpicker').count()) === 0, '바깥 클릭 → 닫힘')

await done(browser)
