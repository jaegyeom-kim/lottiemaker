import { useState } from 'react'
import { templates, categories, type TemplateDef } from '../templates'
import { useEditor, loadSavedSession } from '../store'
import type { LottieJson } from '../lib/lottieUtils'
import { durationKnob } from '../lib/lottieKnobs'
import { t } from '../lib/i18n'
import LottiePlayer from './LottiePlayer'
import CustomBuilder from './CustomBuilder'

const RECENT_KEY = 'lottiemaker.recent.templates'
const FAV_KEY = 'lottiemaker.fav.templates'

function loadIds(key: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]')
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
  const [recents, setRecents] = useState<string[]>(() => loadIds(RECENT_KEY))
  const [favs, setFavs] = useState<string[]>(() => loadIds(FAV_KEY))

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id]
    setFavs(next)
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next))
    } catch {
      // 저장 불가 환경 — 무시
    }
  }

  const byCategory =
    category === 'recent'
      ? recents.map((id) => templates.find((t) => t.id === id)).filter(Boolean) as TemplateDef[]
      : category === 'fav'
        ? templates.filter((t) => favs.includes(t.id))
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
            {t('이전 템플릿 작업 이어하기')}
          </button>
        )}
        <input
          className="gallery__search"
          type="search"
          placeholder={t('템플릿 검색')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="gallery__cats">
          <button
            className={`chip ${category === 'all' ? 'chip--on' : ''}`}
            onClick={() => setCategory('all')}
          >
            {t('전체')}
          </button>
          {favs.length > 0 && (
            <button
              className={`chip ${category === 'fav' ? 'chip--on' : ''}`}
              onClick={() => setCategory('fav')}
            >
              {t('★ 즐겨찾기')}
            </button>
          )}
          {recents.length > 0 && (
            <button
              className={`chip ${category === 'recent' ? 'chip--on' : ''}`}
              onClick={() => setCategory('recent')}
            >
              {t('최근')}
            </button>
          )}
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip ${category === c.id ? 'chip--on' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {t(c.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="gallery__grid">
        {list.map((t) => (
          <Tile
            key={t.id}
            template={t}
            onPick={pick}
            current={t.id === currentId}
            fav={favs.includes(t.id)}
            onToggleFav={toggleFav}
          />
        ))}
        {list.length === 0 && (
          <p className="gallery__none">{t('"{q}"에 맞는 템플릿이 없어요.').replace('{q}', query)}</p>
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
        {t('템플릿')}
      </button>
      <button
        className={`opttab ${mode === 'custom' ? 'opttab--on' : ''}`}
        onClick={() => setMode('custom')}
      >
        {t('커스텀')}
      </button>
    </div>
  )
}

/** 평소엔 대표 프레임 정지, 호버 시 재생 — 24개 동시 재생으로 인한 부하 방지. */
function Tile({
  template,
  onPick,
  current,
  fav,
  onToggleFav,
}: {
  template: TemplateDef
  onPick: (t: TemplateDef) => void
  current?: boolean
  fav?: boolean
  onToggleFav?: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  const poster = Math.floor(((template.data as LottieJson).op ?? 60) / 2)

  return (
    <button
      className={`tile ${current ? 'tile--current' : ''}`}
      onClick={() => onPick(template)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={
        current
          ? t('{label} (현재 열려 있음)').replace('{label}', t(template.label))
          : t(template.label)
      }
    >
      <LottiePlayer
        data={template.data}
        playing={hover}
        seekFrame={hover ? null : poster}
        className="tile__anim"
      />
      <span className="tile__label">{t(template.label)}</span>
      {/* 즐겨찾기 별 — 호버 또는 이미 즐겨찾기일 때만 표시 */}
      {(hover || fav) && onToggleFav && (
        <span
          className={`tile__fav ${fav ? 'tile__fav--on' : ''}`}
          title={fav ? t('즐겨찾기 해제') : t('즐겨찾기')}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav(template.id)
          }}
        >
          {fav ? '★' : '☆'}
        </span>
      )}
    </button>
  )
}
