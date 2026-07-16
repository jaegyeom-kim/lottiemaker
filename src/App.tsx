import { useEffect, useState } from 'react'
import { useEditor, loadLastSession } from './store'
import TemplateGallery from './components/TemplateGallery'
import Preview from './components/Preview'
import ColorEditor from './components/ColorEditor'
import TemplateOptions from './components/TemplateOptions'
import CustomGraphic from './components/CustomGraphic'
import AlignPanel from './components/AlignPanel'
import LayerPanel from './components/LayerPanel'
import ExportPanel from './components/ExportPanel'
import './App.css'

type Tab = 'edit' | 'export'
/** 테마 설정 — dark/light 고정 또는 시스템 설정 따라가기. */
type ThemePref = 'dark' | 'light' | 'system'

const THEME_KEY = 'lottiemaker.theme'
const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON: Record<ThemePref, string> = { system: '◐', light: '☀︎', dark: '☾︎' }
const THEME_LABEL: Record<ThemePref, string> = { system: '시스템 설정', light: '라이트', dark: '다크' }

/** 저장된 설정 없으면 시스템 따라가기 (구버전 'light'/'dark' 저장값도 그대로 존중). */
function initialThemePref(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'light' || t === 'dark' || t === 'system' ? t : 'system'
  } catch {
    return 'system'
  }
}

export default function App() {
  const { undo, redo, past, future, animationData } = useEditor()
  const mode = useEditor((s) => s.mode)
  const saveStatus = useEditor((s) => s.saveStatus)
  const [tab, setTab] = useState<Tab>('edit')
  const [themePref, setThemePref] = useState<ThemePref>(initialThemePref)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    const apply = () => {
      const resolved = themePref === 'system' ? (mq?.matches ? 'light' : 'dark') : themePref
      document.documentElement.dataset.theme = resolved
    }
    apply()
    try {
      localStorage.setItem(THEME_KEY, themePref)
    } catch {
      // 저장 불가 환경 — 무시
    }
    // 시스템 모드일 땐 OS 설정 변경을 실시간 반영
    if (themePref === 'system' && mq) {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [themePref])

  // 시작 시 자동 저장된 작업 복원 (한 번만)
  useEffect(() => {
    const s = useEditor.getState()
    if (!s.animationData) {
      const saved = loadLastSession()
      if (saved) s.restoreSession(saved)
    }
  }, [])

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
      // 스페이스: 재생/일시정지 (커스텀 빌더에선 프리뷰 토글 겸용)
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
          {/* 실제 저장 결과 기준 — 저장 안 되는 세션(외부 파일·용량 초과)에 거짓 배지 금지 */}
          {animationData && saveStatus === 'saved' && (
            <span className="topbar__saved">자동 저장됨</span>
          )}
          {animationData && saveStatus === 'blocked' && (
            <span className="topbar__saved topbar__saved--warn" title="용량이 커서 자동 저장할 수 없습니다. 내보내기 탭에서 프로젝트 파일로 저장하세요.">
              자동 저장 안 됨
            </span>
          )}
          <button
            className="btn btn--icon"
            onClick={() => setThemePref(THEME_NEXT[themePref])}
            title={`테마: ${THEME_LABEL[themePref]} — 클릭하면 ${THEME_LABEL[THEME_NEXT[themePref]]}`}
          >
            {THEME_ICON[themePref]}
          </button>
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
                // 모드별 패널 구성 — 템플릿: 그래픽 교체 / 커스텀: 정렬
                mode === 'custom' ? (
                  <>
                    <TemplateOptions />
                    <AlignPanel />
                    <ColorEditor />
                    <LayerPanel />
                  </>
                ) : (
                  <>
                    <TemplateOptions />
                    <CustomGraphic />
                    <ColorEditor />
                    <LayerPanel />
                  </>
                )
              ) : (
                <p className="panel__hint panel__hint--pad">
                  {mode === 'custom'
                    ? '그래픽(SVG/PNG)을 업로드하면 편집 옵션이 나타납니다.'
                    : '템플릿을 선택하면 편집 옵션이 나타납니다.'}
                </p>
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
