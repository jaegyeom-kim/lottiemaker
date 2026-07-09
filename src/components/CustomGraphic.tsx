import { useMemo, useRef, useState } from 'react'
import { useEditor } from '../store'
import { templates } from '../templates'
import type { LottieJson, LottieLayer } from '../lib/lottieUtils'
import { svgToLottie, wrapToFit, type ImportedGraphic } from '../lib/svgImport'
import LottiePlayer from './LottiePlayer'

/** 커스텀 그래픽(SVG) 교체 — 슬롯 드롭다운 + 업로드 미리보기 + 적용/되돌리기. */
export default function CustomGraphic() {
  const { templateId, animationData, applyGraphicToSlot, restoreSlot } = useEditor()
  const [slotIdx, setSlotIdx] = useState(0)
  const [pending, setPending] = useState<{ graphic: ImportedGraphic; name: string } | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const def = templates.find((t) => t.id === templateId)
  const slots = def?.swapSlots ?? []
  const slot = slots[Math.min(slotIdx, slots.length - 1)]

  // 미리보기용 1프레임 로티 (파싱 결과를 그대로 렌더 — 변환 손실 확인 가능)
  const previewData = useMemo(() => {
    if (!pending || !slot) return null
    return {
      v: '5.7.4', fr: 60, ip: 0, op: 1, w: 120, h: 120, nm: 'preview', ddd: 0, assets: [],
      layers: [{
        ddd: 0, ty: 4, ind: 1, nm: 'g', sr: 1,
        ks: {
          o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
          p: { a: 0, k: [60, 60, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] },
        },
        ao: 0, shapes: [wrapToFit(pending.graphic, 100)], ip: 0, op: 1, st: 0, bm: 0,
      }],
    }
  }, [pending, slot])

  if (!def || slots.length === 0 || !animationData || !slot) return null

  // 선택된 슬롯이 커스텀 상태인지
  const slotLayer = animationData.layers.find(
    (l) => typeof l.nm === 'string' && l.nm.startsWith(slot.match),
  ) as (LottieLayer & { shapes?: { nm?: string }[] }) | undefined
  const isCustom = slotLayer?.shapes?.[0]?.nm === 'Custom Graphic'

  const onFile = async (file: File) => {
    setError('')
    try {
      const graphic = svgToLottie(await file.text())
      setPending({ graphic, name: file.name })
    } catch (e) {
      setPending(null)
      setError((e as Error).message)
    }
  }

  const applyPending = () => {
    if (!pending) return
    applyGraphicToSlot(slot.match, wrapToFit(pending.graphic, slot.fit))
    setPending(null)
  }

  const reset = () => {
    const pristine = (def.data as LottieJson).layers
      .filter((l) => typeof l.nm === 'string' && l.nm.startsWith(slot.match))
      .reduce<Record<string, unknown[]>>((acc, l) => {
        acc[l.nm as string] = (l as Record<string, unknown>).shapes as unknown[]
        return acc
      }, {})
    restoreSlot(slot.match, pristine)
  }

  return (
    <div className="panel__section">
      <h3 className="panel__label">내 그래픽</h3>

      {slots.length > 1 && (
        <select
          className="input input--select"
          value={slotIdx}
          onChange={(e) => {
            setSlotIdx(Number(e.target.value))
            setPending(null)
          }}
        >
          {slots.map((s, i) => (
            <option key={s.match} value={i}>
              {s.label} 교체
            </option>
          ))}
        </select>
      )}

      <div
        className={`dropzone ${dragOver ? 'dropzone--over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
      >
        <span className="dropzone__icon">⬆</span>
        <span>
          SVG를 끌어다 놓거나 <u>클릭해서 선택</u>
        </span>
        <span className="panel__hint">→ {slot.label} 교체</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".svg,image/svg+xml"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />

      {pending && previewData && (
        <div className="graphicpreview">
          <LottiePlayer data={previewData} playing={false} seekFrame={0} className="graphicpreview__canvas" />
          <div className="graphicpreview__meta">
            <span className="graphicpreview__name">{pending.name}</span>
            <span className="panel__hint">→ {slot.label}에 적용됩니다</span>
            <div className="graphicpreview__actions">
              <button className="btn btn--primary" onClick={applyPending}>
                적용하기
              </button>
              <button className="btn btn--secondary" onClick={() => setPending(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {isCustom && !pending && (
        <button className="btn btn--secondary btn--full" onClick={reset}>
          {slot.label} 디폴트로 되돌리기
        </button>
      )}

      <p className="panel__hint">
        단색 벡터 SVG 지원 (텍스트는 아웃라인 필요). 모션은 유지되고 그래픽만 교체됩니다.
      </p>
      {error && <p className="panel__error">{error}</p>}
    </div>
  )
}
