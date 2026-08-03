// 숫자 입력 필드 산술 지원 — Lottie Creator 2.0 벤치.
// "100+50" 같은 완전식, "+10" "*2" "/4" 처럼 연산자로 시작하면 현재값 기준 상대 계산.

/** 안전한 사칙연산 평가 — 숫자·공백·사칙연산 기호·괄호만 허용, 실패 시 null. */
export function evalNumExpr(raw: string, current: number): number | null {
  let s = raw.trim().replace(/,/g, '')
  if (!s) return null
  // 연산자로 시작 → 현재값에 적용 ("+10" = current+10, "/4" = current/4).
  // 단독 음수("-12")는 절대값 입력으로 취급
  if (/^[+*/]/.test(s) || (/^-/.test(s) && /[+\-*/]/.test(s.slice(1)))) {
    s = `(${current})${s}`
  }
  if (!/^[\d\s+\-*/().%]+$/.test(s)) return null
  try {
    // eslint-disable-next-line no-new-func
    const v = new Function(`"use strict"; return (${s})`)() as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}
