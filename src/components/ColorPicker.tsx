import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../lib/i18n'

// ── HSV ↔ hex ──
function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return [h, max ? d / max : 0, max]
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(5)}${f(3)}${f(1)}`
}

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> }
}

/**
 * 피그마식 컬러 피커 팝오버 — SV 스퀘어 + 휴 슬라이더 + 스포이드 + 헥스.
 * 드래그 = onLive(라이브), 닫기 = onCommit (언두 1스텝은 호출자 몫).
 */
export default function ColorPicker({
  value,
  anchor,
  onLive,
  onClose,
}: {
  value: string
  /** 팝오버 기준 사각형 (트리거 스와치). */
  anchor: DOMRect
  onLive: (hex: string) => void
  /** 닫힘 — 마지막 색으로 커밋할 것. */
  onClose: () => void
}) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value))
  const [h, s, v] = hsv
  const hex = hsvToHex(h, s, v)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 6 })

  // 화면 밖으로 안 나가게 배치
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - r.width - 8, anchor.left)),
      top:
        anchor.bottom + 6 + r.height > window.innerHeight - 8
          ? Math.max(8, anchor.top - r.height - 6)
          : anchor.bottom + 6,
    })
  }, [anchor])

  // 바깥 클릭 / Esc = 닫기(커밋)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  const apply = (next: [number, number, number]) => {
    setHsv(next)
    onLive(hsvToHex(next[0], next[1], next[2]))
  }

  const svDrag = (e: React.PointerEvent) => {
    const r = svRef.current?.getBoundingClientRect()
    if (!r) return
    const sx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const sy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    apply([h, sx, 1 - sy])
  }
  const hueDrag = (e: React.PointerEvent) => {
    const r = hueRef.current?.getBoundingClientRect()
    if (!r) return
    apply([Math.max(0, Math.min(359.9, ((e.clientX - r.left) / r.width) * 360)), s, v])
  }
  const dragHandlers = (move: (e: React.PointerEvent) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      move(e)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.buttons & 1) move(e)
    },
  })

  const pickEyedropper = async () => {
    const ED = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    if (!ED) return
    try {
      const res = await new ED().open()
      apply(hexToHsv(res.sRGBHex))
    } catch {
      // 사용자가 취소 — 무시
    }
  }

  const [draft, setDraft] = useState<string | null>(null)
  const commitHex = () => {
    if (draft === null) return
    const raw = draft.trim().replace(/^#/, '').toLowerCase()
    const full = /^[0-9a-f]{6}$/.test(raw)
      ? raw
      : /^[0-9a-f]{3}$/.test(raw)
        ? raw.replace(/./g, (c) => c + c)
        : null
    setDraft(null)
    if (full) apply(hexToHsv(`#${full}`))
  }

  return createPortal(
    <div ref={panelRef} className="cpicker" style={pos}>
      <div
        ref={svRef}
        className="cpicker__sv"
        style={{ backgroundColor: `hsl(${h}, 100%, 50%)` }}
        {...dragHandlers(svDrag)}
      >
        <div
          className="cpicker__svknob"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, backgroundColor: hex }}
        />
      </div>
      <div className="cpicker__row">
        {'EyeDropper' in window && (
          <button className="cpicker__eye" title={t('스포이드')} onClick={pickEyedropper}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="m19.4 7.34-2.74-2.74a2 2 0 0 0-2.83 0L12.4 6.03l-1.06-1.06-1.41 1.41 1.06 1.06-6.58 6.59a1 1 0 0 0-.29.7v3.04l-1.06 1.06 1.41 1.42 1.06-1.06h3.05a1 1 0 0 0 .7-.3l6.59-6.58 1.06 1.06 1.41-1.41-1.06-1.06 1.42-1.42a2 2 0 0 0 0-2.83Zm-11.6 10.4H5.86v-1.94l6.58-6.58 1.94 1.94-6.58 6.58Z" />
            </svg>
          </button>
        )}
        <div ref={hueRef} className="cpicker__hue" {...dragHandlers(hueDrag)}>
          <div className="cpicker__hueknob" style={{ left: `${(h / 360) * 100}%`, backgroundColor: `hsl(${h}, 100%, 50%)` }} />
        </div>
      </div>
      <div className="cpicker__row">
        <span className="cpicker__label">Hex</span>
        <input
          className="cpicker__hex"
          spellCheck={false}
          value={draft ?? hex.slice(1).toUpperCase()}
          onFocus={() => setDraft(hex.slice(1).toUpperCase())}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
    </div>,
    document.body,
  )
}

/** 스와치 버튼 + 피커 팝오버 — input[type=color] 대체. */
export function ColorSwatch({
  value,
  onLive,
  onCommit,
  title,
}: {
  value: string
  onLive: (hex: string) => void
  /** 피커 닫힘 — 마지막 색 (열 때와 같으면 커밋 불필요한지 호출자가 판단). */
  onCommit: (hex: string) => void
  title?: string
}) {
  const [open, setOpen] = useState<DOMRect | null>(null)
  const last = useRef(value)
  const opened = useRef(value)
  return (
    <>
      <button
        type="button"
        className="cswatch"
        style={{ background: value }}
        title={title}
        onClick={(e) => {
          opened.current = value
          last.current = value
          setOpen((e.currentTarget as HTMLElement).getBoundingClientRect())
        }}
      />
      {open && (
        <ColorPicker
          value={value}
          anchor={open}
          onLive={(hex) => {
            last.current = hex
            onLive(hex)
          }}
          onClose={() => {
            setOpen(null)
            if (last.current !== opened.current) onCommit(last.current)
          }}
        />
      )}
    </>
  )
}
