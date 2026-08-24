import { useEffect, useState } from 'react'
import { PosInput } from './CustomBuilder'
import { useEditor } from '../store'
import { FONT_PRESETS, type TemplateKnob } from '../lib/lottieKnobs'
import { t } from '../lib/i18n'

const GROUP_LABELS: Record<string, string> = { font: '폰트' }

/** 템플릿 파라메트릭 옵션. 그룹이 있으면 탭으로 분리, 슬라이더 + 직접 입력 + 칩 + 폰트 드롭다운. */
export default function TemplateOptions() {
  const { sourceData, templateKnobs, knobValues, setKnobLive, resetTemplate, commitEdit, templateId } =
    useEditor()
  const [tab, setTab] = useState('기본')

  // 템플릿 전환 시 탭 초기화
  const groups = [...new Set(templateKnobs.map((k) => k.group).filter(Boolean))] as string[]
  const tabs = ['기본', ...groups.map((g) => GROUP_LABELS[g] ?? g)]
  useEffect(() => {
    setTab('기본')
  }, [templateKnobs])

  if (!sourceData || templateKnobs.length === 0) return null

  const activeGroup = tab === '기본' ? undefined : (groups.find((g) => (GROUP_LABELS[g] ?? g) === tab) ?? tab)
  // 커스텀 모드에서 노브가 없으면 섹션 자체가 무의미 — 빈 헤더 방지

  const shown = templateKnobs.filter((k) => k.group === activeGroup)

  return (
    <div className="panel__section">
      <div className="panel__labelrow">
        {/* 커스텀 모드에선 숨김 — 초기화가 레이어 작업 전체를 파기하므로 위험 */}
        {templateId !== '__custom' && (
          <button className="linkbtn" onClick={resetTemplate}>
            {t('초기화')}
          </button>
        )}
      </div>
      {tabs.length > 1 && (
        <div className="opttabs">
          {tabs.map((tb) => (
            <button key={tb} className={`opttab ${tab === tb ? 'opttab--on' : ''}`} onClick={() => setTab(tb)}>
              {t(tb)}
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
              {t(k.label)}
            </label>
          )
        }
        if (k.options) {
          // 선택형 노브 — 칩으로 렌더, 클릭 즉시 커밋
          return (
            <div key={k.id} className="knob">
              <div className="knob__head">
                <span className="knob__name">{t(k.label)}</span>
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
                    {t(label)}
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
              <span className="knob__name">{t(k.label)}</span>
              <PosInput
                label={t(k.unit)}
                value={num}
                onCommit={(v) => {
                  const dec = k.step < 1 ? (String(k.step).split('.')[1]?.length ?? 1) : 0
                  setKnobLive(k.id, Number(Math.min(k.max, Math.max(k.min, v)).toFixed(dec)))
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
        <span className="knob__name">{t(knob.label)}</span>
        {supported && loadState !== 'done' && (
          <button className="linkbtn" onClick={loadLocal} disabled={loadState === 'loading'}>
            {loadState === 'loading' ? t('불러오는 중…') : loadState === 'denied' ? t('권한 거부됨 — 다시 시도') : t('로컬 폰트 불러오기')}
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
        <optgroup label={t('프리셋')}>
          {FONT_PRESETS.map((p, i) => (
            <option key={p.label} value={`p:${i}`} style={{ fontFamily: p.family }}>
              {t(p.label)}
            </option>
          ))}
        </optgroup>
        {localFonts.length > 0 && (
          <optgroup label={t('로컬 폰트 ({n})').replace('{n}', String(localFonts.length))}>
            {localFonts.map((fam) => (
              <option key={fam} value={fam} style={{ fontFamily: `"${fam}"` }}>
                {fam}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {!supported && (
        <p className="knob__note">{t('로컬 폰트 목록은 Chrome/Edge에서 지원 — 다른 브라우저는 프리셋만 제공.')}</p>
      )}
    </div>
  )
}

/**
 * 직접 입력 필드 — blur/Enter에서만 커밋, min/max 클램프. 빈 값은 원복.
 * 소수 스텝 노브(재생 길이 0.1s 등)는 스텝 소수 자릿수로 반올림 — 정수 강제 금지.
 */
