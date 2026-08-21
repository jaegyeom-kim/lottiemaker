// 자동 저장 IndexedDB — IDB 주 저장소, localStorage 소형 미러, 대형 세션도 saved.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('AUTOSAVE-IDB')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
const idbRead = (key) =>
  page.evaluate(
    (k) =>
      new Promise((resolve) => {
        const req = indexedDB.open('lottiemaker') // 버전 미지정 — 현재 버전으로
        req.onsuccess = () => {
          try {
            const tx = req.result.transaction('sessions', 'readonly')
            const g = tx.objectStore('sessions').get(k)
            g.onsuccess = () => resolve(typeof g.result === 'string' ? g.result.length : null)
            g.onerror = () => resolve(null)
          } catch {
            resolve(null)
          }
        }
        req.onerror = () => resolve(null)
      }),
    key,
  )

// 편집 → 저장 → IDB에 세션 존재 + 배지 saved
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...tc(100, 100))
await page.mouse.down()
await page.mouse.move(...tc(220, 200), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(1500)
const idbLen = await idbRead('lottiemaker.session.custom.v1')
ok(idbLen > 100, `IDB에 세션 저장 (${idbLen}B)`)
ok((await page.locator('.topbar__saved').textContent())?.includes('자동 저장'), '저장 배지')
const lsLen = await page.evaluate(() => localStorage.getItem('lottiemaker.session.custom.v1')?.length ?? 0)
ok(lsLen > 100, `localStorage 미러 존재 (${lsLen}B)`)

// 새로고침 → IDB 세션으로 복원 (localStorage 미러 삭제 후에도)
await page.evaluate(() => localStorage.removeItem('lottiemaker.session.custom.v1'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const layers = await page.evaluate(() => {
  return document.querySelectorAll('.timeline__label--row').length
})
ok(layers === 1, `미러 없이 IDB만으로 복원 (${layers}레이어)`)
const d = await sessionSource(page)
ok(d?.layers?.length === 1 && d.layers[0].xshape?.tool === 'rect', '복원 내용 일치')

await done(browser)
