// store 유닛 테스트 — rolldown으로 src/store.ts를 번들해 node에서 직접 구동.
// 실행: npm run test:unit
import { rolldown } from 'rolldown'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// ── 브라우저 전역 스텁 (store 의존 체인: localStorage, document.documentElement.lang) ──
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
globalThis.document = { documentElement: { lang: 'ko' }, createElement: () => ({}) }

const bundle = await rolldown({
  input: path.join(ROOT, 'src', 'store.ts'),
  logLevel: 'silent',
})
const { output } = await bundle.generate({ format: 'esm' })
const tmp = path.join(os.tmpdir(), `lm-store-${process.pid}.mjs`)
fs.writeFileSync(tmp, output[0].code)
const { useEditor } = await import(tmp)
fs.unlinkSync(tmp)

let failed = 0
const ok = (c, m) => {
  if (c) console.log('✓', m)
  else {
    failed++
    console.error('✗', m)
  }
}
const S = () => useEditor.getState()

// 매트 쌍(td/tt/tp) + 부모 참조가 있는 최소 로티 문서
const matteDoc = (tag) => ({
  v: '5.7.0', fr: 60, ip: 0, op: 60, w: 512, h: 512, nm: tag,
  assets: [],
  layers: [
    {
      ty: 4, ind: 1, nm: `${tag}-matte-src`, td: 1, ks: {}, ip: 0, op: 60, st: 0, sr: 1,
      shapes: [{ ty: 'gr', it: [{ ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } }, { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 }, { ty: 'tr', p: { a: 0, k: [256, 256] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }],
    },
    {
      ty: 4, ind: 2, nm: `${tag}-matted`, tt: 1, tp: 1, parent: 1, ks: {}, ip: 0, op: 60, st: 0, sr: 1,
      shapes: [{ ty: 'gr', it: [{ ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [80, 80] }, r: { a: 0, k: 0 } }, { ty: 'fl', c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 }, r: 1 }, { ty: 'tr', p: { a: 0, k: [256, 256] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }],
    },
  ],
})

// ── 1) 임포트 2회 — 그룹별 tp/parent 재매핑 (ind 공간 충돌) ──
S().importLottieLayers(matteDoc('A'))
S().importLottieLayers(matteDoc('B'))
{
  const layers = S().sourceData.layers
  ok(layers.length === 4, `임포트 2회 → 레이어 4 (${layers.length})`)
  const byNm = (nm) => layers.find((l) => String(l.nm).includes(nm))
  const bSrc = byNm('B-matte-src')
  const bMat = byNm('B-matted')
  const aSrc = byNm('A-matte-src')
  const aMat = byNm('A-matted')
  ok(new Set(layers.map((l) => l.ind)).size === 4, 'ind 전부 고유')
  ok(bMat?.tp === bSrc?.ind, `B매트 tp → B소스 (tp=${bMat?.tp}, src.ind=${bSrc?.ind})`)
  ok(aMat?.tp === aSrc?.ind, `A매트 tp → A소스 (tp=${aMat?.tp}, src.ind=${aSrc?.ind})`)
  // parent는 임포터가 트랜스폼으로 베이크(평탄화)하므로 임포트 후엔 없음 — tp만 검증
  ok(aMat?.tp !== bMat?.tp, '두 그룹 tp가 서로 다른 대상')
}

// ── 2) duplicatePattern — 복제 후 원본 매트 체인 유지 ──
{
  const before = S().sourceData.layers
  const matIdx = before.findIndex((l) => String(l.nm).includes('A-matted'))
  const srcIdx = before.findIndex((l) => String(l.nm).includes('A-matte-src'))
  // store 레벨 parent — 복제 시 재매핑 대상
  S().setLayerParent(matIdx, srcIdx)
  useEditor.setState({ customIdx: matIdx, customIdxs: [matIdx] })
  S().duplicatePattern(3, 20, 0, 0, 0, 100, 100)
  const layers = S().sourceData.layers
  ok(layers.length === 6, `패턴 복제 3개 → 레이어 6 (${layers.length})`)
  ok(new Set(layers.map((l) => l.ind)).size === layers.length, '복제 후 ind 전부 고유')
  const aSrc = layers.find((l) => String(l.nm).includes('A-matte-src'))
  const matted = layers.filter((l) => typeof l.tp === 'number' && String(l.nm).includes('A-matted'))
  ok(matted.length === 3, `A-matted 계열 3개 (${matted.length})`)
  ok(matted.every((l) => l.tp === aSrc.ind), `복제본 tp 전부 A소스 폴백 (${matted.map((l) => l.tp)})`)
  ok(matted.every((l) => l.parent === aSrc.ind), `복제본 parent 전부 A소스 폴백 (${matted.map((l) => l.parent)})`)
  const bMat = layers.find((l) => String(l.nm).includes('B-matted'))
  const bSrc = layers.find((l) => String(l.nm).includes('B-matte-src'))
  ok(bMat.tp === bSrc.ind, '무관한 B 매트 체인 무손상')
  S().undo()
  S().undo() // 복제 + parent 설정 둘 다 되돌림
  ok(S().sourceData.layers.length === 4, '언두 → 복제 전')
}

// ── 3) setCompLengthLive — 클램프 병합 시 채널 값 보존 ──
{
  const layers = S().sourceData.layers
  const li = 0
  const l = layers[li]
  l.xkf = { on: true, keys: [{ t: 0, o: 0 }, { t: 100, r: 90 }, { t: 110, o: 100 }] }
  useEditor.setState({ sourceData: { ...S().sourceData } })
  S().setCompLengthLive(100 / 60) // op=100 → t=110 키가 100으로 클램프, r키와 병합돼야 함
  S().commitEdit()
  const kf = S().sourceData.layers[li].xkf
  const at100 = kf.keys.find((k) => Math.abs(k.t - 100) < 0.5)
  ok(kf.keys.length === 2, `클램프 병합 후 키 2개 (${kf.keys.length})`)
  ok(at100?.r === 90 && at100?.o === 100, `병합 키에 r·o 모두 보존 (r=${at100?.r}, o=${at100?.o})`)
}

// ── 4) xlock — store 레벨 강제 (UI 우회 차단) ──
{
  const li = 0
  const before = structuredClone(S().sourceData.layers[li])
  S().toggleLayerLock(li)
  ok(S().sourceData.layers[li].xlock === true, '잠금 설정')

  S().renameLayer(li, '변경시도')
  ok(S().sourceData.layers[li].nm === before.nm, '잠금: rename 차단')

  const n0 = S().sourceData.layers.length
  S().removeCustomLayers([li])
  ok(S().sourceData.layers.length === n0, '잠금: 삭제 차단')

  useEditor.setState({ customIdx: li, customIdxs: [li] })
  const base0 = [...S().sourceData.layers[li].xbase]
  S().nudgeCustomBase(50, 0)
  const base1 = S().sourceData.layers[li].xbase
  ok(base1[0] === base0[0] && base1[1] === base0[1], '잠금: 이동 차단')

  const keys0 = JSON.stringify(S().sourceData.layers[li].xkf?.keys ?? [])
  S().setKfChannel('r', 10, 45)
  ok(JSON.stringify(S().sourceData.layers[li].xkf?.keys ?? []) === keys0, '잠금: 키프레임 편집 차단')

  S().setLayerMatte(li, { type: 'alpha', invert: false, sourceLi: 1 })
  ok(S().sourceData.layers[li].tt === undefined, '잠금: 매트 설정 차단')

  S().toggleLayerLock(li)
  ok(S().sourceData.layers[li].xlock !== true, '잠금 해제')
  S().renameLayer(li, '해제후변경')
  ok(S().sourceData.layers[li].nm === '해제후변경', '해제 후 rename 동작')
}

console.log(failed ? `STORE FAIL ${failed}` : 'STORE PASS')
process.exit(failed ? 1 : 0)
