import { useEffect, useState } from 'react'
import { useEditor } from '../store'
import { FONT_PRESETS, type TemplateKnob } from '../lib/lottieKnobs'

const GROUP_LABELS: Record<string, string> = { font: '폰트' }

/** 템플릿 파라메트릭 옵션. 그룹이 있으면 탭으로 분리, 슬라이더 + 직접 입력 + 칩 + 폰트 드롭다운. */
export default function TemplateOptions() {
  const { sourceData, templateKnobs, knobValues, setKnobLive, resetTemplate, commitEdit } = useEditor()
  const [tab, setTab] = useState('기본')

  // 템플릿 전환 시 탭 초기화
  const groups = [...new Set(templateKnobs.map((k) => k.group).filter(Boolean))] as string[]
  const tabs = ['기본', ...groups.map((g) => GROUP_LABELS[g] ?? g)]
  useEffect(() => {
    setTab('기본')
  }, [templateKnobs])

  if (!sourceData || templateKnobs.length === 0) return null

  const activeGroup = tab === '기본' ? undefined : (groups.find((g) => (GROUP_LABELS[g] ?? g) === tab) ?? tab)
  const shown = templateKnobs.filter((k) => k.group === activeGroup)

  return (
    <div className="panel__section">
      <div className="panel__labelrow">
        <h3 className="panel__label">템플릿 옵션</h3>
        {/* 상시 노출 — 노브·색상·커스텀 그래픽·크기 전부 원본 복원 (undo 가능) */}
        <button className="linkbtn" onClick={resetTemplate}>
          초기화
        </button>
      </div>
      {tabs.length > 1 && (
        <div className="opttabs">
          {tabs.map((t) => (
            <button key={t} className={`opttab ${tab === t ? 'opttab--on' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {shown.map((k) => {
        const value = knobValues[k.id] ?? k.default
        if (k.fontPicker) {
          return (
            <FontPicker
              key={k.id}
              knob={k}
              value={value}
              onCommit={(v) => {
                setKnobLive(k.id, v)
                commitEdit()
              }}
            />
          )
        }
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
          // 선택형 노브 — 칩으로 렌더, 클릭 즉시 커밋
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
        const num = typeof value === 'number' ? value : k.default
        return (
          <div key={k.id} className="knob">
            <div className="knob__head">
              <span className="knob__name">{k.label}</span>
              <KnobValueInput
                value={num}
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
              value={num}
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

interface LocalFont {
  family: string
}

/**
 * 폰트 드롭다운 — 프리셋 + 로컬 폰트(Local Font Access API).
 * 값: 프리셋 인덱스(number) 또는 로컬 폰트 패밀리(string).
 * queryLocalFonts는 사용자 제스처 + 권한 필요 — 버튼으로 명시 로드(Chromium 전용).
 */
function FontPicker({
  knob,
  value,
  onCommit,
}: {
  knob: TemplateKnob
  value: number | string
  onCommit: (v: number | string) => void
}) {
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'done' | 'denied'>('idle')
  const supported = typeof window !== 'undefined' && 'queryLocalFonts' in window

  const loadLocal = async () => {
    setLoadState('loading')
    try {
      const fonts = (await (
        window as unknown as { queryLocalFonts: () => Promise<LocalFont[]> }
      ).queryLocalFonts()) as LocalFont[]
      const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) =>
        a.localeCompare(b, 'ko'),
      )
      setLocalFonts(families)
      setLoadState('done')
    } catch {
      setLoadState('denied')
    }
  }

  // select 값 인코딩: 프리셋 "p:<idx>", 로컬 폰트는 패밀리 문자열 그대로
  const selectValue = typeof value === 'number' ? `p:${value}` : value

  return (
    <div className="knob">
      <div className="knob__head">
        <span className="knob__name">{knob.label}</span>
        {supported && loadState !== 'done' && (
          <button className="linkbtn" onClick={loadLocal} disabled={loadState === 'loading'}>
            {loadState === 'loading' ? '불러오는 중…' : loadState === 'denied' ? '권한 거부됨 — 다시 시도' : '로컬 폰트 불러오기'}
          </button>
        )}
      </div>
      <select
        className="fontselect"
        value={selectValue}
        style={{
          fontFamily:
            typeof value === 'string' ? `"${value}"` : FONT_PRESETS[value]?.family,
        }}
        onChange={(e) => {
          const v = e.target.value
          onCommit(v.startsWith('p:') ? Number(v.slice(2)) : v)
        }}
      >
        <optgroup label="프리셋">
          {FONT_PRESETS.map((p, i) => (
            <option key={p.label} value={`p:${i}`} style={{ fontFamily: p.family }}>
              {p.label}
            </option>
          ))}
        </optgroup>
        {localFonts.length > 0 && (
          <optgroup label={`로컬 폰트 (${localFonts.length})`}>
            {localFonts.map((fam) => (
              <option key={fam} value={fam} style={{ fontFamily: `"${fam}"` }}>
                {fam}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {!supported && (
        <p className="knob__note">로컬 폰트 목록은 Chrome/Edge에서 지원 — 다른 브라우저는 프리셋만 제공.</p>
      )}
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
