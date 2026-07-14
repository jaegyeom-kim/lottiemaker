import { useState } from 'react'
import { templates, categories, type TemplateDef } from '../templates'
import { useEditor, loadSavedSession } from '../store'
import type { LottieJson } from '../lib/lottieUtils'
import { durationKnob } from '../lib/lottieKnobs'
import LottiePlayer from './LottiePlayer'
import CustomBuilder from './CustomBuilder'

export default function TemplateGallery() {
  const loadTemplate = useEditor((s) => s.loadTemplate)
  // 훅은 조건부 return보다 먼저 — 사이드 전환 시 훅 순서 불변
  const currentId = useEditor((s) => s.templateId)
  const [category, setCategory] = useState<string>('all')
  const [side, setSide] = useState<'tpl' | 'custom'>('tpl')

  const list = category === 'all' ? templates : templates.filter((t) => t.category === category)

  const pick = (t: TemplateDef) => {
    // 진행 중인 커스텀 작업 보호 — 템플릿 로드는 히스토리까지 파기한다
    const s = useEditor.getState()
    if (
      s.templateId === '__custom' &&
      s.past.length > 0 &&
      !window.confirm('커스텀 작업이 사라집니다. 템플릿을 열까요?')
    )
      return
    loadTemplate(structuredClone(t.data) as LottieJson, t.id, [
      ...t.knobs,
      durationKnob(t.data as LottieJson),
    ])
  }

  if (side === 'custom') {
    return (
      <aside className="gallery">
        <div className="gallery__head">
          <SideTabs side={side} setSide={setSide} />
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
        <SideTabs side={side} setSide={setSide} />
        {savedTpl && currentId !== savedTpl.templateId && (
          <button
            className="btn btn--secondary btn--full"
            style={{ marginBottom: 8 }}
            onClick={() => useEditor.getState().restoreSession(savedTpl)}
          >
            이전 템플릿 작업 이어하기
          </button>
        )}
        <div className="gallery__cats">
          <button
            className={`chip ${category === 'all' ? 'chip--on' : ''}`}
            onClick={() => setCategory('all')}
          >
            전체
          </button>
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
          <Tile key={t.id} template={t} onPick={pick} />
        ))}
      </div>
    </aside>
  )
}

function SideTabs({
  side,
  setSide,
}: {
  side: 'tpl' | 'custom'
  setSide: (s: 'tpl' | 'custom') => void
}) {
  return (
    <div className="opttabs opttabs--gallery">
      <button className={`opttab ${side === 'tpl' ? 'opttab--on' : ''}`} onClick={() => setSide('tpl')}>
        템플릿
      </button>
      <button
        className={`opttab ${side === 'custom' ? 'opttab--on' : ''}`}
        onClick={() => setSide('custom')}
      >
        커스텀
      </button>
    </div>
  )
}

/** 평소엔 대표 프레임 정지, 호버 시 재생 — 24개 동시 재생으로 인한 부하 방지. */
function Tile({ template, onPick }: { template: TemplateDef; onPick: (t: TemplateDef) => void }) {
  const [hover, setHover] = useState(false)
  const poster = Math.floor(((template.data as LottieJson).op ?? 60) / 2)

  return (
    <button
      className="tile"
      onClick={() => onPick(template)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={template.label}
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
