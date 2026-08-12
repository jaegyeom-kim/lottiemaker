// E2E 공통 헬퍼 — playwright-core 헤드리스로 dev 서버(localhost:5173)를 구동한다.
// 실행: npm run test:e2e (러너가 서버를 자동 기동/정리)
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

export const FIXTURES = path.dirname(fileURLToPath(new URL('../fixtures/x', import.meta.url)))
export const ARTIFACTS = path.dirname(fileURLToPath(new URL('../.artifacts/x', import.meta.url)))
fs.mkdirSync(ARTIFACTS, { recursive: true })

export const BASE_URL = process.env.LM_BASE_URL ?? 'http://localhost:5173/'

/**
 * 앱 기동 + 커스텀 모드 진입 + 픽스처 임포트까지의 공통 프롤로그.
 * fixture: null이면 임포트 생략. beforeGoto: 라우트 목 등록 등 goto 이전 훅.
 */
export async function launchApp({ fixture = 'sound_wave.json', beforeGoto } = {}) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.on('dialog', (d) => d.accept())
  await page.addInitScript(() => localStorage.setItem('lottiemaker.theme', 'dark'))
  if (beforeGoto) await beforeGoto(page)
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.locator('button', { hasText: '커스텀' }).first().click()
  if (fixture) {
    await page.setInputFiles('input[type=file]', path.join(FIXTURES, fixture))
    await page.waitForSelector('.timeline__clip', { timeout: 10000 })
    await page.waitForTimeout(700)
  }
  return { browser, page }
}

/** ✓/✗ 카운터 — done()이 종료 코드까지 처리. */
export function checker(name) {
  let failed = 0
  return {
    ok(cond, msg) {
      if (cond) console.log('✓', msg)
      else {
        failed++
        console.error('✗', msg)
      }
    },
    async done(browser) {
      await browser.close()
      console.log(failed ? `${name} FAIL ${failed}` : `${name} PASS`)
      process.exit(failed ? 1 : 0)
    },
  }
}

/** 자동 저장된 커스텀 세션의 sourceData. (저장 디바운스 0.8s — 호출 전 대기 필요) */
export function sessionSource(page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('lottiemaker.session.custom.v1') ?? 'null')?.sourceData,
  )
}
