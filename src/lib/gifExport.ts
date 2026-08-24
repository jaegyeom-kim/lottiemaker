// GIF 내보내기 — 캔버스 렌더(goToAndStop, 프레임 정확) → 워커에서 gifenc 인코딩.
// 스캐폴드는 pngExport의 withCanvasItem 공용, 양자화는 워커 전담 (메인 스레드 안 막음).
import type { LottieJson } from './lottieUtils'
import { withCanvasItem } from './pngExport'

/** GIF 인코딩 — 30fps 고정 (GIF 딜레이 정밀도 1/100s), 배경색 필수(알파 미지원). */
export async function exportGif(
  anim: LottieJson,
  opts: { bg: string; onProgress?: (f: number) => void },
): Promise<Blob> {
  const worker = new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' })
  const fps = 30
  const totalF = Math.max(1, anim.op - anim.ip)
  const frames = Math.max(1, Math.round((totalF / anim.fr) * fps))
  const delay = Math.round(1000 / fps)
  try {
    return await withCanvasItem(
      anim,
      1,
      async (draw, canvas, ctx) => {
        const w = canvas.width
        const h = canvas.height
        for (let i = 0; i < frames; i++) {
          draw(anim.ip + (i / frames) * totalF)
          const { data } = ctx.getImageData(0, 0, w, h)
          // 픽셀 버퍼 transferable 전송 + ack 백프레셔
          const buf = data.buffer as ArrayBuffer
          await new Promise<void>((resolve, reject) => {
            worker.onmessage = () => resolve()
            worker.onerror = (err) => reject(err)
            worker.postMessage({ type: 'frame', data: buf, w, h, delay }, [buf])
          })
          opts.onProgress?.((i + 1) / frames)
        }
        const bytes = await new Promise<Uint8Array>((resolve, reject) => {
          worker.onmessage = (e) => {
            if ((e.data as { type?: string }).type === 'done')
              resolve((e.data as { bytes: Uint8Array }).bytes)
          }
          worker.onerror = (err) => reject(err)
          worker.postMessage({ type: 'finish' })
        })
        return new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'image/gif' })
      },
      opts.bg,
    )
  } finally {
    worker.terminate()
  }
}
