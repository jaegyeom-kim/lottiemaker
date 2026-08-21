// dotLottie(.lottie) 내보내기 — Lottie JSON을 zip(manifest + animations/)으로 패키징.
// 외부 의존성 없이 zip을 직접 쓴다. 압축은 CompressionStream(deflate-raw) 지원 시 적용,
// 미지원 브라우저에선 무압축(stored)으로 폴백 — 어느 쪽이든 표준 zip이라 모든 플레이어가 읽는다.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function deflateRaw(data: Uint8Array): Promise<{ bytes: Uint8Array; method: number }> {
  if (typeof CompressionStream === 'undefined') return { bytes: data, method: 0 }
  try {
    const cs = new CompressionStream('deflate-raw')
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs)
    const buf = await new Response(stream).arrayBuffer()
    return { bytes: new Uint8Array(buf), method: 8 }
  } catch {
    return { bytes: data, method: 0 }
  }
}

interface ZipEntry {
  name: string
  raw: Uint8Array
  comp: Uint8Array
  method: number
  crc: number
  offset: number
}

/** 표준 zip 생성 — local file headers + central directory + EOCD. */
export async function buildZip(files: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const enc = new TextEncoder()
  const entries: ZipEntry[] = []
  const chunks: Uint8Array[] = []
  let offset = 0
  const push = (u8: Uint8Array) => {
    chunks.push(u8)
    offset += u8.length
  }
  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff])
  const u32 = (v: number) =>
    new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])

  for (const f of files) {
    const { bytes, method } = await deflateRaw(f.data)
    const crc = crc32(f.data)
    const nameBytes = enc.encode(f.name)
    const entry: ZipEntry = { name: f.name, raw: f.data, comp: bytes, method, crc, offset }
    // Local file header
    push(u32(0x04034b50))
    push(u16(20)) // version needed
    push(u16(0x0800)) // UTF-8 이름 플래그
    push(u16(method))
    push(u16(0)) // time
    push(u16(0x21)) // date (임의 고정 — 결정적 출력)
    push(u32(crc))
    push(u32(bytes.length))
    push(u32(f.data.length))
    push(u16(nameBytes.length))
    push(u16(0)) // extra len
    push(nameBytes)
    push(bytes)
    entries.push(entry)
  }

  const cdStart = offset
  for (const e of entries) {
    const nameBytes = enc.encode(e.name)
    push(u32(0x02014b50))
    push(u16(20)) // version made by
    push(u16(20)) // version needed
    push(u16(0x0800))
    push(u16(e.method))
    push(u16(0))
    push(u16(0x21))
    push(u32(e.crc))
    push(u32(e.comp.length))
    push(u32(e.raw.length))
    push(u16(nameBytes.length))
    push(u16(0)) // extra
    push(u16(0)) // comment
    push(u16(0)) // disk
    push(u16(0)) // internal attrs
    push(u32(0)) // external attrs
    push(u32(e.offset))
    push(nameBytes)
  }
  const cdSize = offset - cdStart
  push(u32(0x06054b50))
  push(u16(0))
  push(u16(0))
  push(u16(entries.length))
  push(u16(entries.length))
  push(u32(cdSize))
  push(u32(cdStart))
  push(u16(0))

  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}

/** Lottie JSON → dotLottie(.lottie) Blob. */
export async function buildDotLottie(anim: object): Promise<Blob> {
  const enc = new TextEncoder()
  const manifest = {
    version: '1',
    generator: 'LottieMaker',
    author: 'LottieMaker',
    animations: [
      { id: 'animation', autoplay: true, loop: true, speed: 1, direction: 1, mode: 'normal' },
    ],
  }
  return buildZip([
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) },
    { name: 'animations/animation.json', data: enc.encode(JSON.stringify(anim)) },
  ])
}

/** dotLottie(.lottie) 읽기 — zip에서 첫 애니메이션 JSON 추출. 실패 시 null. */
export async function readDotLottie(buf: ArrayBuffer): Promise<Record<string, unknown> | null> {
  try {
    const b = new Uint8Array(buf)
    const dv = new DataView(buf)
    let eocd = -1
    for (let i = b.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) return null
    const count = dv.getUint16(eocd + 10, true)
    let off = dv.getUint32(eocd + 16, true)
    const entries: { name: string; method: number; csize: number; lho: number }[] = []
    const td = new TextDecoder()
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break
      const method = dv.getUint16(off + 10, true)
      const csize = dv.getUint32(off + 20, true)
      const nameLen = dv.getUint16(off + 28, true)
      const extraLen = dv.getUint16(off + 30, true)
      const cmtLen = dv.getUint16(off + 32, true)
      const lho = dv.getUint32(off + 42, true)
      entries.push({ name: td.decode(b.subarray(off + 46, off + 46 + nameLen)), method, csize, lho })
      off += 46 + nameLen + extraLen + cmtLen
    }
    const entry =
      entries.find((e) => /^animations\/.+\.json$/i.test(e.name)) ??
      entries.find((e) => e.name.endsWith('.json') && !/manifest\.json$/i.test(e.name))
    if (!entry) return null
    const nl = dv.getUint16(entry.lho + 26, true)
    const xl = dv.getUint16(entry.lho + 28, true)
    const start = entry.lho + 30 + nl + xl
    const data = b.subarray(start, start + entry.csize)
    let jsonBytes: Uint8Array = data
    if (entry.method === 8) {
      const ds = new DecompressionStream('deflate-raw')
      jsonBytes = new Uint8Array(
        await new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer(),
      )
    } else if (entry.method !== 0) {
      return null
    }
    return JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Blob 다운로드 트리거. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
