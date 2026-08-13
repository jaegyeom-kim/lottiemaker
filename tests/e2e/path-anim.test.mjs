// 패스 애니메이션(pk 채널) — 토글, 펜 편집 = 재생헤드 키, 모핑 ks, 타임라인 ◆.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp()
const { ok, done } = checker('PATH-ANIM')

const wrap = await page.$eval('.preview__lottiewrap', (e) => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width }
})
const tc = (x, y) => [wrap.x + (x / 512) * wrap.w, wrap.y + (y / 512) * wrap.w]
const src = () => sessionSource(page)
const shOf = (d, li = 0) => {
  const find = (items) => {
    for (const it of items ?? []) {
      if (it.ty === 'sh') return it.ks
      if (it.ty === 'gr') { const r = find(it.it); if (r) return r }
    }
    return null
  }
  return find(d.layers[li].shapes)
}
const pkKeysOf = (d, li = 0) => ((d.layers[li].xkf?.keys ?? []).filter((k) => k.pk !== undefined))
const scrubTo = async (f) => {
  const op = (await src()).op
  const r = await page.locator('.timeline__ruler').boundingBox()
  await page.mouse.click(r.x + (f / op) * r.width, r.y + r.height / 2)
  await page.waitForTimeout(250)
}

// ── 펜 삼각형 → 패스 애니메이션 켜기 ──
await page.locator('.drawbar button[title*="펜"]').click()
await page.mouse.click(...tc(80, 80))
await page.mouse.click(...tc(220, 110))
await page.mouse.click(...tc(150, 230))
await page.keyboard.press('Enter')
await page.waitForTimeout(1300)
await page.keyboard.press('v')
await page.waitForTimeout(300)

const paKnob = page.locator('.knob', { hasText: /패스 애니메이션/ })
ok((await paKnob.count()) === 1, 'properties에 패스 애니메이션 섹션')
await paKnob.locator('.linkbtn').click()
await page.waitForTimeout(1300)
let d = await src()
ok(pkKeysOf(d).length === 1, `켜기 → pk 키 1개 (t=${pkKeysOf(d)[0]?.t})`)
ok(shOf(d).a !== 1, '키 1개 = 정적 유지')
const v0Before = shOf(d).k.v[0][0]

// ── 45f로 스크럽 → 펜 편집 드래그 = 두 번째 키 ──
await scrubTo(45)
await page.locator('.drawbar button[title*="펜"]').click()
await page.waitForTimeout(400)
const a0 = await (await page.$$('.drawghost__anchor'))[0].boundingBox()
await page.mouse.move(a0.x + a0.width / 2, a0.y + a0.height / 2)
await page.mouse.down()
await page.mouse.move(a0.x + a0.width / 2 - 70, a0.y + a0.height / 2, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1300)
d = await src()
const keys2 = pkKeysOf(d)
ok(keys2.length === 2, `펜 편집 → 키 2개 (${keys2.map((k) => k.t).join(',')})`)
ok(Math.abs(keys2[1].t - 45) < 3, `둘째 키 = 재생헤드 (t=${keys2[1].t})`)
const ks = shOf(d)
ok(ks.a === 1 && ks.k.length === 2, `sh.ks 모핑 (a=${ks.a}, ${ks.k?.length}키)`)
ok(ks.k[0].s[0].v[0][0] !== ks.k[1].s[0].v[0][0], '두 키 형태 상이')
// 첫 키 형태는 원본 그대로 (0f 편집 아님)
ok(Math.abs(ks.k[0].s[0].v[0][0] - v0Before) < 0.5, '첫 키 형태 보존')

// ── 타임라인 — U로 공개, 패스 행 + ◆ 스냅샷 키 ──
await page.keyboard.press('v')
await page.keyboard.press('u')
await page.waitForTimeout(300)
const pkRow = page.locator('.timeline__label--prop', { hasText: /^◆?\s*패스\s*\d*$/ })
ok((await pkRow.count()) === 1, '타임라인 패스 채널 행')
await scrubTo(80)
await pkRow.locator('.timeline__propkey').click()
await page.waitForTimeout(1300)
d = await src()
ok(pkKeysOf(d).length === 3, `◆ → 스냅샷 키 3개 (${pkKeysOf(d).map((k) => k.t).join(',')})`)
// 80f ≥ 마지막 키(45f) → 45f 형태 스냅샷
const kk = pkKeysOf(d)
ok(Math.abs(kk[2].pk.v[0][0] - kk[1].pk.v[0][0]) < 0.5, '스냅샷 = 보간 형태')
// ◆ 재클릭 = 키 제거
await pkRow.locator('.timeline__propkey').click()
await page.waitForTimeout(1300)
d = await src()
ok(pkKeysOf(d).length === 2, '◆ 재클릭 → 키 제거')

// ── 끄기 = 현재 프레임 형태로 고정 ──
await scrubTo(45)
await paKnob.locator('.linkbtn').click()
await page.waitForTimeout(1300)
d = await src()
ok(pkKeysOf(d).length === 0, '끄기 → pk 채널 제거')
const ksOff = shOf(d)
ok(ksOff.a !== 1, '끄기 → 정적 패스')
ok(Math.abs(ksOff.k.v[0][0] - kk[1].pk.v[0][0]) < 1, `고정 형태 = 45f 형태 (${ksOff.k.v[0][0].toFixed(1)})`)

// ── 언두 → 키 복원 ──
await page.keyboard.press('Meta+z')
await page.waitForTimeout(1300)
d = await src()
ok(pkKeysOf(d).length === 2 && shOf(d).a === 1, '⌘Z → 패스 애니메이션 복원')

await done(browser)
