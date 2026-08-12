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
    return res.ok
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

let failed = 0
for (const f of files) {
  console.log(`\n── ${f} ──`)
  try {
    execFileSync(process.execPath, [path.join(HERE, f)], { stdio: 'inherit', timeout: 120000 })
  } catch {
    failed++
  }
}

if (devProc) devProc.kill()
console.log(`\n${files.length}본 중 ${files.length - failed} 통과${failed ? ` · ${failed} 실패` : ''}`)
process.exit(failed ? 1 : 0)
