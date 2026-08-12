// E2E 러너 — dev 서버가 없으면 자동 기동, *.test.mjs 순차 실행, 결과 요약.
// 사용: npm run test:e2e [-- 파일명필터]
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const BASE_URL = process.env.LM_BASE_URL ?? 'http://localhost:5173/'

async function serverUp() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false
    // 포트를 다른 앱이 차지한 경우 오탐 방지 — 우리 앱 마커 확인
    const html = await res.text()
    return html.includes('LottieMaker') || html.includes('/@vite/client')
  } catch {
    return false
  }
}

let devProc = null
if (!(await serverUp())) {
  console.log('· dev 서버 기동 중…')
  devProc = spawn('npm', ['run', 'dev'], { cwd: ROOT, stdio: 'ignore', detached: false })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (await serverUp()) break
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!(await serverUp())) {
    console.error('✗ dev 서버 기동 실패 (30s)')
    devProc.kill()
    process.exit(1)
  }
}

const filter = process.argv[2]
const files = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs') && (!filter || f.includes(filter)))
  .sort()

// 러너가 죽어도 자동 기동한 dev 서버는 정리
const cleanup = () => {
  if (devProc && !devProc.killed) devProc.kill()
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('SIGTERM', () => { cleanup(); process.exit(143) })
process.on('exit', cleanup)

let failed = 0
try {
  for (const f of files) {
    console.log(`\n── ${f} ──`)
    try {
      execFileSync(process.execPath, [path.join(HERE, f)], { stdio: 'inherit', timeout: 120000 })
    } catch {
      failed++
    }
  }
} finally {
  cleanup()
}
console.log(`\n${files.length}본 중 ${files.length - failed} 통과${failed ? ` · ${failed} 실패` : ''}`)
process.exit(failed ? 1 : 0)
