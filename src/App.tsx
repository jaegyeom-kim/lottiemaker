import { useEffect, useState } from 'react'
import { useEditor } from './store'
import TemplateGallery from './components/TemplateGallery'
import Preview from './components/Preview'
import ColorEditor from './components/ColorEditor'
import TemplateOptions from './components/TemplateOptions'
import CustomGraphic from './components/CustomGraphic'
import LayerPanel from './components/LayerPanel'
import ExportPanel from './components/ExportPanel'
import './App.css'

type Tab = 'edit' | 'export'

export default function App() {
  const { undo, redo, past, future, animationData } = useEditor()
  const [tab, setTab] = useState<Tab>('edit')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 입력 필드 안에서는 텍스트 편집 undo를 가로채지 않는다
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // Shift를 누르면 key가 'Z'(대문자)가 되므로 소문자로 비교
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      // 스페이스: 재생/일시정지
      if (e.key === ' ') {
        const s = useEditor.getState()
        if (s.animationData) {
          e.preventDefault()
          s.setPlaying(!s.playing)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">◒</span>
          <h1 className="topbar__name">LottieMaker</h1>
          <span className="topbar__tag">로티, 빠르고 쉽게</span>
        </div>
        <div className="topbar__actions">
          <button className="btn btn--icon" onClick={undo} disabled={!past.length} title="실행 취소 (⌘Z)">
            ↩
          </button>
          <button className="btn btn--icon" onClick={redo} disabled={!future.length} title="다시 실행 (⇧⌘Z)">
            ↪
          </button>
        </div>
      </header>

      <main className="layout">
        <TemplateGallery />
        <Preview />
        <aside className="panel">
          <nav className="tabs">
            <button className={`tabs__btn ${tab === 'edit' ? 'tabs__btn--on' : ''}`} onClick={() => setTab('edit')}>
              편집
            </button>
            <button
              className={`tabs__btn ${tab === 'export' ? 'tabs__btn--on' : ''}`}
              onClick={() => setTab('export')}
            >
              내보내기
            </button>
          </nav>
          <div className="panel__body">
            {tab === 'edit' &&
              (animationData ? (
                <>
                  <TemplateOptions />
                  <CustomGraphic />
                  <ColorEditor />
                  <LayerPanel />
                </>
              ) : (
                <p className="panel__hint panel__hint--pad">로티를 먼저 열어주세요.</p>
              ))}
            {tab === 'export' &&
              (animationData ? (
                <ExportPanel />
              ) : (
                <p className="panel__hint panel__hint--pad">내보낼 로티가 없습니다.</p>
              ))}
          </div>
        </aside>
      </main>
    </div>
  )
}
