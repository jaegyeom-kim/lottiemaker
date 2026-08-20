// 첫 실행 = 빈 커스텀 캔버스 — 로드 화면 없이 바로 드로잉, 임포트는 새 문서 취급.
import { launchApp, checker, sessionSource, FIXTURES } from './_helpers.mjs'
import path from 'node:path'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('FRESH-START')

// ── 부팅 즉시 작업 가능 상태 ──
ok((await page.locator('.preview__empty').count()) === 0, '빈 화면(업로드 안내) 없음')
ok((await page.locator('.preview__lottiewrap').count()) === 1, '캔버스 표시')
ok((await page.locator('.drawbar').count()) >= 1, '드로잉 툴바 표시')
await page.waitForTimeout(1200) // 자동 저장 디바운스
let d = await sessionSource(page)
ok(d && d.layers.length === 0 && d.xblank === true, `빈 커스텀 문서 (op=${d?.op})`)

// ── 바로 드로잉 → 레이어 생성 ──
const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
await page.locator('.drawbar button[title*="사각형"]').click()
await page.mouse.move(...tc(120, 120))
await page.mouse.down()
await page.mouse.move(...tc(300, 260), { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await sessionSource(page)
ok(d.layers.length === 1, '드로잉 → 레이어 1개')
ok((await page.locator('.timeline__clip').count()) >= 1, '타임라인 클립 생성')

// ── 전부 삭제 → 다시 빈 캔버스 (null 아님) ──
await page.keyboard.press('Backspace')
await page.waitForTimeout(1300)
d = await sessionSource(page)
ok(d && d.layers.length === 0, '전부 삭제 → 빈 캔버스 유지')
ok((await page.locator('.preview__lottiewrap').count()) === 1, '삭제 후에도 캔버스/드로잉 가능')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
d = await sessionSource(page)
ok(d.layers.length === 1, '⌘Z → 레이어 복원')
await page.keyboard.press('Backspace')
await page.waitForTimeout(1300)

// ── 빈 캔버스에 로티 임포트 = 새 문서 취급 (컴프 길이 임포트 값) ──
await page.setInputFiles('input[type=file]', path.join(FIXTURES, 'sound_wave.json'))
await page.waitForSelector('.timeline__clip', { timeout: 10000 })
await page.waitForTimeout(900)
d = await sessionSource(page)
ok(d.layers.length === 6, `임포트 → 6레이어 (${d.layers.length})`)
ok(d.op === 240, `컴프 길이 = 임포트 값 240f (${d.op}) — 빈 캔버스 90f에 안 잘림`)
ok(d.xblank !== true, '임포트 후 xblank 해제')

await done(browser)
