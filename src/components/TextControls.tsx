import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../lib/i18n'
import { useEditor, type TextMeta } from '../store'
import { svgToLottie } from '../lib/svgImport'
import { idbFontList } from '../lib/sessionStore'
import { registerFont, loadFont, textToSvg, DEFAULT_TEXT_SPEC } from '../lib/textTool'
import { PosInput } from './CustomBuilder'

/** 폰트 목록 + 업로드 — 다이얼로그·패널 공용 셀렉터. */
function FontPicker({
  value,
  onChange,
  onError,
}: {
  value: string
  onChange: (name: string) => void
  onError: (msg: string) => void
}) {
  const [fonts, setFonts] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const refresh = () =>
    idbFontList()
      .then((l) => setFonts(l))
      .catch(() => setFonts([]))
  useEffect(() => {
    void refresh()
  }, [])
  return (
    <div className="fontpicker">
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={t('업로드한 폰트 (.ttf/.otf) — 세션 간 유지')}
      >
        {!fonts.length && <option value="">{t('폰트 없음 — 업로드하세요')}</option>}
        {fonts.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <button className="btn btn--secondary" onClick={() => fileRef.current?.click()}>
        {t('폰트 업로드')}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".ttf,.otf"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try {
            const name = file.name.replace(/\.(ttf|otf)$/i, '')
            await registerFont(name, await file.arrayBuffer())
            await refresh()
            onChange(name)
          } catch {
            onError(t('폰트 파싱 실패 — ttf/otf 파일인지 확인하세요'))
          }
        }}
      />
    </div>
  )
}

/** 텍스트 추가 다이얼로그 — 드로잉 툴바 T 버튼. */
export function TextDialog({ onClose }: { onClose: () => void }) {
  const addCustomLayer = useEditor((s) => s.addCustomLayer)
  const [font, setFont] = useState('')
  const [text, setText] = useState(DEFAULT_TEXT_SPEC.text)
  const [size, setSize] = useState(DEFAULT_TEXT_SPEC.size)
  const [err, setErr] = useState('')
  useEffect(() => {
    void idbFontList().then((l) => {
      if (l.length && !font) setFont(l[0])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const add = async () => {
    setErr('')
    try {
      const f = font ? await loadFont(font) : null
      if (!f) {
        setErr(t('폰트를 먼저 업로드하세요 (.ttf/.otf)'))
        return
      }
      const built = textToSvg(f, { text, size, lh: DEFAULT_TEXT_SPEC.lh })
      if (!built) {
        setErr(t('빈 텍스트'))
        return
      }
      addCustomLayer(
        { kind: 'svg', graphic: svgToLottie(built.svg) },
        t('텍스트'),
        [256, 256],
        built.size,
        undefined,
        { text, font, size, lh: DEFAULT_TEXT_SPEC.lh },
      )
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  return createPortal(
    <div className="shortcuts" onClick={onClose}>
      <div className="shortcuts__panel textdlg" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts__head">
          <strong>{t('텍스트 추가')}</strong>
          <span className="shortcuts__hint">{t('폰트를 패스로 변환 — 어디서든 렌더되는 로티')}</span>
          <button className="gepanel__close" onClick={onClose}>✕</button>
        </div>
        <FontPicker value={font} onChange={setFont} onError={setErr} />
        <textarea
          className="input textdlg__text"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="posrow">
          <PosInput label={`${t('크기')} px`} value={size} onCommit={(v) => setSize(Math.max(8, v))} />
          <button className="btn btn--primary" onClick={add}>
            {t('추가')}
          </button>
        </div>
        {err && <p className="panel__error">{err}</p>}
      </div>
    </div>,
    document.body,
  )
}

/** properties 텍스트 섹션 — xtext 레이어의 내용·크기·폰트 재생성. */
export function TextSection({ idx, meta }: { idx: number; meta: TextMeta }) {
  const applyTextGraphic = useEditor((s) => s.applyTextGraphic)
  const sourceData = useEditor((s) => s.sourceData)
  const [draft, setDraft] = useState(meta.text)
  const [err, setErr] = useState('')
  useEffect(() => setDraft(meta.text), [meta.text, idx])

  const regen = async (patch: Partial<TextMeta>) => {
    setErr('')
    const next: TextMeta = { ...meta, ...patch }
    const f = await loadFont(next.font)
    if (!f) {
      setErr(t('폰트를 찾을 수 없습니다 — 다시 업로드하세요'))
      return
    }
    const built = textToSvg(f, next)
    if (!built) return
    const layer = sourceData?.layers[idx] as Record<string, unknown> | undefined
    const base: [number, number] = Array.isArray(layer?.xbase)
      ? [(layer.xbase as number[])[0], (layer.xbase as number[])[1]]
      : [256, 256]
    applyTextGraphic(idx, { kind: 'svg', graphic: svgToLottie(built.svg) }, base, built.size, next)
  }

  return (
    <div className="knob">
      <div className="knob__head">
        <span className="knob__name">{t('텍스트')}</span>
        <span className="knob__unit">{meta.font}</span>
      </div>
      <textarea
        className="input textdlg__text"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== meta.text && draft.trim()) void regen({ text: draft })
        }}
      />
      <div className="posrow">
        <PosInput label={`${t('크기')} px`} value={meta.size} onCommit={(v) => void regen({ size: Math.max(8, v) })} />
        <PosInput label={t('줄간격')} value={meta.lh} onCommit={(v) => void regen({ lh: Math.max(0.5, Math.min(3, v)) })} />
      </div>
      <FontPicker value={meta.font} onChange={(name) => void regen({ font: name })} onError={setErr} />
      {err && <p className="panel__error">{err}</p>}
    </div>
  )
}
