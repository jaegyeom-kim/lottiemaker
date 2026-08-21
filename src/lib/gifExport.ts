// GIF 내보내기 — lottie-web 캔버스 렌더 → 프레임 스텝 → gifenc 인코딩.
// WebM과 달리 실시간 재생이 아니라 goToAndStop으로 프레임을 정확히 뽑는다 (드랍 없음).
// 캔버스 렌더러·gifenc는 내보낼 때만 지연 로드 — 초기 번들에서 제외.
import type { LottieJson } from './lottieUtils'
import { t } from './i18n'

/**
 * GIF 인코딩. fps는 GIF 딜레이 정밀도(1/100s)에 맞춰 기본 30.
 * 알파 미지원 포맷이라 배경색을 깐다. onProgress 0~1.
 */
export async function exportGif(
  anim: LottieJson,
  opts: { bg: string; scale?: number; fps?: number; onProgress?: (f: number) => void },
): Promise<Blob> {
  const [{ default: lottie }, gif] = await Promise.all([
    import('lottie-web/build/player/lottie_canvas'),
    import('gifenc'),
  ])
  // 인코딩은 워커에서 (프레임당 수십 ms 양자화가 메인 스레드를 막지 않게) — 실패 시 인라인 폴백
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  const scale = opts.scale ?? 1
  const fps = Math.max(5, Math.min(50, opts.fps ?? 30))
  const w = Math.round(anim.w * scale)
  const h = Math.round(anim.h * scale)
  const totalF = Math.max(1, anim.op - anim.ip)
  const frames = Math.max(1, Math.round((totalF / anim.fr) * fps))

  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;'
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  holder.appendChild(canvas)
  document.body.appendChild(holder)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    holder.remove()
    throw new Error(t('캔버스 컨텍스트 생성 실패'))
  }

  const item = lottie.loadAnimation({
    renderer: 'canvas',
    loop: false,
    autoplay: false,
    animationData: structuredClone(anim),
    rendererSettings: { context: ctx, clearCanvas: false, preserveAspectRatio: 'xMidYMid meet' },
  } as Parameters<typeof lottie.loadAnimation>[0])

  try {
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error(t('애니메이션 로드 실패'))), 10000)
      item.addEventListener('DOMLoaded', () => {
        clearTimeout(to)
        resolve()
      })
      item.addEventListener('data_failed', () => {
        clearTimeout(to)
        reject(new Error(t('애니메이션 로드 실패')))
      })
    })

    const delay = Math.round(1000 / fps)
    const enc = worker ? null : gif.GIFEncoder()
    for (let i = 0; i < frames; i++) {
      const f = anim.ip + (i / frames) * totalF
      // 배경 → 프레임 렌더 (clearCanvas:false — 직접 지우고 깐다)
      ctx.fillStyle = opts.bg
      ctx.fillRect(0, 0, w, h)
      item.goToAndStop(f, true)
      const { data } = ctx.getImageData(0, 0, w, h)
      if (worker) {
        // 픽셀 버퍼 transferable 전송 + ack 백프레셔
        const buf = data.buffer as ArrayBuffer
        await new Promise<void>((resolve, reject) => {
          worker!.onmessage = () => resolve()
          worker!.onerror = (err) => reject(err)
          worker!.postMessage({ type: 'frame', data: buf, w, h, delay }, [buf])
        })
      } else {
        const palette = gif.quantize(data, 256)
        const index = gif.applyPalette(data, palette)
        enc!.writeFrame(index, w, h, { palette, delay })
        await new Promise((r) => setTimeout(r, 0))
      }
      opts.onProgress?.((i + 1) / frames)
    }
    if (worker) {
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        worker!.onmessage = (e) => {
          if ((e.data as { type?: string }).type === 'done')
            resolve((e.data as { bytes: Uint8Array }).bytes)
        }
        worker!.onerror = (err) => reject(err)
        worker!.postMessage({ type: 'finish' })
      })
      worker.terminate()
      return new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'image/gif' })
    }
    enc!.finish()
    const bytes = enc!.bytes()
    // Uint8Array<ArrayBufferLike> → BlobPart 호환 사본
    return new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'image/gif' })
  } finally {
    worker?.terminate()
    try {
      item.destroy()
    } catch {
      // 이미 파괴됨 — 무시
    }
    holder.remove()
  }
}
