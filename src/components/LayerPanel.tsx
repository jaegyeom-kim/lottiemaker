import { useRef, useState } from 'react'
import { useEditor } from '../store'
import { getLayers } from '../lib/lottieUtils'
import { layerColor } from '../lib/customBuilder'

export default function LayerPanel() {
  const { animationData, templateId } = useEditor()
  if (!animationData) return null
  // 커스텀 빌더는 통합 레이어 패널 (선택/이름변경/복제/삭제/드래그 재정렬)
  if (templateId === '__custom') return <CustomLayerPanel />
  return <SimpleLayerPanel />
}

function SimpleLayerPanel() {
  const { animationData, toggleLayer } = useEditor()
  if (!animationData) return null
  const layers = getLayers(animationData)

  return (
    <div className="panel__section">
      <h3 className="panel__label">레이어</h3>
      <ul className="layers">
        {layers.map((l) => (
          <li key={l.index} className={`layers__item ${l.hidden ? 'layers__item--off' : ''}`}>
            <button
              className="layers__eye"
              onClick={() => toggleLayer(l.index)}
              title={l.hidden ? '보이기' : '숨기기'}
            >
              {l.hidden ? '◌' : '●'}
            </button>
            <span className="layers__name">{l.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 커스텀 빌더용 레이어 패널 — 햄버거(≡) 홀드 드래그로 순서 변경. */
function CustomLayerPanel() {
  const {
    toggleLayer, setCustomIdx, duplicateCustomLayer, removeCustomLayer,
    renameCustomLayer, reorderCustomLayer,
  } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const dragRef = useRef<{ from: number; startY: number; step: number } | null>(null)

  if (!sourceData) return null
  const layers = sourceData.layers
  const idx = Math.min(customIdx, Math.max(0, layers.length - 1))

  const thumbOf = (l: Record<string, unknown>): string | null => {
    if (!l.refId) return null
    const asset = (sourceData.assets as Record<string, unknown>[] | undefined)?.find(
      (a) => a.id === l.refId,
    )
    return (asset?.p as string) ?? null
  }

  return (
    <div className="panel__section">
      <h3 className="panel__label">레이어</h3>
      <div className="layerlist">
        {layers.map((l, i) => {
          const lr = l as Record<string, unknown> & { nm?: string; hd?: boolean }
          const thumb = thumbOf(lr)
          const dragging = drag?.from === i
          const insertBefore = drag && drag.to === i && drag.to < drag.from
          const insertAfter = drag && drag.to === i && drag.to > drag.from
          return (
            <div
              key={i}
              className={[
                'layerrow',
                i === idx ? 'layerrow--on' : '',
                dragging ? 'layerrow--drag' : '',
                insertBefore ? 'layerrow--insbefore' : '',
                insertAfter ? 'layerrow--insafter' : '',
              ].join(' ')}
              onClick={() => setCustomIdx(i)}
            >
              <span
                className="colordot"
                style={{ background: layerColor(lr, i) }}
              />
              {thumb ? (
                <img className="layerrow__thumb" src={thumb} alt="" />
              ) : (
                <span className="layerrow__thumb layerrow__thumb--svg">◇</span>
              )}
              {editingIdx === i ? (
                <input
                  className="layerrow__rename"
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    renameCustomLayer(i, nameDraft)
                    setEditingIdx(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditingIdx(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="layerrow__name"
                  title="더블클릭: 이름 변경"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditingIdx(i)
                    setNameDraft(String(lr.nm ?? ''))
                  }}
                >
                  {lr.nm ?? `레이어 ${i + 1}`}
                </span>
              )}
              <button
                className={`layerrow__btn ${lr.hd ? 'layerrow__btn--off' : ''}`}
                title="표시/숨김"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleLayer(i)
                }}
              >
                {lr.hd ? '◌' : '●'}
              </button>
              <button
                className="layerrow__btn"
                title="복제 (⌘D)"
                onClick={(e) => {
                  e.stopPropagation()
                  duplicateCustomLayer(i)
                }}
              >
                ⧉
              </button>
              <button
                className="layerrow__del"
                title="레이어 삭제 (Delete)"
                onClick={(e) => {
                  e.stopPropagation()
                  removeCustomLayer(i)
                }}
              >
                ×
              </button>
              {/* 햄버거 핸들 — 누른 채로 끌면 순서 변경 */}
              <button
                className="layerrow__grip"
                title="드래그로 순서 변경"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  const row = (e.currentTarget as HTMLElement).closest('.layerrow') as HTMLElement
                  dragRef.current = {
                    from: i,
                    startY: e.clientY,
                    step: (row?.offsetHeight ?? 34) + 4, // gap 포함
                  }
                  setDrag({ from: i, to: i })
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current
                  if (!d) return
                  const to = Math.max(
                    0,
                    Math.min(
                      layers.length - 1,
                      d.from + Math.round((e.clientY - d.startY) / d.step),
                    ),
                  )
                  setDrag({ from: d.from, to })
                }}
                onPointerUp={(e) => {
                  const d = dragRef.current
                  dragRef.current = null
                  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                  const cur = drag
                  setDrag(null)
                  if (d && cur && cur.to !== d.from) reorderCustomLayer(d.from, cur.to)
                }}
                onPointerCancel={() => {
                  dragRef.current = null
                  setDrag(null)
                }}
              >
                ≡
              </button>
            </div>
          )
        })}
      </div>
      <p className="panel__hint">≡를 누른 채 끌면 순서가 바뀝니다 (위 = 앞).</p>
    </div>
  )
}
