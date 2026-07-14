import { useEffect, useRef } from 'react'
import lottie, { type AnimationItem } from 'lottie-web'

interface Props {
  data: unknown
  playing?: boolean
  speed?: number
  loop?: boolean
  className?: string
  onFrame?: (frame: number, total: number) => void
  seekFrame?: number | null
  /** 값이 바뀔 때마다 0프레임부터 재생. */
  replayToken?: number
  /** loop=false 재생이 끝났을 때 호출. */
  onComplete?: () => void
}

/** lottie-web 래퍼. data가 바뀌면 인스턴스를 재생성한다. */
export default function LottiePlayer({
  data,
  playing = true,
  speed = 1,
  loop = true,
  className,
  onFrame,
  seekFrame = null,
  replayToken,
  onComplete,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)
  // 파킹 프레임 — 일시정지 중 데이터가 바뀌어도(편집) 현재 프레임 유지 (AE 방식)
  const lastFrameRef = useRef(0)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!containerRef.current || !data) return
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop,
      autoplay: playing,
      // lottie-web은 데이터를 변형하므로 복제본 전달
      animationData: structuredClone(data),
    })
    anim.setSpeed(speed)
    // 일시정지 상태 재생성 → 직전 파킹 프레임 복원 (편집 결과를 그 시점 기준으로 표시)
    if (!playing && lastFrameRef.current > 0) {
      anim.goToAndStop(Math.min(lastFrameRef.current, Math.max(0, anim.totalFrames - 1)), true)
    }
    const handler = () => {
      lastFrameRef.current = anim.currentFrame
      onFrameRef.current?.(anim.currentFrame, anim.totalFrames)
    }
    // 일시정지 상태로 생성돼도 totalFrames를 즉시 보고 — 스크럽/타임라인이 죽지 않게
    const ready = () => {
      onFrameRef.current?.(anim.currentFrame, anim.totalFrames)
    }
    anim.addEventListener('DOMLoaded', ready)
    const completeHandler = () => {
      onCompleteRef.current?.()
    }
    anim.addEventListener('enterFrame', handler)
    anim.addEventListener('complete', completeHandler)
    animRef.current = anim
    return () => {
      anim.removeEventListener('enterFrame', handler)
      anim.removeEventListener('DOMLoaded', ready)
      anim.removeEventListener('complete', completeHandler)
      anim.destroy()
      animRef.current = null
    }
    // playing/speed/loop 변경은 아래 이펙트에서 인스턴스 재생성 없이 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    const anim = animRef.current
    if (!anim) return
    if (playing) anim.play()
    else anim.pause()
  }, [playing])

  useEffect(() => {
    const anim = animRef.current
    if (!anim) return
    anim.loop = loop
    // 루프 꺼진 채 끝까지 간 뒤 다시 켜면 재생 재개
    if (loop && playing) anim.play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop])

  useEffect(() => {
    animRef.current?.setSpeed(speed)
  }, [speed])

  useEffect(() => {
    const anim = animRef.current
    if (!anim || seekFrame === null) return
    anim.goToAndStop(seekFrame, true)
    lastFrameRef.current = seekFrame
    onFrameRef.current?.(seekFrame, anim.totalFrames)
  }, [seekFrame])

  useEffect(() => {
    if (replayToken === undefined || replayToken === 0) return
    animRef.current?.goToAndPlay(0, true)
  }, [replayToken])

  return <div ref={containerRef} className={className} />
}
