// dotLottie 유닛 테스트 — zip 안의 images/ 가 data URI로 인라인되는지 확인.
// 실행: node tests/unit/dotlottie.test.mjs
import { rolldown } from 'rolldown'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const bundle = await rolldown({ input: path.join(ROOT, 'src', 'lib', 'dotlottie.ts'), logLevel: 'silent' })
const { output } = await bundle.generate({ format: 'esm' })
const tmp = path.join(os.tmpdir(), `lm-dotlottie-${process.pid}.mjs`)
fs.writeFileSync(tmp, output[0].code)
let buildZip, readDotLottie
try {
  ;({ buildZip, readDotLottie } = await import(tmp))
} finally {
  fs.unlinkSync(tmp)
}

let failed = 0
const ok = (c, m) => {
  if (c) console.log('✓', m)
  else {
    failed++
    console.error('✗', m)
  }
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const anim = {
  v: '5.7.0', fr: 30, ip: 0, op: 30, w: 100, h: 100,
  assets: [{ id: 'image_0', w: 10, h: 10, u: 'images/', p: 'img_0.png', e: 0 }],
  layers: [{ ty: 2, refId: 'image_0', ip: 0, op: 30, st: 0, ks: {} }],
}
const zip = await buildZip([
  { name: 'manifest.json', data: new TextEncoder().encode('{"version":"1"}') },
  { name: 'animations/animation.json', data: new TextEncoder().encode(JSON.stringify(anim)) },
  { name: 'images/img_0.png', data: PNG },
])
const doc = await readDotLottie(await zip.arrayBuffer())
ok(!!doc, 'dotLottie 읽힘')
const a = doc?.assets?.[0]
ok(typeof a?.p === 'string' && a.p.startsWith('data:image/png;base64,'), 'zip 이미지가 data URI로 인라인됨')
ok(a?.u === '' && a?.e === 1, 'u 비우고 e=1 로 임베드 표시')
ok(Buffer.from(String(a?.p).split(',')[1], 'base64').equals(Buffer.from(PNG)), '이미지 바이트 보존')

process.exit(failed ? 1 : 0)
