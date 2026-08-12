// AI 모션 — API를 목으로 대체해 클라이언트 전체 흐름(요청 스펙 → 플랜 적용)을 검증.
import { launchApp, checker } from './_helpers.mjs'

let capturedBody = null
const { browser, page } = await launchApp({
  beforeGoto: async (page) => {
    await page.route('https://api.anthropic.com/v1/messages', async (route) => {
      capturedBody = JSON.parse(route.request().postData())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              name: 'apply_motion',
              input: {
                layers: [
                  { index: 0, keys: [{ t: 0, r: 0 }, { t: 30, r: 180, e: { r: [0.42, 0, 0.58, 1] } }] },
                ],
                note: '테스트 회전 적용',
              },
            },
          ],
        }),
      })
    })
    await page.addInitScript(() => localStorage.setItem('lottiemaker.anthropic.key', 'sk-ant-api-mock'))
  },
})
const { ok, done } = checker('AI-MOTION')

const aiInput = page.locator('.aipanel textarea').first()
ok((await aiInput.count()) === 1, 'AI 프롬프트 입력 존재')
await aiInput.fill('한바퀴 회전')
await page.locator('.aipanel button', { hasText: /생성|만들|실행|적용/ }).first().click()
await page.waitForTimeout(800)

ok(!!capturedBody, 'API 요청 발신됨')
if (capturedBody) {
  ok(capturedBody.model === 'claude-sonnet-5', `model=${capturedBody.model}`)
  ok(capturedBody.tool_choice?.type === 'tool', 'tool_choice 강제')
  ok(capturedBody.thinking === undefined, 'thinking 필드 생략 (adaptive 기본)')
  ok(Array.isArray(capturedBody.tools) && capturedBody.tools[0]?.name === 'apply_motion', 'tools=apply_motion')
}
const msgText = await page.locator('.aipanel').textContent()
ok(/적용|되돌릴/.test(msgText ?? ''), '성공 메시지 표시')
await page.waitForTimeout(1300)
const d = await page.evaluate(
  () => JSON.parse(localStorage.getItem('lottiemaker.session.custom.v1') ?? 'null')?.sourceData,
)
const kf = d?.layers?.[0]?.xkf
ok(kf?.on === true && kf?.keys?.length === 2, `키프레임 적용 (${kf?.keys?.length ?? 0}개)`)
await done(browser)
