import { useEffect, useState } from 'react'
import { evalNumExpr } from '../lib/num'
import { t } from '../lib/i18n'
import { useEditor } from '../store'
import { rgbArrayToHex, type ColorGroup, type ColorRef } from '../lib/lottieColors'

/** 경로를 따라가 색상 배열을 hex로 — 원본(pristine) 색 조회용. */
function colorAtPath(doc: unknown, path: (string | number)[]): string | null {
  let cur: unknown = doc
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return null
    cur = (cur as Record<string | number, unknown>)[p]
  }
  return Array.isArray(cur) && cur.length >= 3 && cur.every((n) => typeof n === 'number')
    ? rgbArrayToHex(cur as number[])
    : null
}

export default function ColorEditor() {
  const { colorGroups, setColorLive, commitEdit, animationData, setSize } = useEditor()
  const pristineData = useEditor((s) => s.pristineData)

  if (!animationData) return null

  // 그룹별 원본 색 — 하나라도 바뀌었으면 ↺ 표시
  const origOf = (g: ColorGroup): Map<string, ColorRef[]> | null => {
    if (!pristineData) return null
    const byOrig = new Map<string, ColorRef[]>()
    for (const ref of g.refs) {
      const oh = colorAtPath(pristineData, ref.path)
      if (!oh) return null // 구조가 달라졌으면(그래픽 교체 등) 복원 불가
      const arr = byOrig.get(oh) ?? []
      arr.push(ref)
      byOrig.set(oh, arr)
    }
    return byOrig
  }

  const resetGroup = (g: ColorGroup) => {
    const byOrig = origOf(g)
    if (!byOrig) return
    // 원래 서로 달랐던 색이 한 그룹으로 합쳐졌어도 각자 제 원색으로
    for (const [oh, refs] of byOrig) setColorLive({ hex: g.hex, refs }, oh)
    commitEdit()
  }

  return (
    <div className="panel__section">
      {colorGroups.length === 0 ? (
        <p className="panel__hint">{t('편집 가능한 단색 fill/stroke가 없습니다.')}</p>
      ) : (
        <div className="colors">
          {colorGroups.map((g, i) => {
            const byOrig = origOf(g)
            const changed = byOrig ? [...byOrig.keys()].some((oh) => oh !== g.hex) : false
            return (
              // key는 인덱스 — hex를 key로 쓰면 드래그 중 리마운트로 네이티브 피커가 닫힌다
              <div key={i} className="colors__item" title={t('{n}곳에서 사용').replace('{n}', String(g.refs.length))}>
                <input
                  type="color"
                  value={g.hex}
                  onChange={(e) => setColorLive(g, e.target.value)}
                  onBlur={commitEdit}
                />
                <HexInput
                  value={g.hex}
                  onCommit={(hex) => {
                    setColorLive(g, hex)
                    commitEdit()
                  }}
                />
                <span className="colors__count">{g.refs.length}</span>
                {changed && (
                  <button
                    className="colors__reset"
                    title={t('원래 색으로 되돌리기')}
                    onClick={() => resetGroup(g)}
                  >
                    ↺
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <h3 className="panel__label">{t('크기')}</h3>
      <div className="sizerow">
        <SizeInput value={animationData.w} onCommit={(v) => setSize(v, animationData.h)} />
        <span>×</span>
        <SizeInput value={animationData.h} onCommit={(v) => setSize(animationData.w, v)} />
        <span className="panel__hint">px · {animationData.fr}fps</span>
      </div>
    </div>
  )
}

/** hex 직접 입력 — #없이도 허용, blur/Enter 커밋, 잘못된 값은 원복. */
function HexInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])

  const commit = () => {
    setFocused(false)
    const v = draft.trim().replace(/^#/, '').toLowerCase()
    const full =
      /^[0-9a-f]{6}$/.test(v) ? v : /^[0-9a-f]{3}$/.test(v) ? v.replace(/./g, (c) => c + c) : null
    if (full && `#${full}` !== value) onCommit(`#${full}`)
    else setDraft(value)
  }

  return (
    <input
      className="colors__hexinput"
      value={focused ? draft : value}
      spellCheck={false}
      onFocus={() => {
        setFocused(true)
        setDraft(value)
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          e.stopPropagation() // 입력 취소만 — 그래프 에디터 등 닫힘 방지
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** 키 입력마다 커밋하지 않고 blur/Enter에서만 반영 — 빈 값이 1px로 강제되는 문제 방지. */
function SizeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    const v = evalNumExpr(draft, value)
    if (v !== null && v >= 16 && v <= 4096) {
      if (Math.round(v) !== value) onCommit(Math.round(v))
    } else {
      setDraft(String(value))
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      title={t('산술 입력 가능 — 512+128, /2')}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
