// 페어런팅 — 할당/해제 무점프(AE 월드 보존), 부모 이동/회전 시 자식 박스·드래그 정상.
import { launchApp, checker, sessionSource } from './_helpers.mjs'

const { browser, page } = await launchApp({ fixture: null })
const { ok, done } = checker('PARENTING')
const src = () => sessionSource(page)

const tc = async (x, y) => {
  const r = await page.$eval('.preview__lottiewrap', (e) => {
    const b = e.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  return [r.x + (x / 512) * r.w, r.y + (y / 512) * r.w]
}
const drawRect = async (x0, y0, x1, y1) => {
  await page.locator('.drawbar button[title*="사각형"]').click()
  await page.mouse.move(...(await tc(x0, y0)))
  await page.mouse.down()
  await page.mouse.move(...(await tc(x1, y1)), { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(900)
}
// A(부모, 아래 행) → B(자식, 위 행 0)
await drawRect(100, 100, 220, 200) // A → 나중에 index 1
await drawRect(300, 300, 380, 360) // B → index 0
await page.waitForTimeout(600)

// 타임라인 행 버튼 — SPM과 동일 (행 i의 아이콘 버튼들 중 [1] = 부모)
const btnsOf = async (i) => {
  const rows = await page.$$('.timeline__label--row')
  return rows[i].$$('button.tlicon, .timeline__label--row button')
}
// B(행 0) 부모 버튼 → 팝오버에서 A 선택
const selBoxOf = async () => {
  const b = await page.locator('.selbox').first().boundingBox()
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width } : null
}
const before = await selBoxOf()
{
  const rows = await page.$$('.timeline__label--row')
  const btns = await rows[0].$$('button')
  // ParentIcon 버튼 탐색 — title에 '부모' 포함
  let clicked = false
  for (const b of btns) {
    const t2 = await b.getAttribute('title')
    if (t2 && t2.includes('부모')) {
      await b.click()
      clicked = true
      break
    }
  }
  ok(clicked, '부모 버튼 존재')
}
await page.waitForTimeout(300)
await (await page.$$('.parentpop__item'))[1].click() // 첫 후보 레이어 = A
await page.waitForTimeout(1300)
let d = await src()
ok(typeof d.layers[0].parent === 'number', `부모 할당 (parent=${d.layers[0].parent})`)

// 무점프 — 할당 직후 자식 selbox 위치 불변
const after = await selBoxOf()
ok(before && after && Math.hypot(after.x - before.x, after.y - before.y) < 2, `할당 무점프 (Δ${before && after ? Math.hypot(after.x - before.x, after.y - before.y).toFixed(1) : '?'}px)`)

// 부모 이동 → 자식 selbox 따라감
{
  const rows = await page.$$('.timeline__label--row')
  await (await rows[1].$$('span, div'))[0]?.click?.()
  await page.mouse.click((await tc(160, 150))[0], (await tc(160, 150))[1]) // A 선택
  await page.waitForTimeout(300)
  await page.mouse.move(...(await tc(160, 150)))
  await page.mouse.down()
  await page.mouse.move(...(await tc(240, 150)), { steps: 6 }) // A +80x
  await page.mouse.up()
  await page.waitForTimeout(1300)
  // 자식(B) 재선택 → 박스 위치 = 원래 +80
  await page.mouse.click(...(await tc(420, 330))) // B 새 위치 (340+80, 330)
  await page.waitForTimeout(300)
  const childBox = await selBoxOf()
  ok(childBox && Math.abs(childBox.x - (before.x + (after.w / (await page.$eval('.preview__lottiewrap', (e) => e.getBoundingClientRect().width)) ) * 0 + ((80 / 512) * (await page.$eval('.preview__lottiewrap', (e) => e.getBoundingClientRect().width))))) < 4, `부모 이동 → 자식 박스 +80 (${childBox ? (childBox.x - before.x).toFixed(0) : '?'}px)`)
}

// 드래그 중간에도 자식 동반 — 부모를 끌면서 릴리즈 전 자식 렌더 이동 확인
{
  await page.mouse.click(...(await tc(240, 150))) // A 선택
  await page.waitForTimeout(300)
  const childRect0 = await page.$eval('.preview__lottiewrap', (w) => {
    const g = w.querySelectorAll('svg > g > g')[0] // 레이어 0 = 자식 B
    const r = g.getBoundingClientRect()
    return { x: r.x, y: r.y }
  })
  await page.mouse.move(...(await tc(240, 150)))
  await page.mouse.down()
  await page.mouse.move(...(await tc(300, 210)), { steps: 6 }) // 릴리즈 안 함
  await page.waitForTimeout(150)
  const childRectMid = await page.$eval('.preview__lottiewrap', (w) => {
    const g = w.querySelectorAll('svg > g > g')[0]
    const r = g.getBoundingClientRect()
    return { x: r.x, y: r.y }
  })
  const midDx = childRectMid.x - childRect0.x
  ok(midDx > 20, `드래그 중 자식 실시간 동반 (+${midDx.toFixed(0)}px)`)
  // 원위치로 되돌리고 릴리즈 — 이후 케이스 좌표 유지
  await page.mouse.move(...(await tc(240, 150)), { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(1300)
}

// 부모 회전 45° 후 자식 드래그 → 목표 도달 (월드→로컬 변환)
{
  await page.mouse.click(...(await tc(240, 150))) // A 선택
  await page.waitForTimeout(300)
  const rotIn = page.locator('.posinput', { hasText: /회전/ }).first().locator('input')
  await rotIn.fill('45')
  await rotIn.press('Enter')
  await page.waitForTimeout(1300)
  // 자식 클릭 — 회전된 위치는 불확실하므로 박스로 찾기: 세션에서 자식 월드 위치 계산 불가 → selbox로
  // 자식 선택: 타임라인 행 0 클릭
  const rows = await page.$$('.timeline__label--row')
  const rb = await rows[0].boundingBox()
  await page.mouse.click(rb.x + 14, rb.y + rb.height / 2)
  await page.waitForTimeout(300)
  const cb = await selBoxOf()
  ok(!!cb, '회전 부모 밑 자식 선택박스 표시')
  // 자식을 캔버스 (256, 420)으로 드래그
  await page.mouse.move(cb.x, cb.y)
  await page.mouse.down()
  await page.keyboard.down('Meta') // 스냅 해제 — 정확 위치 검증
  await page.mouse.move(...(await tc(256, 420)), { steps: 8 })
  await page.keyboard.up('Meta')
  await page.mouse.up()
  await page.waitForTimeout(1300)
  const cb2 = await selBoxOf()
  const [ex, ey] = await tc(256, 420)
  ok(cb2 && Math.hypot(cb2.x - ex, cb2.y - ey) < 5, `회전 부모 밑 드래그 정확 (Δ${cb2 ? Math.hypot(cb2.x - ex, cb2.y - ey).toFixed(1) : '?'}px)`)
}

// 해제 무점프
{
  const beforeUn = await selBoxOf()
  const rows = await page.$$('.timeline__label--row')
  const btns = await rows[0].$$('button')
  for (const b of btns) {
    const t2 = await b.getAttribute('title')
    if (t2 && t2.includes('부모')) {
      await b.click()
      break
    }
  }
  await page.waitForTimeout(300)
  await (await page.$$('.parentpop__item'))[0].click() // 없음
  await page.waitForTimeout(1300)
  d = await src()
  ok(d.layers[0].parent === undefined, '부모 해제')
  const afterUn = await selBoxOf()
  ok(
    beforeUn && afterUn && Math.hypot(afterUn.x - beforeUn.x, afterUn.y - beforeUn.y) < 2,
    `해제 무점프 (Δ${beforeUn && afterUn ? Math.hypot(afterUn.x - beforeUn.x, afterUn.y - beforeUn.y).toFixed(1) : '?'}px)`,
  )
}

// ── properties 부모 드롭다운 — 같은 기능, 발견 가능한 경로 ──
{
  const rows = await page.$$('.timeline__label--row')
  const rb = await rows[0].boundingBox()
  await page.mouse.click(rb.x + 14, rb.y + rb.height / 2)
  await page.waitForTimeout(300)
  const parentKnob = page.locator('.knob', { hasText: /^부모/ })
  ok((await parentKnob.count()) === 1, 'properties 부모 드롭다운')
  const opts = await parentKnob.locator('option').allTextContents()
  ok(opts[0].includes('없음') && opts.length >= 2, `옵션 (${opts.join('/')})`)
  // 드롭다운으로 할당
  const val = await parentKnob.locator('option').nth(1).getAttribute('value')
  await parentKnob.locator('select').selectOption(val)
  await page.waitForTimeout(1300)
  d = await src()
  ok(d.layers[0].parent === Number(val), `드롭다운 할당 (parent=${d.layers[0].parent})`)
  await parentKnob.locator('select').selectOption('')
  await page.waitForTimeout(1300)
  d = await src()
  ok(d.layers[0].parent === undefined, '드롭다운 해제')
}

await done(browser)
