// 속성 패널 — 키 없는 채널은 정적 값(키 생성 금지), 키 있는 채널만 재생헤드 키.
// + 같은 t에 채널별로 쪼개진 임포트 키의 병합(normKf)·업서트 중복 방지 회귀.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('STATIC-PROPS')
await page.waitForTimeout(500)
const src = () => sessionSource(page)
const row0 = (await page.$$('.timeline__label--row'))[0]
const rb = await row0.boundingBox()
await page.mouse.click(rb.x + 14, rb.y + rb.height / 2)
await page.waitForTimeout(300)
const keysOf = async (ch) => ((await src())?.layers?.[0]?.xkf?.keys ?? []).filter((k) => k[ch] !== undefined)

// ① 스케일 — s 키 보유 채널 → 재생헤드 키 갱신, 중복 없이 (숫자 입력 UI)
const xform = page.locator('.knob', { hasText: /^스케일/ }).first()
const propInput = (i) => xform.locator('.posinput input').nth(i)
await propInput(0).fill('180')
await propInput(0).press('Enter')
await page.waitForTimeout(1300)
let d = await src()
const sKeys = await keysOf('s')
ok(sKeys.length === 1 && sKeys[0].s === 180, `s키 1개로 갱신 (${JSON.stringify(sKeys)})`)
const ksS = d.layers[0].ks?.s
const t0count = Array.isArray(ksS?.k) ? ksS.k.filter((k) => k.t === 0).length : 0
ok(ksS?.a === 0 || t0count <= 1, `ks.s 중복 없음 (${JSON.stringify(ksS).slice(0, 120)})`)

// ② 위치 — p 키 없음 → 정적 이동, 키 금지
const xInput = page.locator('.posrow input').first()
await xInput.fill('300')
await xInput.press('Enter')
await page.waitForTimeout(1300)
d = await src()
ok((await keysOf('p')).length === 0, '위치(p키 없음) → p키 안 찍음')
ok(Math.abs(d.layers[0].xbase[0] - 300) < 1, `xbase 정적 이동 (${d.layers[0].xbase[0]})`)

// ③ 불투명도 — o 키 없음 → 정적, 키 금지
await propInput(2).fill('55')
await propInput(2).press('Enter')
await page.waitForTimeout(1300)
d = await src()
ok((await keysOf('o')).length === 0, '불투명도(o키 없음) → o키 안 찍음')
ok(d.layers[0].xsel?.opacity === 55, `xsel.opacity=55 (${d.layers[0].xsel?.opacity})`)

// ④ 회전 — r 키 보유 → 재생헤드 키 갱신 (기존 동작)
const rBefore = (await keysOf('r')).length
await propInput(1).fill('90')
await propInput(1).press('Enter')
await page.waitForTimeout(1300)
const rKeys = await keysOf('r')
ok(rKeys.length === rBefore && rKeys.some((k) => k.t === 0 && k.r === 90), `회전(r키 보유) → 0f 키 갱신 (${JSON.stringify(rKeys)})`)
// 속성(변형) knob에 슬라이더 없음 — 숫자 입력만
ok((await xform.locator('input[type=range]').count()) === 0, '속성 변형 UI에 슬라이더 없음')
ok(!(await page.locator('.panel__body').textContent()).includes('그래픽 크기'), '그래픽 크기 제거됨')
await done(browser)

