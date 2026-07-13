import { useState } from 'react'
import { templates, categories, type TemplateDef } from '../templates'
import { useEditor } from '../store'
import type { LottieJson } from '../lib/lottieUtils'
import { durationKnob } from '../lib/lottieKnobs'
import LottiePlayer from './LottiePlayer'
import CustomBuilder from './CustomBuilder'

export default function TemplateGallery() {
  const loadTemplate = useEditor((s) => s.loadTemplate)
  const [category, setCategory] = useState<string>('all')
  const [side, setSide] = useState<'tpl' | 'custom'>('tpl')

  const list = category === 'all' ? templates : templates.filter((t) => t.category === category)

  const pick = (t: TemplateDef) => {
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

  return (
    <aside className="gallery">
      <div className="gallery__head">
        <SideTabs side={side} setSide={setSide} />
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
