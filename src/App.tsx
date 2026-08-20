import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditor, loadLastSession } from './store'
import { setDragCursor } from './lib/cursor'
import { getLang, setLangValue, t, type Lang } from './lib/i18n'
import TemplateGallery from './components/TemplateGallery'
import Preview from './components/Preview'
import ColorEditor from './components/ColorEditor'
import TemplateOptions from './components/TemplateOptions'
import CustomGraphic from './components/CustomGraphic'
import AlignPanel from './components/AlignPanel'
import TransformPanel from './components/TransformPanel'
import LayerPanel from './components/LayerPanel'
import Section from './components/Section'
import {
  UndoIcon, RedoIcon, LightModeIcon, DarkModeIcon, MatteIcon as AutoThemeIcon,
} from './components/icons'
import ExportPanel from './components/ExportPanel'
import './App.css'

type Tab = 'edit' | 'export'
/** 테마 설정 — dark/light 고정 또는 시스템 설정 따라가기. */
type ThemePref = 'dark' | 'light' | 'system'

// ── 리사이즈 가능한 3컬럼 레이아웃 ─────────────────────────
const LAYOUT_KEY = 'lottiemaker.layout.v1'
const LEFT_DEF = 240
const RIGHT_DEF = 300
const LEFT_MIN = 200
const RIGHT_MIN = 240
const SIDE_MAX = 480
/** 가운데 캔버스 최소 폭 — 창이 좁아지면 사이드가 양보한다. */
const CENTER_MIN = 360
/** 이 폭보다 좁아지면 우측 패널 자동 접힘, 넓어지면 자동 펼침 (수동 토글은 유지). */
const PANEL_BP = 1100

function loadLayout(): { left: number; right: number; panelOpen: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}')
    return {
      left: typeof raw.left === 'number' ? raw.left : LEFT_DEF,
      right: typeof raw.right === 'number' ? raw.right : RIGHT_DEF,
      panelOpen: raw.panelOpen !== false,
    }
  } catch {
    return { left: LEFT_DEF, right: RIGHT_DEF, panelOpen: true }
  }
}

/** 창 폭에 맞춰 사이드 폭 클램프 — 가운데가 CENTER_MIN 아래로 안 내려가게. */
function clampLayout(left: number, right: number, winW: number): { left: number; right: number } {
  let l = Math.max(LEFT_MIN, Math.min(SIDE_MAX, left))
  let r = Math.max(RIGHT_MIN, Math.min(SIDE_MAX, right))
  const DIVIDERS = 12 // 6px 핸들 × 2
  const over = l + r + DIVIDERS + CENTER_MIN - winW
  if (over > 0) {
    // 초과분을 양쪽에서 비례로 회수 (최소 폭은 지킴)
    const lGive = Math.min(l - LEFT_MIN, Math.ceil((over * l) / (l + r)))
    l -= lGive
    r = Math.max(RIGHT_MIN, r - (over - lGive))
  }
  return { left: l, right: r }
}

const THEME_KEY = 'lottiemaker.theme'
const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON: Record<ThemePref, ReactNode> = {
  system: <AutoThemeIcon />,
  light: <LightModeIcon />,
  dark: <DarkModeIcon />,
}
const THEME_LABEL: Record<ThemePref, string> = { system: '시스템 설정', light: '라이트 모드', dark: '다크 모드' }

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
  // 언어 — 전환 시 루트 key로 통째 리마운트해 모든 t()가 재평가된다
  const [lang, setLangState] = useState<Lang>(getLang)
  const toggleLang = () => {
    const next: Lang = lang === 'ko' ? 'en' : 'ko'
    setLangValue(next)
    setLangState(next)
  }
  // 패널 폭 — 드래그 리사이즈, 저장·복원, 창 크기 변화에 자동 클램프
  const [cols, setCols] = useState(() =>
    clampLayout(loadLayout().left, loadLayout().right, window.innerWidth),
  )
  // 우측(편집/내보내기) 패널 접기 — 접으면 아이콘 레일만 남는다.
  // 좁은 화면에선 시작부터 접힘, 넓은 화면은 저장된 수동 선택을 따른다
  const [panelOpen, setPanelOpen] = useState(() =>
    window.innerWidth < PANEL_BP ? false : loadLayout().panelOpen,
  )
  const colsRef = useRef(cols)
  colsRef.current = cols
  // 저장은 '수동 선택'만 — 자동 접힘/펼침이 사용자 선택으로 굳지 않게
  const manualPanelRef = useRef(loadLayout().panelOpen)

  useEffect(() => {
    let prevW = window.innerWidth
    const onResize = () => {
      const w = window.innerWidth
      // 경계 통과 시에만 자동 접힘/펼침 — 같은 구간 안에선 수동 선택 존중
      if (w < PANEL_BP && prevW >= PANEL_BP) setPanelOpen(false)
      else if (w >= PANEL_BP && prevW < PANEL_BP) setPanelOpen(true)
      prevW = w
      setCols((c) => clampLayout(c.left, c.right, w))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const saveCols = () => {
    try {
      localStorage.setItem(
        LAYOUT_KEY,
        JSON.stringify({ ...colsRef.current, panelOpen: manualPanelRef.current }),
      )
    } catch {
      // 저장 불가 환경 — 무시
    }
  }

  const togglePanel = (open: boolean, toTab?: Tab) => {
    setPanelOpen(open)
    manualPanelRef.current = open
    if (toTab) setTab(toTab)
    setTimeout(saveCols, 0)
  }

  /** 디바이더 드래그 — side: 'left' = 갤러리 경계, 'right' = 패널 경계. */
  const beginResize = (e: React.PointerEvent, side: 'left' | 'right') => {
    e.preventDefault()
    setDragCursor('col')
    const startX = e.clientX
    const start = { ...colsRef.current }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const next =
        side === 'left'
          ? clampLayout(start.left + dx, start.right, window.innerWidth)
          : clampLayout(start.left, start.right - dx, window.innerWidth)
      setCols(next)
    }
    const up = () => {
      setDragCursor(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      saveCols()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const resetCols = () => {
    setCols(clampLayout(LEFT_DEF, RIGHT_DEF, window.innerWidth))
    setTimeout(saveCols, 0)
  }
  // 테마 전환 피드백 토스트 — 뭘 선택했는지 잠깐 표시 후 자동 소멸
  const [themeToast, setThemeToast] = useState<{ pref: ThemePref; id: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cycleTheme = () => {
    const next = THEME_NEXT[themePref]
    setThemePref(next)
    setThemeToast({ pref: next, id: Date.now() })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setThemeToast(null), 1600)
  }

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
      else s.newBlankCustom() // 첫 실행 — 로드 없이 빈 커스텀 캔버스로 바로 시작
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 입력 필드 안에서는 텍스트 편집 undo를 가로채지 않는다
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
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
    <div className="app" key={lang}>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">◒</span>
          <h1 className="topbar__name">LottieMaker</h1>
          <span className="topbar__tag">{t('로티, 빠르고 쉽게')}</span>
        </div>
        <div className="topbar__actions">
          {/* 실제 저장 결과 기준 — 저장 안 되는 세션(외부 파일·용량 초과)에 거짓 배지 금지 */}
          {animationData && saveStatus === 'saved' && (
            <span className="topbar__saved">{t('자동 저장됨')}</span>
          )}
          {animationData && saveStatus === 'blocked' && (
            <span className="topbar__saved topbar__saved--warn" title={t('용량이 커서 자동 저장할 수 없습니다. 내보내기 탭에서 프로젝트 파일로 저장하세요.')}>
              {t('자동 저장 안 됨')}
            </span>
          )}
          <button
            className="btn btn--icon btn--lang"
            onClick={toggleLang}
            title={lang === 'ko' ? 'Switch to English' : '한국어로 전환'}
          >
            {lang === 'ko' ? '한' : 'EN'}
          </button>
          <button
            className="btn btn--icon"
            onClick={cycleTheme}
            title={t('테마: {cur} — 클릭하면 {next}')
              .replace('{cur}', t(THEME_LABEL[themePref]))
              .replace('{next}', t(THEME_LABEL[THEME_NEXT[themePref]]))}
          >
            {THEME_ICON[themePref]}
          </button>
          <button className="btn btn--icon" onClick={undo} disabled={!past.length} title={t('실행 취소 (⌘Z)')}>
            <UndoIcon />
          </button>
          <button className="btn btn--icon" onClick={redo} disabled={!future.length} title={t('다시 실행 (⇧⌘Z)')}>
            <RedoIcon />
          </button>
        </div>
      </header>

      {themeToast && (
        <div className="themetoast" key={themeToast.id}>
          <span className="themetoast__icon">{THEME_ICON[themeToast.pref]}</span>
          <span>
            {t(THEME_LABEL[themeToast.pref])}
            {themeToast.pref === 'system' &&
              ` · ${window.matchMedia?.('(prefers-color-scheme: light)').matches ? t('현재 라이트') : t('현재 다크')}`}
          </span>
        </div>
      )}

      <main
        className="layout"
        style={{
          gridTemplateColumns: panelOpen
            ? `${cols.left}px 6px 1fr 6px ${cols.right}px`
            : `${cols.left}px 6px 1fr 0px 36px`,
        }}
      >
        <TemplateGallery />
        <div
          className="divider"
          title={t('드래그: 너비 조절 · 더블클릭: 초기화')}
          onPointerDown={(e) => beginResize(e, 'left')}
          onDoubleClick={resetCols}
        />
        <Preview />
        <div
          className="divider"
          style={panelOpen ? undefined : { visibility: 'hidden' }}
          title={t('드래그: 너비 조절 · 더블클릭: 초기화')}
          onPointerDown={(e) => panelOpen && beginResize(e, 'right')}
          onDoubleClick={() => panelOpen && resetCols()}
        />
        {!panelOpen && (
          <aside className="panel panel--rail">
            {/* 접힘 상태엔 펼치기 버튼만 — 탭 버튼은 펼친 뒤에 */}
            <button className="panelrail__btn" title={t('패널 펼치기')} onClick={() => togglePanel(true)}>
              «
            </button>
          </aside>
        )}
        {panelOpen && (
        <aside className="panel">
          <nav className="tabs">
            <button className={`tabs__btn ${tab === 'edit' ? 'tabs__btn--on' : ''}`} onClick={() => setTab('edit')}>
              {t('편집')}
            </button>
            <button
              className={`tabs__btn ${tab === 'export' ? 'tabs__btn--on' : ''}`}
              onClick={() => setTab('export')}
            >
              {t('내보내기')}
            </button>
            <button
              className="tabs__collapse"
              title={t('패널 접기')}
              onClick={() => togglePanel(false)}
            >
              »
            </button>
          </nav>
          <div className="panel__body">
            {tab === 'edit' &&
              (animationData ? (
                // 모드별 패널 구성 — 템플릿: 그래픽 교체 / 커스텀: 정렬
                mode === 'custom' ? (
                  <>
                    <Section key="play" id="play" title="재생 설정">
                      <TemplateOptions />
                    </Section>
                    <Section key="props" id="props" title="속성">
                      <TransformPanel />
                    </Section>
                    <Section key="align" id="align" title="정렬">
                      <AlignPanel />
                    </Section>
                    <Section key="color" id="color" title="색상 · 크기">
                      <ColorEditor />
                    </Section>
                    <Section key="layers" id="layers" title="레이어">
                      <LayerPanel />
                    </Section>
                  </>
                ) : (
                  <>
                    <Section key="tplopts" id="tplopts" title="템플릿 옵션">
                      <TemplateOptions />
                    </Section>
                    <Section key="graphic" id="graphic" title="내 그래픽">
                      <CustomGraphic />
                    </Section>
                    <Section key="color" id="color" title="색상 · 크기">
                      <ColorEditor />
                    </Section>
                    <Section key="layers" id="layers" title="레이어">
                      <LayerPanel />
                    </Section>
                  </>
                )
              ) : (
                <p className="panel__hint panel__hint--pad">
                  {mode === 'custom'
                    ? t('그래픽(SVG/PNG)을 업로드하면 편집 옵션이 나타납니다.')
                    : t('템플릿을 선택하면 편집 옵션이 나타납니다.')}
                </p>
              ))}
            {tab === 'export' &&
              (animationData ? (
                <ExportPanel />
              ) : (
                <p className="panel__hint panel__hint--pad">{t('내보낼 로티가 없습니다.')}</p>
              ))}
          </div>
        </aside>
        )}
      </main>
    </div>
  )
}
