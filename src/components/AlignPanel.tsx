import { useState } from 'react'
import type { ReactElement } from 'react'
import { useEditor } from '../store'
import { evalNumExpr } from '../lib/num'
import { t } from '../lib/i18n'

const I = (d: string) => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d={d} fill="currentColor" />
  </svg>
)

// 일러스트레이터 Align 패널 아이콘 — 기준선 + 사각형 조합
const ICONS = {
  left: I('M1 1h1.4v13H1zM4 4h7v3H4zM4 8.5h4.5v3H4z'),
  hc: I('M6.8 1h1.4v13H6.8zM3 4h9v3H3zM4.8 8.5h5.4v3H4.8z'),
  right: I('M12.6 1H14v13h-1.4zM4 4h7v3H4zM6.5 8.5H11v3H6.5z'),
  top: I('M1 1h13v1.4H1zM4 4h3v7H4zM8.5 4h3v4.5h-3z'),
  vc: I('M1 6.8h13v1.4H1zM4 3h3v9H4zM8.5 4.8h3v5.4h-3z'),
  bottom: I('M1 12.6h13V14H1zM4 4h3v7H4zM8.5 6.5h3v4.5h-3z'),
  dh: I('M1 1h1.2v13H1zM12.8 1H14v13h-1.2zM5.9 4h3.2v7H5.9z'),
  dv: I('M1 1h13v1.2H1zM1 12.8h13V14H1zM4 5.9h7v3.2H4z'),
}

/** 정렬 패널 (일러스트레이터 Align) — 선택 레이어를 캔버스 기준 정렬 + 전체 균등 분배. */
export default function AlignPanel() {
  const { templateId, alignCustom, distributeCustom } = useEditor()
  const layerCount = useEditor((s) => s.sourceData?.layers.length ?? 0)
  const selCount = useEditor((s) => s.customIdxs.length)
  const [basis, setBasis] = useState<'canvas' | 'selection'>('canvas')

  if (templateId !== '__custom' || layerCount === 0) return null
  // 선택 기준은 2개 이상일 때만 의미 — 아니면 캔버스로
  const effBasis = basis === 'selection' && selCount >= 2 ? 'selection' : 'canvas'

  const aligns: { mode: Parameters<typeof alignCustom>[0]; icon: ReactElement; label: string }[] = [
    { mode: 'left', icon: ICONS.left, label: '왼쪽 정렬' },
    { mode: 'hc', icon: ICONS.hc, label: '가로 중앙' },
    { mode: 'right', icon: ICONS.right, label: '오른쪽 정렬' },
    { mode: 'top', icon: ICONS.top, label: '위 정렬' },
    { mode: 'vc', icon: ICONS.vc, label: '세로 중앙' },
    { mode: 'bottom', icon: ICONS.bottom, label: '아래 정렬' },
  ]

  return (
    <div className="panel__section">
      <div className="opttabs" style={{ marginBottom: 8 }}>
        <button
          className={`opttab ${basis === 'canvas' ? 'opttab--on' : ''}`}
          onClick={() => setBasis('canvas')}
        >
          {t('캔버스 기준')}
        </button>
        <button
          className={`opttab ${basis === 'selection' ? 'opttab--on' : ''}`}
          title={selCount < 2 ? t('레이어 2개 이상 선택 필요') : t('선택 영역(합집합) 기준')}
          onClick={() => setBasis('selection')}
        >
          {t('선택끼리')}
        </button>
      </div>
      <div className="alignrow">
        {aligns.map((a) => (
          <button
            key={a.mode}
            className="alignbtn"
            title={
              selCount
                ? t('{label} ({basis} 기준)')
                    .replace('{label}', t(a.label))
                    .replace('{basis}', effBasis === 'selection' ? t('선택 영역') : t('캔버스'))
                : t('레이어를 먼저 선택하세요')
            }
            disabled={!selCount}
            onClick={() => alignCustom(a.mode, effBasis)}
          >
            {a.icon}
          </button>
        ))}
      </div>
      {!selCount && <p className="knob__note">{t('레이어를 선택하면 정렬할 수 있습니다.')}</p>}
      {basis === 'selection' && selCount > 0 && selCount < 2 && (
        <p className="knob__note">{t('레이어 2개 이상 선택하면 선택끼리 정렬 — 지금은 캔버스 기준.')}</p>
      )}
      <div className="alignrow">
        <button
          className="alignbtn"
          title={t('가로 균등 분배 (레이어 3개 이상)')}
          disabled={layerCount < 3}
          onClick={() => distributeCustom('h')}
        >
          {ICONS.dh}
        </button>
        <button
          className="alignbtn"
          title={t('세로 균등 분배 (레이어 3개 이상)')}
          disabled={layerCount < 3}
          onClick={() => distributeCustom('v')}
        >
          {ICONS.dv}
        </button>
        <span className="panel__hint" style={{ alignSelf: 'center', marginLeft: 4 }}>
          {selCount >= 3 ? t('선택한 레이어끼리 분배') : t('전체 레이어 분배')}
        </span>
      </div>

      <PatternDuplicate disabled={selCount === 0} />
    </div>
  )
}

/** 패턴 복제 (Lottie Creator 2.0 Advanced Duplicator 벤치) — 간격·회전·시간차 누적 복제. */
function PatternDuplicate({ disabled }: { disabled: boolean }) {
  const duplicatePattern = useEditor((s) => s.duplicatePattern)
  const [count, setCount] = useState(4)
  const [dx, setDx] = useState(60)
  const [dy, setDy] = useState(0)
  const [drot, setDrot] = useState(0)
  const [dt, setDt] = useState(6)
  const [ds, setDs] = useState(0)
  const [dop, setDop] = useState(0)

  const Field = ({
    label,
    value,
    onChange,
  }: {
    label: string
    value: number
    onChange: (v: number) => void
  }) => (
    <label className="patfield">
      <span>{label}</span>
      <NumField value={value} onCommit={onChange} />
    </label>
  )

  return (
    <>
      <h3 className="panel__label">{t('패턴 복제')}</h3>
      <div className="patgrid">
        <Field label={t('개수')} value={count} onChange={(v) => setCount(Math.max(2, Math.min(12, Math.round(v))))} />
        <Field label={t('X 간격')} value={dx} onChange={setDx} />
        <Field label={t('Y 간격')} value={dy} onChange={setDy} />
        <Field label={t('회전 +°')} value={drot} onChange={setDrot} />
        <Field label={t('시간차 f')} value={dt} onChange={(v) => setDt(Math.round(v))} />
        <Field label={t('크기 +%')} value={ds} onChange={(v) => setDs(Math.max(-90, Math.min(200, v)))} />
        <Field label={t('투명 +%')} value={dop} onChange={(v) => setDop(Math.max(-100, Math.min(100, v)))} />
        <button
          className="btn btn--secondary"
          disabled={disabled}
          title={disabled ? t('레이어를 먼저 선택하세요') : t('선택 레이어를 누적 오프셋으로 복제')}
          onClick={() => duplicatePattern(count, dx, dy, drot, dt, ds, dop)}
        >
          {t('복제')}
        </button>
      </div>
      <p className="panel__hint">
        {t('복제본마다 간격·회전·크기·투명도·시간차가 누적됩니다 — 스태거 등장, 방사형·페이드 패턴에 유용.')}
      </p>
    </>
  )
}

/** 소형 숫자 입력 — 산술 지원. */
function NumField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = evalNumExpr(draft, value)
    setDraft(null)
    if (v !== null) onCommit(v)
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
