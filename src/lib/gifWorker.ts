// GIF 인코딩 워커 — 양자화/팔레트/인코딩을 메인 스레드 밖에서 (UI 프리즈 방지).
import { GIFEncoder, quantize, applyPalette, type GifEncoderInst } from 'gifenc'

let enc: GifEncoderInst = GIFEncoder()

self.onmessage = (e: MessageEvent) => {
  const m = e.data as
    | { type: 'frame'; data: ArrayBuffer; w: number; h: number; delay: number }
    | { type: 'finish' }
  if (m.type === 'frame') {
    const data = new Uint8ClampedArray(m.data)
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    enc.writeFrame(index, m.w, m.h, { palette, delay: m.delay })
    ;(self as unknown as Worker).postMessage({ type: 'ack' })
  } else {
    enc.finish()
    const bytes = enc.bytes()
    ;(self as unknown as Worker).postMessage({ type: 'done', bytes }, [bytes.buffer as ArrayBuffer])
    enc = GIFEncoder()
  }
}
