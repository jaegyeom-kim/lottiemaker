// 텍스트 툴 — 폰트 업로드(.ttf) → 패스 변환 레이어, properties 재생성.
import { launchApp, checker, sessionSource } from './_helpers.mjs'
import fs from 'node:fs'

// macOS 시스템 폰트 — 레포에 폰트를 커밋하지 않고 로컬에서 조달
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Verdana.ttf',
  '/Library/Fonts/Arial.ttf',
]
const FONT = FONT_CANDIDATES.find((p) => fs.existsSync(p))
if (!FONT) {
  console.log('✓ (스킵) 시스템 ttf 없음 — 텍스트 툴 테스트 생략')
  console.log('TEXT-TOOL PASS')
  process.exit(0)
}

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('TEXT-TOOL')
const src = () => sessionSource(page)

// T 버튼 → 다이얼로그
await page.locator('.drawbar button[title*="텍스트"]').click()
await page.waitForTimeout(300)
ok((await page.locator('.textdlg').count()) === 1, 'T → 텍스트 다이얼로그')

// 폰트 업로드
await page.setInputFiles('.textdlg input[type=file]', FONT)
await page.waitForTimeout(800)
const fontName = await page.locator('.textdlg .fontpicker select').inputValue()
ok(fontName.length > 0, `폰트 등록 (${fontName})`)

// 텍스트 입력 + 추가
await page.locator('.textdlg__text').fill('Hi')
await page.evaluate(() => {
  ;[...document.querySelectorAll('.textdlg button')].find((b) => b.textContent === '추가')?.click()
})
await page.waitForTimeout(1500)
let d = await src()
ok(d.layers.length === 1, '텍스트 레이어 생성')
ok(d.layers[0].xtext?.text === 'Hi' && d.layers[0].xtext?.font === fontName, 'xtext 메타')
// 패스 변환 — sh 셰이프 존재 (텍스트 레이어 ty5 아님)
const hasSh = JSON.stringify(d.layers[0].shapes).includes('"ty":"sh"')
ok(Number(d.layers[0].ty) === 4 && hasSh, '패스 셰이프로 변환 (호환 100%)')

// properties 텍스트 섹션 — 내용 변경 → 재생성
const tSec = page.locator('.knob', { hasText: /^텍스트/ })
ok((await tSec.count()) === 1, 'properties 텍스트 섹션')
const kBefore = JSON.stringify(d.layers[0].shapes).length
await tSec.locator('textarea').fill('Hello!')
await tSec.locator('textarea').blur()
await page.waitForTimeout(1500)
d = await src()
ok(d.layers[0].xtext.text === 'Hello!', '내용 변경 반영')
ok(JSON.stringify(d.layers[0].shapes).length > kBefore, '지오메트리 재생성 (더 긴 텍스트)')

// 크기 변경
const sizeIn = tSec.locator('.posinput', { hasText: /크기/ }).locator('input')
await sizeIn.fill('120')
await sizeIn.press('Enter')
await page.waitForTimeout(1500)
d = await src()
ok(d.layers[0].xtext.size === 120, `크기 반영 (${d.layers[0].xtext.size})`)

// 새로고침 후 폰트 유지 (IDB) — 다이얼로그 셀렉트에 그대로
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.locator('.drawbar button[title*="텍스트"]').click()
await page.waitForTimeout(500)
ok((await page.locator('.textdlg .fontpicker select').inputValue()) === fontName, '폰트 세션 간 유지')

await done(browser)
