import { useRef, useState } from 'react'
import { useEditor, loadSavedSession } from '../store'
import { svgToLottie, readImageFile } from '../lib/svgImport'
import {
  IN_TYPES,
  LOOP_TYPES,
  OUT_TYPES,
  normSel,
  type CustomSel,
  type CustomPayload,
} from '../lib/customBuilder'

/**
 * 커스텀 탭 — 그래픽(SVG/PNG)을 레이어로 쌓고, 레이어별로
 * 등장/루프/퇴장 3슬롯(상용 모션 툴 방식)을 조합한다. 위치는 프리뷰에서 직접 드래그.
 */
export default function CustomBuilder() {
  const {
    templateId, addCustomLayer,
    setCustomChannels, setCustomChannelsLive, setCustomSizeLive, nudgeCustomBase,
    setFileName, commitEdit,
    setCompLengthLive,
  } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const active = templateId === '__custom'
  const layers = active && sourceData ? sourceData.layers : []
  const idx = Math.min(customIdx, Math.max(0, layers.length - 1))
  const selLayer = layers[idx] as
    | (Record<string, unknown> & { nm?: string; refId?: string })
    | undefined
  // 부분/구버전 xsel 방어 — normSel이 기본값 채움 + 구버전 이관
  const compOp = (active && sourceData?.op) || 90
  const xsel: CustomSel = normSel(selLayer?.xsel as Partial<CustomSel> | undefined, compOp)

  // 선택 레이어 기준(정착) 위치 — xbase
  let base: [number, number] | null = null
  if (selLayer) {
    base = Array.isArray(selLayer.xbase)
      ? [(selLayer.xbase as number[])[0], (selLayer.xbase as number[])[1]]
      : [256, 256]
  }

  const onFiles = async (files: FileList | File[]) => {
    // 편집된 템플릿 위에 커스텀 세션을 시작하면 템플릿 작업이 파기됨 — 확인
    const s0 = useEditor.getState()
    if (
      s0.templateId && s0.templateId !== '__custom' && s0.past.length > 0 &&
      !window.confirm('편집 중인 템플릿 작업이 사라집니다. 커스텀을 시작할까요?')
    )
      return
    setError('')
    const errors: string[] = []
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
        errors.push((e as Error).message)
      }
    }
    if (errors.length) setError(errors.join(' · '))
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

      {!active && loadSavedSession('custom') && (
        <button
          className="btn btn--secondary btn--full"
          onClick={() => {
            const saved = loadSavedSession('custom')
            if (saved) useEditor.getState().restoreSession(saved)
          }}
        >
          이전 커스텀 작업 이어하기
        </button>
      )}

      {active && selLayer && (
        <>
          <h4 className="grouphead">컴포지션</h4>
          <div className="knob">
            {/* AE 컴프 길이 — 레이어 클립/키프레임은 절대 시간 유지 */}
            <SliderRow
              label="재생 길이"
              min={0.5}
              max={6}
              step={0.1}
              unit="s"
              value={compOp / 60}
              onLive={(v) => setCompLengthLive(v)}
              onCommit={commitEdit}
            />
            <p className="knob__note">길이를 늘려도 각 레이어의 애니메이션 타이밍은 그대로입니다.</p>
          </div>

          <h4 className="grouphead">애니메이션</h4>

          {/* 등장 (In) */}
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">등장</span>
            </div>
            <div className="knob__chips">
              {IN_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.in.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, in: { ...xsel.in, type: i } })}
                >
                  {label}
                </button>
              ))}
            </div>
            {xsel.in.type > 0 && (
              <>
                <SliderRow
                  label="시간"
                  min={0.1}
                  max={1.2}
                  step={0.05}
                  unit="s"
                  value={xsel.in.dur / 60}
                  onLive={(v) =>
                    setCustomChannelsLive({ ...xsel, in: { ...xsel.in, dur: Math.round(v * 60) } })
                  }
                  onCommit={commitEdit}
                />
                {((xsel.in.type >= 2 && xsel.in.type <= 5) || xsel.in.type === 7) && (
                  <SliderRow
                    label="거리"
                    min={10}
                    max={400}
                    step={5}
                    unit="px"
                    value={xsel.in.dist}
                    onLive={(v) => setCustomChannelsLive({ ...xsel, in: { ...xsel.in, dist: v } })}
                    onCommit={commitEdit}
                  />
                )}
                {xsel.in.type !== 1 && xsel.in.type !== 7 && (
                  <label className="check" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={xsel.in.bounce !== 0}
                      onChange={(e) =>
                        setCustomChannels({
                          ...xsel,
                          in: { ...xsel.in, bounce: e.target.checked ? 1 : 0 },
                        })
                      }
                    />
                    바운스 (오버슈트)
                  </label>
                )}
              </>
            )}
          </div>

          {/* 루프 (Loop) */}
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">루프</span>
            </div>
            <div className="knob__chips">
              {LOOP_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.loop.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, loop: { ...xsel.loop, type: i } })}
                >
                  {label}
                </button>
              ))}
            </div>
            {xsel.loop.type > 0 && (
              <>
                {xsel.loop.type !== 4 && (
                  <SliderRow
                    label="세기"
                    min={2}
                    max={xsel.loop.type === 2 ? 60 : 200}
                    step={2}
                    unit={xsel.loop.type === 2 ? '%' : 'px'}
                    value={xsel.loop.amount}
                    onLive={(v) =>
                      setCustomChannelsLive({ ...xsel, loop: { ...xsel.loop, amount: v } })
                    }
                    onCommit={commitEdit}
                  />
                )}
                <SliderRow
                  label="주기"
                  min={0.2}
                  max={1.5}
                  step={0.05}
                  unit="s"
                  value={xsel.loop.period / 60}
                  onLive={(v) =>
                    setCustomChannelsLive({
                      ...xsel,
                      loop: { ...xsel.loop, period: Math.round(v * 60) },
                    })
                  }
                  onCommit={commitEdit}
                />
              </>
            )}
          </div>

          {/* 퇴장 (Out) */}
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">퇴장</span>
            </div>
            <div className="knob__chips">
              {OUT_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.out.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, out: { ...xsel.out, type: i } })}
                >
                  {label}
                </button>
              ))}
            </div>
            {xsel.out.type > 0 && (
              <>
                <SliderRow
                  label="시간"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  unit="s"
                  value={xsel.out.dur / 60}
                  onLive={(v) =>
                    setCustomChannelsLive({ ...xsel, out: { ...xsel.out, dur: Math.round(v * 60) } })
                  }
                  onCommit={commitEdit}
                />
                {xsel.out.type >= 2 && xsel.out.type <= 5 && (
                  <SliderRow
                    label="거리"
                    min={10}
                    max={400}
                    step={5}
                    unit="px"
                    value={xsel.out.dist}
                    onLive={(v) => setCustomChannelsLive({ ...xsel, out: { ...xsel.out, dist: v } })}
                    onCommit={commitEdit}
                  />
                )}
                {xsel.out.type !== 1 && (
                  <label className="check" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={xsel.out.bounce !== 0}
                      onChange={(e) =>
                        setCustomChannels({
                          ...xsel,
                          out: { ...xsel.out, bounce: e.target.checked ? 1 : 0 },
                        })
                      }
                    />
                    바운스 (윈드업 — 당겼다가 나감)
                  </label>
                )}
              </>
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
          ? '등장·루프·퇴장을 조합하세요. 타이밍은 아래 타임라인에서 밀고 당기기.'
          : '그래픽을 올리면 등장/루프/퇴장을 조합해 애니메이션을 만듭니다. 여러 장 올리면 레이어로 쌓입니다.'}
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
  const decimals = step < 1 ? 2 : 0
  const shownValue = Number(value.toFixed(decimals))

  const commitDraft = () => {
    if (draft === null) return
    const v = Number(draft)
    setDraft(null)
    if (Number.isFinite(v)) {
      const clamped = Number(Math.min(max, Math.max(min, v)).toFixed(decimals))
      if (clamped !== shownValue) {
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
            value={draft ?? String(shownValue)}
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
        value={shownValue}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </>
  )
}
