import { useEffect, useState } from 'react'
import { useEditor } from '../store'

export default function ColorEditor() {
  const { colorGroups, setColorLive, commitEdit, animationData, setSize } = useEditor()

  if (!animationData) return null

  return (
    <div className="panel__section">
      <h3 className="panel__label">색상</h3>
      {colorGroups.length === 0 ? (
        <p className="panel__hint">편집 가능한 단색 fill/stroke가 없습니다.</p>
      ) : (
        <div className="colors">
          {colorGroups.map((g, i) => (
            // key는 인덱스 — hex를 key로 쓰면 드래그 중 리마운트로 네이티브 피커가 닫힌다
            <label key={i} className="colors__item" title={`${g.refs.length}곳에서 사용`}>
              <input
                type="color"
                value={g.hex}
                onChange={(e) => setColorLive(g, e.target.value)}
                onBlur={commitEdit}
              />
              <span className="colors__hex">{g.hex}</span>
              <span className="colors__count">{g.refs.length}</span>
            </label>
          ))}
        </div>
      )}

      <h3 className="panel__label">크기</h3>
      <div className="sizerow">
        <SizeInput value={animationData.w} onCommit={(v) => setSize(v, animationData.h)} />
        <span>×</span>
        <SizeInput value={animationData.h} onCommit={(v) => setSize(animationData.w, v)} />
        <span className="panel__hint">px · {animationData.fr}fps</span>
      </div>
    </div>
  )
}

/** 키 입력마다 커밋하지 않고 blur/Enter에서만 반영 — 빈 값이 1px로 강제되는 문제 방지. */
function SizeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    const v = Number(draft)
    if (Number.isFinite(v) && v >= 16 && v <= 4096) {
      if (Math.round(v) !== value) onCommit(Math.round(v))
    } else {
      setDraft(String(value))
    }
  }

  return (
    <input
      type="number"
      min={16}
      max={4096}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
