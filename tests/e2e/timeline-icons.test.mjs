// 타임라인 레이어 아이콘(눈/잠금/타임라인 끄기) + 그래프 에디터 기본 동작
import { launchApp, checker, sessionSource, ARTIFACTS, FIXTURES } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('TIMELINE-ICONS')
const src = () => sessionSource(page)

// 1) 눈 — 숨김 토글
const row0 = (await page.$$('.timeline__label--row'))[0]
await row0.hover()
await page.waitForTimeout(150)
await (await row0.$$('.timeline__lbtn'))[3].click()
await page.waitForTimeout(1300)
let d = await src()
ok(d.layers[0].hd === true, '눈 → hd=true')
await row0.hover()
await (await row0.$$('.timeline__lbtn'))[3].click()
await page.waitForTimeout(1300)
// 2) 잠금 — 클립 드래그 무시 + 캔버스 픽 제외
const rows = await page.$$('.timeline__label--row')
await rows[1].hover()
await (await rows[1].$$('.timeline__lbtn'))[4].click()
await page.waitForTimeout(1300)
d = await src()
ok(d.layers[1].xlock === true, '잠금 → xlock=true')
const clipBefore = d.layers[1].xsel?.clip ?? [0, 240]
const c1 = await (await page.$$('.timeline__clip'))[1].boundingBox()
await page.mouse.move(c1.x + c1.width / 2, c1.y + c1.height / 2)
await page.mouse.down()
await page.mouse.move(c1.x + c1.width / 2 + 80, c1.y + c1.height / 2, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
const clipAfter = d.layers[1].xsel?.clip ?? [0, 240]
ok(Math.abs(clipAfter[0] - clipBefore[0]) < 0.1, `잠금 클립 드래그 차단 (${clipBefore[0]} → ${clipAfter[0]})`)
// 잠금 해제
await rows[1].hover()
await (await rows[1].$$('.timeline__lbtn'))[4].click()
await page.waitForTimeout(1300)
// 3) 타임라인에서 끄기 → 행 사라짐 → 헤더 토글로 복귀
const rowCount = async () => page.locator('.timeline__label--row').count()
const n0 = await rowCount()
await rows[2].hover()
await (await rows[2].$$('.timeline__lbtn'))[5].click()
await page.waitForTimeout(1300)
ok((await rowCount()) === n0 - 1, `⊖ → 행 숨김 (${n0} → ${await rowCount()})`)
// 라벨-트랙 정렬 유지
const align = await page.evaluate(() => {
  const L = [...document.querySelectorAll('.timeline__labelgroup')].slice(0, 5).map((e) => Math.round(e.getBoundingClientRect().top))
  const T = [...document.querySelectorAll('.timeline__trackgroup')].slice(0, 5).map((e) => Math.round(e.getBoundingClientRect().top))
  return L.map((v, i) => T[i] - v)
})
ok(align.every((x) => x === 0), `숨김 후 정렬 (${align})`)
await page.locator('.tlbtn').first().click()
await page.waitForTimeout(300)
ok((await rowCount()) === n0, `헤더 토글 → 다시 표시 (${await rowCount()})`)
await page.locator('.tlbtn').first().click() // 다시 숨김 모드 기본으로
await page.waitForTimeout(200)
const r2 = (await page.$$('.timeline__label--row'))[2]
await r2.hover()
// 켜져있는(⊖on) 버튼 다시 클릭해 해제 — 세 번째 행이 이제 다른 레이어이므로 저장소로 직접 확인
d = await src()
const tloffIdx = d.layers.findIndex((l) => l.xtloff === true)
ok(tloffIdx >= 0, `xtloff 플래그 (${tloffIdx})`)

// 4) 그래프 에디터 — kf 있는 레이어 선택 후 오픈
await (await page.$$('.timeline__label--row'))[0].click()
await page.locator('.tlbtn').nth(1).click()
await page.waitForTimeout(400)
ok(!!(await page.$('.gepanel')), '그래프 에디터 오픈')
const props = await page.locator('.gepanel__prop').allTextContents()
ok(props.some((x) => x.includes('회전')), `프로퍼티 목록 (${props})`)
const curves = await page.locator('.gepanel__graph path').count()
ok(curves >= 1, `커브 렌더 (${curves})`)
const keys = await page.locator('.gepanel__key').count()
ok(keys >= 2, `키 다이아몬드 (${keys})`)
// 키 선택 → 이지 이즈 적용 → xkf e 확인
await (await page.$$('.gepanel__key'))[0].click()
await page.waitForTimeout(150)
await page.locator('.gepanel__btn', { hasText: '이지 이즈' }).click()
await page.waitForTimeout(1300)
d = await src()
const l0keys = d.layers[0].xkf.keys
const eased = l0keys.find((k) => k.e && Object.values(k.e).some((b) => Math.abs(b[0] - 0.42) < 0.01))
ok(!!eased, `이지 이즈 적용 (${JSON.stringify(eased?.e ?? null)})`)
// 커브 복사 → 붙여넣기 활성
await page.locator('.gepanel__btn', { hasText: '커브 복사' }).click()
const pasteDisabled = await page.locator('.gepanel__btn', { hasText: '커브 붙여넣기' }).isDisabled()
ok(!pasteDisabled, '커브 복사 → 붙여넣기 활성')
// 독립 창 — 배경 상호작용해도 안 닫히고, Esc로 닫힘
await page.mouse.click(700, 850)
await page.waitForTimeout(200)
ok(!!(await page.$('.gepanel')), '독립 창 — 배경 클릭에도 유지')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
ok(!(await page.$('.gepanel')), 'Esc 닫기')
await page.locator('.tlbtn').nth(1).click()
await page.waitForTimeout(300)
const b = await page.$eval('.gepanel', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
await page.screenshot({ path: `${ARTIFACTS}/graph.png`, clip: { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8 } })
await done(browser)

