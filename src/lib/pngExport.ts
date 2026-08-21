// PNG 내보내기 — 현재 프레임 1장 또는 전체 시퀀스 zip.
// GIF와 같은 캔버스 렌더러 재사용 (goToAndStop — 프레임 정확).
import type { LottieJson } from './lottieUtils'
import { buildZip } from './dotlottie'
import { t } from './i18n'

async function withCanvasItem<T>(
  anim: LottieJson,
  scale: number,
  fn: (draw: (frame: number) => void, canvas: HTMLCanvasElement) => Promise<T>,
): Promise<T> {
  const { default: lottie } = await import('lottie-web/build/player/lottie_canvas')
  const w = Math.round(anim.w * scale)
  const h = Math.round(anim.h * scale)
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;'
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  holder.appendChild(canvas)
  document.body.appendChild(holder)
  const ctx = canvas.getContext('2d')
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
    const draw = (frame: number) => {
      ctx.clearRect(0, 0, w, h) // PNG는 알파 유지 — 배경 안 깐다
      item.goToAndStop(frame, true)
    }
    return await fn(draw, canvas)
  } finally {
    try {
      item.destroy()
    } catch {
      // 이미 파괴됨 — 무시
    }
    holder.remove()
  }
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 실패'))), 'image/png'),
  )
}

/** 현재 프레임 1장 (알파 투명 유지). */
export async function exportFramePng(
  anim: LottieJson,
  frame: number,
  scale = 2,
): Promise<Blob> {
  return withCanvasItem(anim, scale, async (draw, canvas) => {
    draw(frame)
    return canvasPng(canvas)
  })
}

/** 전체 프레임 시퀀스 → zip (frame_0001.png …). fps 기본 30. */
export async function exportPngSequence(
  anim: LottieJson,
  opts: { fps?: number; scale?: number; onProgress?: (f: number) => void },
): Promise<Blob> {
  const fps = Math.max(1, Math.min(60, opts.fps ?? 30))
  const totalF = Math.max(1, anim.op - anim.ip)
  const frames = Math.max(1, Math.round((totalF / anim.fr) * fps))
  return withCanvasItem(anim, opts.scale ?? 1, async (draw, canvas) => {
    const files: { name: string; data: Uint8Array }[] = []
    for (let i = 0; i < frames; i++) {
      draw(anim.ip + (i / frames) * totalF)
      const blob = await canvasPng(canvas)
      files.push({
        name: `frame_${String(i + 1).padStart(4, '0')}.png`,
        data: new Uint8Array(await blob.arrayBuffer()),
      })
      opts.onProgress?.((i + 1) / frames)
      await new Promise((r) => setTimeout(r, 0))
    }
    return buildZip(files)
  })
}
