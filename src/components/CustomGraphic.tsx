import { useMemo, useRef, useState } from 'react'
import { useEditor } from '../store'
import { templates } from '../templates'
import type { LottieJson, LottieLayer } from '../lib/lottieUtils'
import {
  svgToLottie,
  wrapToFit,
  readImageFile,
  fitImageSize,
  type ImportedGraphic,
  type ImportedImage,
} from '../lib/svgImport'
import LottiePlayer from './LottiePlayer'
import AnchorPad from './AnchorPad'

type Pending =
  | { kind: 'svg'; graphic: ImportedGraphic; name: string }
  | { kind: 'image'; image: ImportedImage; name: string }

/** 커스텀 그래픽(SVG/PNG) 교체 — 슬롯 드롭다운 + 업로드 미리보기 + 적용/되돌리기. */
export default function CustomGraphic() {
  const {
    templateId,
    animationData,
    applyGraphicToSlot,
    applyImageToSlot,
    setImageAnchorLive,
    commitEdit,
    restoreSlot,
  } = useEditor()
  const [slotIdx, setSlotIdx] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const def = templates.find((t) => t.id === templateId)
  const slots = def?.swapSlots ?? []
  const slot = slots[Math.min(slotIdx, slots.length - 1)]

  // 미리보기용 1프레임 로티 (파싱 결과를 그대로 렌더 — 변환 손실 확인 가능)
  const previewData = useMemo(() => {
    if (!pending || !slot) return null
    const base = {
      v: '5.7.4', fr: 60, ip: 0, op: 1, w: 120, h: 120, nm: 'preview', ddd: 0,
    }
    if (pending.kind === 'image') {
      const { w, h } = fitImageSize(pending.image, 100)
      return {
        ...base,
        assets: [{ id: 'pv', w, h, u: '', p: pending.image.dataUri, e: 1 }],
        layers: [{
          ddd: 0, ty: 2, ind: 1, nm: 'g', sr: 1, refId: 'pv',
          ks: {
            o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
            p: { a: 0, k: [60, 60, 0] }, a: { a: 0, k: [w / 2, h / 2, 0] }, s: { a: 0, k: [100, 100, 100] },
          },
          ao: 0, ip: 0, op: 1, st: 0, bm: 0,
        }],
      }
    }
    return {
      ...base,
      assets: [],
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

  // 선택된 슬롯이 커스텀 상태인지 (셰이프 교체 or 이미지 레이어 전환)
  const slotLayer = animationData.layers.find(
    (l) => typeof l.nm === 'string' && l.nm.startsWith(slot.match),
  ) as
    | (LottieLayer & {
        shapes?: { nm?: string }[]
        ty?: number
        ks?: { a?: { k: number[] } }
      })
    | undefined
  const isImage = slotLayer?.ty === 2
  const isCustom = slotLayer?.shapes?.[0]?.nm === 'Custom Graphic' || isImage

  // 이미지 슬롯의 현재 앵커 비율 (에셋 크기 대비)
  const asset = isImage
    ? ((animationData.assets as Record<string, unknown>[] | undefined)?.find(
        (a) => a.id === `img_${slot.match}`,
      ) as { w: number; h: number; p: string } | undefined)
    : undefined
  const anchorFrac: [number, number] = asset && slotLayer?.ks?.a?.k
    ? [slotLayer.ks.a.k[0] / asset.w, slotLayer.ks.a.k[1] / asset.h]
    : [0.5, 0.5]

  const onFile = async (file: File) => {
    setError('')
    try {
      if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
        const graphic = svgToLottie(await file.text())
        setPending({ kind: 'svg', graphic, name: file.name })
      } else if (/^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
        const image = await readImageFile(file)
        setPending({ kind: 'image', image, name: file.name })
      } else {
        throw new Error('SVG/PNG/JPG/WebP 파일만 지원합니다')
      }
    } catch (e) {
      setPending(null)
      setError((e as Error).message)
    }
  }

  const applyPending = () => {
    if (!pending) return
    if (pending.kind === 'image') {
      const { w, h } = fitImageSize(pending.image, slot.fit)
      applyImageToSlot(slot.match, pending.image.dataUri, w, h, slot.anchor)
    } else {
      applyGraphicToSlot(slot.match, wrapToFit(pending.graphic, slot.fit))
    }
    setPending(null)
  }

  const reset = () => {
    const pristine = (def.data as LottieJson).layers
      .filter((l) => typeof l.nm === 'string' && l.nm.startsWith(slot.match))
      .reduce<Record<string, LottieLayer>>((acc, l) => {
        acc[l.nm as string] = l
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
          SVG/PNG를 끌어다 놓거나 <u>클릭해서 선택</u>
        </span>
        <span className="panel__hint">→ {slot.label} 교체</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
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

      {isImage && !pending && asset && (
        // 이미지 교체 후 기준점(회전·스케일 피벗) 조정 — 이미지 위에서 직접 드래그
        <div className="knob">
          <div className="knob__head">
            <span className="knob__name">앵커 (기준점)</span>
            <span className="knob__unit">
              {Math.round(anchorFrac[0] * 100)}% · {Math.round(anchorFrac[1] * 100)}%
            </span>
          </div>
          <AnchorPad
            dataUri={asset.p}
            aspect={asset.w / asset.h}
            frac={anchorFrac}
            onLive={(fx, fy) => setImageAnchorLive(slot.match, fx, fy)}
            onCommit={commitEdit}
          />
          <p className="knob__note">
            이미지 위 십자점을 드래그 — 회전·스케일할 때 고정되는 점.
          </p>
        </div>
      )}

      {isCustom && !pending && (
        <button className="btn btn--secondary btn--full" onClick={reset}>
          {slot.label} 디폴트로 되돌리기
        </button>
      )}

      <p className="panel__hint">
        벡터: 단색 SVG (텍스트는 아웃라인 필요) · 래스터: PNG/JPG/WebP (파일에 임베드, 색상 편집
        불가). 모션은 유지되고 그래픽만 교체됩니다.
      </p>
      {error && <p className="panel__error">{error}</p>}
    </div>
  )
}
