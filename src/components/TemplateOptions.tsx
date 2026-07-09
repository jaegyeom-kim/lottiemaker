import { useEffect, useState } from 'react'
import { useEditor } from '../store'

/** 템플릿 파라메트릭 옵션. 슬라이더 + 직접 입력, 선택형(이징)은 칩. */
export default function TemplateOptions() {
  const { sourceData, templateKnobs, knobValues, setKnobLive, resetKnobs, commitEdit } = useEditor()

  if (!sourceData || templateKnobs.length === 0) return null

  const dirty = templateKnobs.some((k) => (knobValues[k.id] ?? k.default) !== k.default)

  return (
    <div className="panel__section">
      <div className="panel__labelrow">
        <h3 className="panel__label">템플릿 옵션</h3>
        {dirty && (
          <button className="linkbtn" onClick={resetKnobs}>
            초기화
          </button>
        )}
      </div>
      {templateKnobs.map((k) => {
        const value = knobValues[k.id] ?? k.default
        if (k.toggle) {
          // 토글형 노브 — 체크박스, 변경 즉시 커밋
          return (
            <label key={k.id} className="knob knob--toggle check">
              <input
                type="checkbox"
                checked={value !== 0}
                onChange={(e) => {
                  setKnobLive(k.id, e.target.checked ? 1 : 0)
                  commitEdit()
                }}
              />
              {k.label}
            </label>
          )
        }
        if (k.options) {
          // 선택형 노브 (이징 프리셋 등) — 칩으로 렌더, 클릭 즉시 커밋
          return (
            <div key={k.id} className="knob">
              <div className="knob__head">
                <span className="knob__name">{k.label}</span>
              </div>
              <div className="knob__chips">
                {k.options.map((label, i) => (
                  <button
                    key={label}
                    className={`chip ${value === i ? 'chip--on' : ''}`}
                    onClick={() => {
                      setKnobLive(k.id, i)
                      commitEdit()
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )
        }
        return (
          <div key={k.id} className="knob">
            <div className="knob__head">
              <span className="knob__name">{k.label}</span>
              <KnobValueInput
                value={value}
                min={k.min}
                max={k.max}
                step={k.step}
                unit={k.unit}
                onCommit={(v) => {
                  setKnobLive(k.id, v)
                  commitEdit()
                }}
              />
            </div>
            <input
              type="range"
              min={k.min}
              max={k.max}
              step={k.step}
              value={value}
              onChange={(e) => setKnobLive(k.id, Number(e.target.value))}
              onPointerUp={commitEdit}
              onKeyUp={commitEdit}
            />
          </div>
        )
      })}
    </div>
  )
}

/**
 * 직접 입력 필드 — blur/Enter에서만 커밋, min/max 클램프. 빈 값은 원복.
 * 소수 스텝 노브(재생 길이 0.1s 등)는 스텝 소수 자릿수로 반올림 — 정수 강제 금지.
 */
function KnobValueInput({
  value,
  min,
  max,
  step,
  unit,
  onCommit,
}: {
  value: number
  min: number
  max: number
  step: number
  unit: string
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const decimals = step < 1 ? (String(step).split('.')[1]?.length ?? 1) : 0

  const commit = () => {
    const v = Number(draft)
    if (Number.isFinite(v)) {
      const clamped = Number(Math.min(max, Math.max(min, v)).toFixed(decimals))
      if (clamped !== value) {
        onCommit(clamped)
        return
      }
    }
    setDraft(String(value))
  }

  return (
    <span className="knob__valinput">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <span className="knob__unit">{unit}</span>
    </span>
  )
}
