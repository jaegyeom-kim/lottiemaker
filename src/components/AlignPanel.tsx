import { useState } from 'react'
import type { ReactElement } from 'react'
import { useEditor } from '../store'

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
      <h3 className="panel__label">정렬</h3>
      <div className="opttabs" style={{ marginBottom: 8 }}>
        <button
          className={`opttab ${basis === 'canvas' ? 'opttab--on' : ''}`}
          onClick={() => setBasis('canvas')}
        >
          캔버스 기준
        </button>
        <button
          className={`opttab ${basis === 'selection' ? 'opttab--on' : ''}`}
          title={selCount < 2 ? '레이어 2개 이상 선택 필요' : '선택 영역(합집합) 기준'}
          onClick={() => setBasis('selection')}
        >
          선택끼리
        </button>
      </div>
      <div className="alignrow">
        {aligns.map((a) => (
          <button
            key={a.mode}
            className="alignbtn"
            title={
              selCount
                ? `${a.label} (${effBasis === 'selection' ? '선택 영역' : '캔버스'} 기준)`
                : '레이어를 먼저 선택하세요'
            }
            disabled={!selCount}
            onClick={() => alignCustom(a.mode, effBasis)}
          >
            {a.icon}
          </button>
        ))}
      </div>
      {!selCount && <p className="knob__note">레이어를 선택하면 정렬할 수 있습니다.</p>}
      {basis === 'selection' && selCount > 0 && selCount < 2 && (
        <p className="knob__note">레이어 2개 이상 선택하면 선택끼리 정렬 — 지금은 캔버스 기준.</p>
      )}
      <div className="alignrow">
        <button
          className="alignbtn"
          title="가로 균등 분배 (레이어 3개 이상)"
          disabled={layerCount < 3}
          onClick={() => distributeCustom('h')}
        >
          {ICONS.dh}
        </button>
        <button
          className="alignbtn"
          title="세로 균등 분배 (레이어 3개 이상)"
          disabled={layerCount < 3}
          onClick={() => distributeCustom('v')}
        >
          {ICONS.dv}
        </button>
        <span className="panel__hint" style={{ alignSelf: 'center', marginLeft: 4 }}>
          {selCount >= 3 ? '선택한 레이어끼리 분배' : '전체 레이어 분배'}
        </span>
      </div>
    </div>
  )
}
