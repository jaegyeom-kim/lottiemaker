import { useState } from 'react'
import { templates, categories, type TemplateDef } from '../templates'
import { useEditor, loadSavedSession } from '../store'
import type { LottieJson } from '../lib/lottieUtils'
import { durationKnob } from '../lib/lottieKnobs'
import LottiePlayer from './LottiePlayer'
import CustomBuilder from './CustomBuilder'

const RECENT_KEY = 'lottiemaker.recent.templates'

function loadRecents(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(arr) ? arr.filter((id) => templates.some((t) => t.id === id)) : []
  } catch {
    return []
  }
}

export default function TemplateGallery() {
  const loadTemplate = useEditor((s) => s.loadTemplate)
  // 훅은 조건부 return보다 먼저 — 사이드 전환 시 훅 순서 불변
  const currentId = useEditor((s) => s.templateId)
  // 사이드바 탭 = 전역 작업 모드 — 캔버스·우측 패널과 항상 함께 전환된다
  const mode = useEditor((s) => s.mode)
  const [category, setCategory] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(loadRecents)

  const byCategory =
    category === 'recent'
      ? recents.map((id) => templates.find((t) => t.id === id)).filter(Boolean) as TemplateDef[]
      : category === 'all'
        ? templates
        : templates.filter((t) => t.category === category)
  const q = query.trim().toLowerCase()
  const list = q
    ? byCategory.filter((t) => t.label.toLowerCase().includes(q) || t.id.includes(q))
    : byCategory

  const pick = (t: TemplateDef) => {
    loadTemplate(structuredClone(t.data) as LottieJson, t.id, [
      ...t.knobs,
      durationKnob(t.data as LottieJson),
    ])
    // 최근 사용 기록 — 맨 앞으로, 최대 8개
    const next = [t.id, ...recents.filter((id) => id !== t.id)].slice(0, 8)
    setRecents(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      // 저장 불가 환경 — 무시
    }
  }

  if (mode === 'custom') {
    return (
      <aside className="gallery">
        <div className="gallery__head">
          <SideTabs />
        </div>
        <div className="gallery__body">
          <CustomBuilder />
        </div>
      </aside>
    )
  }

  const savedTpl = loadSavedSession('template')

  return (
    <aside className="gallery">
      <div className="gallery__head">
        <SideTabs />
        {savedTpl && currentId !== savedTpl.templateId && (
          <button
            className="btn btn--secondary btn--full"
            style={{ marginBottom: 8 }}
            onClick={() => useEditor.getState().restoreSession(savedTpl)}
          >
            이전 템플릿 작업 이어하기
          </button>
        )}
        <input
          className="gallery__search"
          type="search"
          placeholder="템플릿 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="gallery__cats">
          <button
            className={`chip ${category === 'all' ? 'chip--on' : ''}`}
            onClick={() => setCategory('all')}
          >
            전체
          </button>
          {recents.length > 0 && (
            <button
              className={`chip ${category === 'recent' ? 'chip--on' : ''}`}
              onClick={() => setCategory('recent')}
            >
              최근
            </button>
          )}
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip ${category === c.id ? 'chip--on' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="gallery__grid">
        {list.map((t) => (
          <Tile key={t.id} template={t} onPick={pick} current={t.id === currentId} />
        ))}
        {list.length === 0 && (
          <p className="gallery__none">"{query}"에 맞는 템플릿이 없어요.</p>
        )}
      </div>
    </aside>
  )
}

/** 모드 탭 — 전환 시 작업공간이 통째로 스왑되므로 어느 쪽 작업도 사라지지 않는다. */
function SideTabs() {
  const mode = useEditor((s) => s.mode)
  const setMode = useEditor((s) => s.setMode)
  return (
    <div className="opttabs opttabs--gallery">
      <button
        className={`opttab ${mode === 'template' ? 'opttab--on' : ''}`}
        onClick={() => setMode('template')}
      >
        템플릿
      </button>
      <button
        className={`opttab ${mode === 'custom' ? 'opttab--on' : ''}`}
        onClick={() => setMode('custom')}
      >
        커스텀
      </button>
    </div>
  )
}

/** 평소엔 대표 프레임 정지, 호버 시 재생 — 24개 동시 재생으로 인한 부하 방지. */
function Tile({
  template,
  onPick,
  current,
}: {
  template: TemplateDef
  onPick: (t: TemplateDef) => void
  current?: boolean
}) {
  const [hover, setHover] = useState(false)
  const poster = Math.floor(((template.data as LottieJson).op ?? 60) / 2)

  return (
    <button
      className={`tile ${current ? 'tile--current' : ''}`}
      onClick={() => onPick(template)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={current ? `${template.label} (현재 열려 있음)` : template.label}
    >
      <LottiePlayer
        data={template.data}
        playing={hover}
        seekFrame={hover ? null : poster}
        className="tile__anim"
      />
      <span className="tile__label">{template.label}</span>
    </button>
  )
}
