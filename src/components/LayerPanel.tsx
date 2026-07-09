import { useEditor } from '../store'
import { getLayers } from '../lib/lottieUtils'

export default function LayerPanel() {
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
