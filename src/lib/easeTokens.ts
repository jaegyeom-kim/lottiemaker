// 이징 토큰 — 내가 만든 커브를 이름 붙여 저장하고 어느 구간에나 재사용 (Lottie Creator 2.0 Motion Tokens 벤치).
// 앱 레벨(localStorage) 저장이라 프로젝트를 넘나들며 일관된 모션 값을 쓸 수 있다.
import type { Bezier4 } from './customBuilder'

export type EaseToken = { name: string; bez: Bezier4 }

const KEY = 'lottiemaker.easetokens'
const MAX = 24

export function loadEaseTokens(): EaseToken[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (t): t is EaseToken =>
          !!t &&
          typeof (t as EaseToken).name === 'string' &&
          Array.isArray((t as EaseToken).bez) &&
          (t as EaseToken).bez.length === 4 &&
          (t as EaseToken).bez.every((v) => typeof v === 'number' && Number.isFinite(v)),
      )
      .slice(0, MAX)
  } catch {
    return []
  }
}

export function saveEaseTokens(tokens: EaseToken[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tokens.slice(0, MAX)))
  } catch {
    // 용량 초과 — 토큰은 편의 기능이라 조용히 무시
  }
}
