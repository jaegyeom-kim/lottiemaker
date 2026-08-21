import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { useEditor } from '../store'
import { svgToLottie } from '../lib/svgImport'
import { idbLibList, idbLibDel, type LibItem } from '../lib/sessionStore'

/** 라이브러리 그리드 — 저장한 그래픽을 문서 간 재사용 (클릭 = 캔버스 중앙에 추가). */
export default function LibraryPanel() {
  const addCustomLayer = useEditor((s) => s.addCustomLayer)
  const [items, setItems] = useState<LibItem[]>([])
  const refresh = () => idbLibList().then(setItems).catch(() => setItems([]))
  useEffect(() => {
    void refresh()
    // 저장 버튼(TransformPanel)에서 갱신 신호
    const on = () => void refresh()
    window.addEventListener('lm:library-changed', on)
    return () => window.removeEventListener('lm:library-changed', on)
  }, [])

  if (!items.length)
    return (
      <p className="panel__hint">
        {t('라이브러리 비어 있음 — 레이어 선택 후 properties의 “라이브러리에 저장”')}
      </p>
    )
  return (
    <div className="libgrid">
      {items.map((it) => (
        <div key={it.id} className="libgrid__item" title={`${it.name} — ${t('클릭: 캔버스에 추가')}`}>
          <button
            className="libgrid__thumb"
            onClick={() => {
              if (it.kind === 'svg')
                addCustomLayer({ kind: 'svg', graphic: svgToLottie(it.data) }, it.name)
              else
                addCustomLayer(
                  { kind: 'image', image: { dataUri: it.data, w: it.w ?? 256, h: it.h ?? 256 } },
                  it.name,
                )
            }}
          >
            <img
              src={
                it.kind === 'svg'
                  ? `data:image/svg+xml;utf8,${encodeURIComponent(it.data)}`
                  : it.data
              }
              alt={it.name}
            />
          </button>
          <span className="libgrid__name">{it.name}</span>
          <button
            className="libgrid__del"
            title={t('삭제')}
            onClick={async () => {
              await idbLibDel(it.id)
              void refresh()
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
