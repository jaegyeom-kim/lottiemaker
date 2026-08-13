import { useEffect, useRef } from 'react'
// svg 전용 빌드 — 캔버스/HTML 렌더러 제외 (표현식은 포함, 임포트 문서 호환 유지)
import type React from 'react'
import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_svg'

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
  /** 라이브 인스턴스 노출 — 드래그 오버레이(재구축 없는 이동 미리보기)용. */
  instRef?: React.MutableRefObject<AnimationItem | null>
}

/** lottie-web 래퍼. data가 바뀌면 인스턴스를 재생성한다. */
/** 솔로(xsolo) 적용 — 켜진 레이어가 있으면 나머지를 숨김. 프리뷰 전용 (내보내기 미반영). */
function applySolo<T extends { layers?: Record<string, unknown>[] }>(data: T): T {
  const layers = data.layers
  if (!layers?.some((l) => l.xsolo === true)) return data
  for (const l of layers) if (l.xsolo !== true) l.hd = true
  return data
}

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
  instRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)
  // 파킹 프레임 — 일시정지 중 데이터가 바뀌어도(편집) 현재 프레임 유지 (AE 방식)
  const lastFrameRef = useRef(0)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  // 트레일링 재초기화용 최신 프롭 — 스로틀 후 실행 시점의 값 사용
  const playingRef = useRef(playing)
  playingRef.current = playing
  const speedRef = useRef(speed)
  speedRef.current = speed
  const loopRef = useRef(loop)
  loopRef.current = loop
  const lastInitRef = useRef(0)
  const destroyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!containerRef.current || !data) return
    const createAnim = () => {
      const container = containerRef.current
      if (!container) return
      const anim = lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: loopRef.current,
        autoplay: playingRef.current,
        // lottie-web은 데이터를 변형하므로 복제본 전달
        animationData: applySolo(structuredClone(data)),
      })
      anim.setSpeed(speedRef.current)
      // 일시정지 상태 재생성 → 직전 파킹 프레임 복원 (편집 결과를 그 시점 기준으로 표시)
      if (!playingRef.current && lastFrameRef.current > 0) {
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
      if (instRef) instRef.current = anim
      destroyRef.current = () => {
        anim.removeEventListener('enterFrame', handler)
        anim.removeEventListener('DOMLoaded', ready)
        anim.removeEventListener('complete', completeHandler)
        anim.destroy()
        animRef.current = null
        if (instRef && instRef.current === anim) instRef.current = null
        destroyRef.current = null
      }
    }
    // 라이브 편집 폭주 방어 — 재초기화(SVG 트리 재구축)를 40ms 간격으로 스로틀 (트레일링 보장)
    const MIN = 40
    const since = performance.now() - lastInitRef.current
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = () => {
      lastInitRef.current = performance.now()
      destroyRef.current?.()
      createAnim()
    }
    if (since >= MIN) run()
    else timer = setTimeout(run, MIN - since)
    return () => {
      if (timer) clearTimeout(timer)
    }
    // playing/speed/loop 변경은 아래 이펙트에서 인스턴스 재생성 없이 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // 언마운트 시 인스턴스 정리 — 데이터 이펙트는 스로틀 때문에 파괴를 소유하지 않는다
  useEffect(() => () => destroyRef.current?.(), [])

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
