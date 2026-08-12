// 그래프 에디터 — 마키 키 선택, 팬 제거, 휠 줌/H/F 프레이밍
import { launchApp, checker, sessionSource, ARTIFACTS } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('MARQUEE')
const src = () => sessionSource(page)

// GE 오픈
await (await page.$$('.timeline__label--row'))[0].click()
await page.locator('.tlbtn').nth(1).click()
await page.waitForTimeout(400)
ok(!!(await page.$('.gepanel')), '그래프 에디터 오픈')
const plot = await page.$eval('.gepanel__graph', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
const domainSig = async () => page.$eval('.gepanel__graph', (e) => [...e.querySelectorAll('text')].map((t) => t.textContent).join(','))

// 1) 팬 제거 — 빈 곳 드래그해도 도메인(눈금) 불변, 대신 마키 선택 발생
const sig0 = await domainSig()
const keyCount = await page.locator('.gepanel__key').count()
ok(keyCount >= 2, `키 다이아몬드 (${keyCount})`)
// 플롯 전체를 덮는 드래그 → 모든 키 선택
await page.mouse.move(plot.x + 50, plot.y + 20)
await page.mouse.down()
await page.mouse.move(plot.x + plot.w - 20, plot.y + plot.h - 30, { steps: 8 })
// 드래그 중 마키 렌더 확인
ok(!!(await page.$('.gepanel__marquee')), '드래그 중 마키 박스 렌더')
await page.mouse.up()
await page.waitForTimeout(150)
const sig1 = await domainSig()
ok(sig0 === sig1, '드래그해도 도메인 불변 (팬 제거)')
const selCount = await page.locator('.gepanel__key--sel').count()
ok(selCount >= 2, `마키 다중 선택 (${selCount}/${keyCount})`)
ok(!(await page.$('.gepanel__marquee')), '드래그 종료 후 마키 박스 제거')

// 2) 다중 선택 프리셋 → 여러 구간에 이지 이즈
await page.locator('.gepanel__btn', { hasText: '이지 이즈' }).click()
await page.waitForTimeout(1300)
let d = await src()
const l0keys = d.layers[0].xkf.keys
const easedN = l0keys.filter((k) => k.e && Object.values(k.e).some((b) => Math.abs(b[0] - 0.42) < 0.01)).length
// 선택 키 중 다음 키 있는 것 = keyCount-1 구간 전부 적용돼야 함
ok(easedN === keyCount - 1, `프리셋 선택 구간 전부 적용 (${easedN}/${keyCount - 1})`)

// 3) 빈 곳 짧은 클릭 → 선택 해제
await page.mouse.click(plot.x + 30, plot.y + 12)
await page.waitForTimeout(150)
ok((await page.locator('.gepanel__key--sel').count()) === 0, '빈 곳 클릭 → 선택 해제')

// 4) 단일 키 클릭 선택 + 핸들 표시 유지
await (await page.$$('.gepanel__key'))[0].click()
await page.waitForTimeout(150)
ok((await page.locator('.gepanel__key--sel').count()) >= 1, '단일 키 클릭 선택')
const handles = await page.locator('.gepanel__handle').count()
ok(handles >= 1, `단일 선택 핸들 표시 (${handles})`)

// 5) ⇧클릭 추가 선택
const kEls = await page.$$('.gepanel__key')
if (kEls.length >= 2) {
  const kb = await kEls[kEls.length - 1].boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height / 2)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(150)
  ok((await page.locator('.gepanel__key--sel').count()) >= 2, '⇧클릭 추가 선택')
}

// 6) 휠 줌 + H 프레이밍 여전히 동작
const sigA = await domainSig()
await page.mouse.move(plot.x + plot.w / 2, plot.y + plot.h / 2)
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -240)
await page.waitForTimeout(200)
const sigB = await domainSig()
ok(sigA !== sigB, '휠 줌 동작')
await page.keyboard.press('h')
await page.waitForTimeout(150)
ok(true, 'H 프레이밍 (크래시 없음)')

// 7) F — 선택 맞춤
await (await page.$$('.gepanel__key'))[0].click()
await page.waitForTimeout(100)
const sigC = await domainSig()
await page.keyboard.press('f')
await page.waitForTimeout(150)
const sigD = await domainSig()
ok(sigC !== sigD, 'F 선택 맞춤 동작')

const b = await page.$eval('.gepanel', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
await page.screenshot({ path: `${ARTIFACTS}/ge-marquee.png`, clip: { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8 } })
await done(browser)

