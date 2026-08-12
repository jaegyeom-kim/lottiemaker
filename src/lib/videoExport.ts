// WebM 영상 내보내기 — lottie-web 캔버스 렌더 → captureStream → MediaRecorder.
// 실시간 1패스 녹화 (컴포지션 길이만큼). 알파는 WebM 녹화에서 미지원이라 배경색을 깐다.
// 캔버스 렌더러 빌드는 내보낼 때만 지연 로드 — 초기 번들에서 제외.
import type { LottieJson } from './lottieUtils'
import { t } from './i18n'

export function webmSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    (MediaRecorder.isTypeSupported?.('video/webm;codecs=vp9') ||
      MediaRecorder.isTypeSupported?.('video/webm'))
  )
}

/**
 * anim을 재생하며 WebM으로 녹화한다. scale로 해상도 배율 (기본 2x — 512→1024).
 * onProgress는 0~1 진행률.
 */
export async function exportWebM(
  anim: LottieJson,
  opts: { bg: string; scale?: number; onProgress?: (f: number) => void },
): Promise<Blob> {
  const lottie = (await import('lottie-web/build/player/lottie_canvas')).default
  return new Promise((resolve, reject) => {
    if (!webmSupported()) {
      reject(new Error(t('이 브라우저는 WebM 녹화를 지원하지 않습니다 (Chrome/Edge 권장)')))
      return
    }
    const scale = opts.scale ?? 2
    const w = Math.round(anim.w * scale)
    const h = Math.round(anim.h * scale)
    const durMs = ((anim.op - anim.ip) / anim.fr) * 1000

    // lottie가 그리는 캔버스(A) + 배경 깔고 합성해 녹화하는 캔버스(B)
    const holder = document.createElement('div')
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;'
    const canvasA = document.createElement('canvas')
    canvasA.width = w
    canvasA.height = h
    const canvasB = document.createElement('canvas')
    canvasB.width = w
    canvasB.height = h
    holder.appendChild(canvasA)
    holder.appendChild(canvasB)
    document.body.appendChild(holder)
    const ctxA = canvasA.getContext('2d')
    const ctxB = canvasB.getContext('2d')
    if (!ctxA || !ctxB) {
      holder.remove()
      reject(new Error(t('캔버스 컨텍스트 생성 실패')))
      return
    }

    const item = lottie.loadAnimation({
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData: structuredClone(anim),
      rendererSettings: {
        context: ctxA,
        clearCanvas: true,
        preserveAspectRatio: 'xMidYMid meet',
      },
    } as Parameters<typeof lottie.loadAnimation>[0])

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    const stream = canvasB.captureStream(60)
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    const parts: BlobPart[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data)
    }

    let raf = 0
    let done = false
    const cleanup = () => {
      cancelAnimationFrame(raf)
      try {
        item.destroy()
      } catch {
        // 이미 파괴됨 — 무시
      }
      holder.remove()
    }
    const finish = () => {
      if (done) return
      done = true
      rec.onstop = () => {
        cleanup()
        resolve(new Blob(parts, { type: 'video/webm' }))
      }
      // 마지막 프레임이 인코더에 들어가도록 살짝 늦게 정지
      setTimeout(() => rec.stop(), 120)
    }
    const fail = (msg: string) => {
      if (done) return
      done = true
      try {
        rec.stop()
      } catch {
        // 시작 전 정지 — 무시
      }
      cleanup()
      reject(new Error(msg))
    }

    // 합성 루프 — 배경 → lottie 캔버스
    const draw = () => {
      ctxB.fillStyle = opts.bg
      ctxB.fillRect(0, 0, w, h)
      ctxB.drawImage(canvasA, 0, 0)
      raf = requestAnimationFrame(draw)
    }

    const timeout = setTimeout(() => fail(t('녹화 시간 초과 — 다시 시도해보세요')), durMs + 15000)

    item.addEventListener('DOMLoaded', () => {
      draw()
      rec.start(250)
      const t0 = performance.now()
      const tick = () => {
        if (done) return
        opts.onProgress?.(Math.min(1, (performance.now() - t0) / durMs))
        if (performance.now() - t0 < durMs + 400) requestAnimationFrame(tick)
      }
      tick()
      item.play()
    })
    item.addEventListener('complete', () => {
      clearTimeout(timeout)
      opts.onProgress?.(1)
      finish()
    })
    item.addEventListener('data_failed', () => {
      clearTimeout(timeout)
      fail(t('애니메이션 로드 실패'))
    })
  })
}
