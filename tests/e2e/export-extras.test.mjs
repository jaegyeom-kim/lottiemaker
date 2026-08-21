// 내보내기 확장 — 최적화(라운딩·메타 제거) + GIF 인코딩.
import { launchApp, checker } from './_helpers.mjs'
import fs from 'node:fs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('EXPORT-EXTRAS')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...tc(101.37, 100.73))
await page.mouse.down()
await page.mouse.move(...tc(260, 220), { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(900)

// 내보내기 탭
await page.locator('.tabs__btn', { hasText: '내보내기' }).click()
await page.waitForTimeout(300)
ok((await page.locator('.check', { hasText: '최적화' }).count()) === 1, '최적화 토글 표시')

// JSON 다운로드 (최적화 on) → 에디터 메타 없음 + 3dp 라운딩
const [dl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: 'JSON 다운로드' }).click(),
])
const path1 = await dl.path()
const doc = JSON.parse(fs.readFileSync(path1, 'utf8'))
ok(!('xsel' in (doc.layers[0] ?? {})) && !('xkf' in (doc.layers[0] ?? {})), '에디터 메타 제거')
const longFloat = JSON.stringify(doc).match(/\d+\.\d{5,}/)
ok(!longFloat, `소수점 3자리 라운딩 (${longFloat?.[0] ?? 'clean'})`)
ok(Array.isArray(doc.layers) && doc.layers.length === 1, '레이어 보존')

// GIF 저장 → 유효한 GIF 시그니처 + 크기
const [dl2] = await Promise.all([
  page.waitForEvent('download', { timeout: 120000 }),
  page.locator('button', { hasText: 'GIF 저장' }).click(),
])
const path2 = await dl2.path()
const buf = fs.readFileSync(path2)
ok(buf.slice(0, 6).toString('latin1').startsWith('GIF8'), 'GIF 시그니처')
ok(buf.length > 2000, `GIF 크기 (${(buf.length / 1024).toFixed(1)}KB)`)

// 프레임 PNG — 시그니처 + 크기
const [dl3] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: '프레임 PNG' }).click(),
])
const png = fs.readFileSync(await dl3.path())
ok(png.slice(1, 4).toString('latin1') === 'PNG', 'PNG 시그니처')
ok(png.length > 500, `PNG 크기 (${(png.length / 1024).toFixed(1)}KB)`)

// PNG 시퀀스 — zip 시그니처
const [dl4] = await Promise.all([
  page.waitForEvent('download', { timeout: 120000 }),
  page.locator('button', { hasText: 'PNG 시퀀스' }).click(),
])
const zip = fs.readFileSync(await dl4.path())
ok(zip.slice(0, 2).toString('latin1') === 'PK', 'zip 시그니처')
ok(zip.includes('frame_0001.png'), '시퀀스 엔트리 존재')

await done(browser)
