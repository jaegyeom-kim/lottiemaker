import { useRef } from 'react'

/** 앵커 직접 조작 패드 — 이미지(또는 비율 박스) 위에서 클릭/드래그로 기준점 지정. */
export default function AnchorPad({
  dataUri,
  aspect,
  frac,
  onLive,
  onCommit,
  maxH = 180,
}: {
  /** 미리보기 이미지 — 없으면 비율만 가진 빈 패드 (컴프/씬/SVG). */
  dataUri?: string
  aspect: number
  frac: [number, number]
  onLive: (fx: number, fy: number) => void
  onCommit: () => void
  /** 패드 최대 높이 px — 레이아웃에 맞게 축소. */
  maxH?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const setFrom = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    onLive(fx, fy)
  }

  return (
    <div
      ref={ref}
      className={`anchorpad ${dataUri ? '' : 'anchorpad--empty'}`}
      // 세로로 긴 이미지는 maxH 기준으로 폭 축소 — 레터박스 없이 패드 = 이미지 영역
      style={{ aspectRatio: String(aspect), width: `min(100%, ${Math.round(maxH * aspect)}px)`, maxHeight: maxH }}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        setFrom(e)
      }}
      onPointerMove={(e) => {
        if (dragging.current) setFrom(e)
      }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        onCommit()
      }}
      onPointerCancel={() => {
        dragging.current = false
        onCommit()
      }}
    >
      {dataUri && <img src={dataUri} alt="" draggable={false} />}
      <div className="anchorpad__hline" style={{ top: `${frac[1] * 100}%` }} />
      <div className="anchorpad__vline" style={{ left: `${frac[0] * 100}%` }} />
      <div
        className="anchorpad__dot"
        style={{ left: `${frac[0] * 100}%`, top: `${frac[1] * 100}%` }}
      />
    </div>
  )
}