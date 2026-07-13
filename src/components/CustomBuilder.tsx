import { useRef, useState } from 'react'
import { useEditor } from '../store'
import { svgToLottie, readImageFile } from '../lib/svgImport'
import AnchorPad from './AnchorPad'
import {
  POS_PRESETS,
  DEFAULT_SEL,
  type CustomSel,
  type CustomPayload,
} from '../lib/customBuilder'

/**
 * 커스텀 탭 — 그래픽(SVG/PNG)을 여러 장 올려 레이어로 쌓고,
 * 레이어별로 포지션/스케일/오퍼시티 프리셋을 조합한다. 위치는 프리뷰에서 직접 드래그.
 */
export default function CustomBuilder() {
  const {
    templateId, addCustomLayer,
    setCustomChannels, setCustomChannelsLive, setCustomSizeLive, nudgeCustomBase,
    setCustomAnchor, setCustomAnchorLive, setFileName, commitEdit,
  } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // 포지션 비활성화 시 마지막 프리셋 기억 — 다시 켜면 복원
  const [lastPos, setLastPos] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)

  const active = templateId === '__custom'
  const layers = active && sourceData ? sourceData.layers : []
  const idx = Math.min(customIdx, Math.max(0, layers.length - 1))
  const selLayer = layers[idx] as
    | (Record<string, unknown> & { nm?: string; refId?: string })
    | undefined
  // 부분 xsel(이전 버전 레이어) 방어 — 새 필드는 기본값으로 채움
  const xsel: CustomSel = { ...DEFAULT_SEL, ...((selLayer?.xsel as Partial<CustomSel>) ?? {}) }

  // 선택 레이어 기준(정착) 위치 — xbase 우선
  let base: [number, number] | null = null
  if (selLayer) {
    if (Array.isArray(selLayer.xbase)) {
      base = [(selLayer.xbase as number[])[0], (selLayer.xbase as number[])[1]]
    } else {
      const p = (selLayer.ks as Record<string, unknown>).p as { a?: number; k: unknown }
      base =
        p.a === 1
          ? [(p.k as { s: number[] }[]).at(-1)!.s[0], (p.k as { s: number[] }[]).at(-1)!.s[1]]
          : [(p.k as number[])[0], (p.k as number[])[1]]
    }
  }

  const onFiles = async (files: FileList | File[]) => {
    setError('')
    for (const file of files) {
      try {
        let payload: CustomPayload
        if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
          payload = { kind: 'svg', graphic: svgToLottie(await file.text()) }
        } else if (
          /^image\/(png|jpeg|webp)$/.test(file.type) ||
          /\.(png|jpe?g|webp)$/i.test(file.name)
        ) {
          payload = { kind: 'image', image: await readImageFile(file) }
        } else {
          throw new Error(`${file.name}: SVG/PNG/JPG/WebP 파일만 지원합니다`)
        }
        const name = file.name.replace(/\.[^.]+$/, '') || 'graphic'
        const first =
          useEditor.getState().templateId !== '__custom' || !useEditor.getState().sourceData
        addCustomLayer(payload, name)
        if (first) setFileName(name)
      } catch (e) {
        setError((e as Error).message)
      }
    }
  }

  const pickChannel = (key: 'pos', i: number) => {
    setCustomChannels({ ...xsel, [key]: i })
  }

  return (
    <div className="custombuilder">
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
          if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files)
        }}
      >
        <span className="dropzone__icon">⬆</span>
        <span>
          SVG/PNG를 끌어다 놓거나 <u>클릭해서 선택</u> {active && '(여러 장 가능)'}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {error && <p className="panel__error">{error}</p>}

      {active && selLayer && (
        <>
          <h4 className="grouphead">애니메이션</h4>
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">포지션</span>
              <label className="check check--inline">
                <input
                  type="checkbox"
                  checked={xsel.pos !== 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setCustomChannels({ ...xsel, pos: lastPos })
                    } else {
                      setLastPos(xsel.pos || 1)
                      setCustomChannels({ ...xsel, pos: 0 })
                    }
                  }}
                />
                활성화
              </label>
            </div>
            <div className="knob__chips">
              {POS_PRESETS.slice(1).map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.pos === i + 1 ? 'chip--on' : ''}`}
                  onClick={() => pickChannel('pos', i + 1)}
                >
                  {label}
                </button>
              ))}
            </div>
            <SliderRow
              label="이동량"
              min={8}
              max={300}
              step={2}
              unit="px"
              value={xsel.amount}
              onLive={(v) => setCustomChannelsLive({ ...xsel, amount: v })}
              onCommit={commitEdit}
            />
          </div>

          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">스케일</span>
              <label className="check check--inline">
                <input
                  type="checkbox"
                  checked={(xsel.scaleOn ?? 0) !== 0}
                  onChange={(e) => setCustomChannels({ ...xsel, scaleOn: e.target.checked ? 1 : 0 })}
                />
                활성화
              </label>
            </div>
            <SliderRow
              label="시작 스케일"
              min={0}
              max={300}
              step={5}
              unit="%"
              value={xsel.scaleFrom}
              onLive={(v) => setCustomChannelsLive({ ...xsel, scaleOn: 1, scaleFrom: v })}
              onCommit={commitEdit}
            />
            <SliderRow
              label="끝 스케일"
              min={0}
              max={300}
              step={5}
              unit="%"
              value={xsel.scaleTo}
              onLive={(v) => setCustomChannelsLive({ ...xsel, scaleOn: 1, scaleTo: v })}
              onCommit={commitEdit}
            />
            <label className="check" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={xsel.scaleBounce !== 0}
                onChange={(e) => setCustomChannels({ ...xsel, scaleBounce: e.target.checked ? 1 : 0 })}
              />
              바운싱 (오버슈트 후 정착)
            </label>
          </div>

          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">오퍼시티</span>
              <label className="check check--inline">
                <input
                  type="checkbox"
                  checked={(xsel.fadeOn ?? 0) !== 0}
                  onChange={(e) => setCustomChannels({ ...xsel, fadeOn: e.target.checked ? 1 : 0 })}
                />
                활성화
              </label>
            </div>
            <SliderRow
              label="시작 값"
              min={0}
              max={100}
              step={1}
              unit="%"
              value={xsel.fadeFrom ?? 0}
              onLive={(v) => setCustomChannelsLive({ ...xsel, fadeOn: 1, fadeFrom: v })}
              onCommit={commitEdit}
            />
            <SliderRow
              label="끝 값"
              min={0}
              max={100}
              step={1}
              unit="%"
              value={xsel.fadeTo ?? 100}
              onLive={(v) => setCustomChannelsLive({ ...xsel, fadeOn: 1, fadeTo: v })}
              onCommit={commitEdit}
            />
            {(xsel.fadeOn ?? 0) === 0 && (
              <SliderRow
                label="불투명도"
                min={0}
                max={100}
                step={1}
                unit="%"
                value={xsel.opacity}
                onLive={(v) => setCustomChannelsLive({ ...xsel, opacity: v })}
                onCommit={commitEdit}
              />
            )}
          </div>

          <h4 className="grouphead">변형</h4>
          <div className="knob">
            <SliderRow
              label="그래픽 크기"
              min={40}
              max={480}
              step={4}
              unit="px"
              value={xsel.size}
              onLive={setCustomSizeLive}
              onCommit={commitEdit}
            />
          </div>

          <div className="knob">
            <SliderRow
              label="회전"
              min={-180}
              max={180}
              step={1}
              unit="°"
              value={xsel.rotation}
              onLive={(v) => setCustomChannelsLive({ ...xsel, rotation: v })}
              onCommit={commitEdit}
            />
          </div>

          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">앵커 포인트</span>
              <span className="knob__unit">
                {Math.round((xsel.anchor?.[0] ?? 0.5) * 100)}% · {Math.round((xsel.anchor?.[1] ?? 0.5) * 100)}%
              </span>
            </div>
            {/* AE식 9점 그리드 — 회전·스케일 기준점 */}
            <div className="anchorgrid">
              {[0, 0.5, 1].map((fy) =>
                [0, 0.5, 1].map((fx) => {
                  const cur = xsel.anchor ?? [0.5, 0.5]
                  const on = Math.abs(cur[0] - fx) < 0.02 && Math.abs(cur[1] - fy) < 0.02
                  return (
                    <button
                      key={`${fx}-${fy}`}
                      className={`anchorgrid__dot ${on ? 'anchorgrid__dot--on' : ''}`}
                      onClick={() => setCustomAnchor(fx, fy)}
                    />
                  )
                }),
              )}
            </div>
            {selLayer?.refId && sourceData && (
              <AnchorPadForLayer
                sourceData={sourceData}
                refId={String(selLayer.refId)}
                frac={xsel.anchor ?? [0.5, 0.5]}
                onLive={setCustomAnchorLive}
                onCommit={commitEdit}
              />
            )}
            <p className="knob__note">그래픽은 제자리 — 회전·스케일 피벗만 바뀝니다.</p>
          </div>

          {base && (
            <div className="knob">
              <div className="knob__head">
                <span className="knob__name">위치</span>
                <button
                  className="linkbtn"
                  onClick={() => nudgeCustomBase(256 - base![0], 256 - base![1])}
                >
                  캔버스 중앙
                </button>
              </div>
              <div className="posrow">
                <PosInput label="X" value={base[0]} onCommit={(v) => nudgeCustomBase(v - base![0], 0)} />
                <PosInput label="Y" value={base[1]} onCommit={(v) => nudgeCustomBase(0, v - base![1])} />
              </div>
            </div>
          )}
        </>
      )}

      <p className="panel__hint">
        {active
          ? '미리보기에서 클릭으로 레이어 선택, 드래그로 이동. 레이어 관리는 오른쪽 레이어 패널.'
          : '그래픽을 올리면 프리셋을 조합해 애니메이션을 만듭니다. 여러 장 올리면 레이어로 쌓입니다.'}
      </p>
    </div>
  )
}

/** 위치 수치 입력 — blur/Enter 커밋, 외부 변경(드래그/undo) 자동 반영. */
function PosInput({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
}) {
  const rounded = Math.round(value * 10) / 10
  const [draft, setDraft] = useState(String(rounded))
  const [focused, setFocused] = useState(false)
  // 포커스 없을 때만 외부 값 반영 — 입력 중 덮어쓰기 방지
  const shown = focused ? draft : String(rounded)

  const commit = () => {
    setFocused(false)
    const v = Number(draft)
    if (Number.isFinite(v) && Math.abs(v - rounded) > 1e-9) onCommit(v)
  }

  return (
    <label className="posinput">
      <span className="posinput__label">{label}</span>
      <input
        type="number"
        step={1}
        value={shown}
        onFocus={(e) => {
          setFocused(true)
          setDraft(e.target.value)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

/** 이미지 레이어용 앵커 드래그 패드 래퍼 — 에셋에서 dataUri/비율 조회. */
function AnchorPadForLayer({
  sourceData,
  refId,
  frac,
  onLive,
  onCommit,
}: {
  sourceData: { assets?: unknown }
  refId: string
  frac: [number, number]
  onLive: (fx: number, fy: number) => void
  onCommit: () => void
}) {
  const asset = (sourceData.assets as Record<string, unknown>[] | undefined)?.find(
    (a) => a.id === refId,
  ) as { p?: string; w?: number; h?: number } | undefined
  if (!asset?.p || !asset.w || !asset.h) return null
  return (
    <AnchorPad dataUri={asset.p} aspect={asset.w / asset.h} frac={frac} onLive={onLive} onCommit={onCommit} />
  )
}

/** 슬라이더 + 수치 직접 입력 — 슬라이더는 라이브, 입력은 blur/Enter 커밋. */
function SliderRow({
  label,
  min,
  max,
  step,
  unit,
  value,
  onLive,
  onCommit,
}: {
  label: string
  min: number
  max: number
  step: number
  unit: string
  value: number
  onLive: (v: number) => void
  onCommit: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commitDraft = () => {
    if (draft === null) return
    const v = Number(draft)
    setDraft(null)
    if (Number.isFinite(v)) {
      const clamped = Math.min(max, Math.max(min, Math.round(v)))
      if (clamped !== value) {
        onLive(clamped)
        onCommit()
      }
    }
  }

  return (
    <>
      <div className="knob__head" style={{ marginTop: 8 }}>
        <span className="knob__name">{label}</span>
        <span className="knob__valinput">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? String(value)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <span className="knob__unit">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </>
  )
}
