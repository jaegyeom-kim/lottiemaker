import { useState, type ReactNode } from 'react'
import { t } from '../lib/i18n'
import { ChevronRightIcon, ExpandMoreIcon } from './icons'

const KEY = 'lottiemaker.sections.v1'

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function saveOpen(id: string, open: boolean) {
  try {
    const m = loadOpen()
    m[id] = open
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    // 저장 불가 환경 — 무시
  }
}

/**
 * 편집 패널 접이식 섹션 — 열림 상태는 localStorage에 유지.
 * 자식이 null을 렌더하면 섹션 전체가 숨겨진다 (CSS :has 빈 바디 감지).
 */
export default function Section({
  id,
  title,
  defaultOpen = true,
  children,
}: {
  id: string
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => loadOpen()[id] ?? defaultOpen)
  return (
    <section className={`csection ${open ? '' : 'csection--closed'}`}>
      <button
        className="csection__head"
        onClick={() => {
          setOpen(!open)
          saveOpen(id, !open)
        }}
      >
        <span className="csection__twirl">{open ? <ExpandMoreIcon /> : <ChevronRightIcon />}</span>
        {t(title)}
      </button>
      {/* 접혀도 마운트 유지 — 빈 바디 감지(:has)가 양쪽 상태에서 동작 */}
      <div className="csection__body">{children}</div>
    </section>
  )
}
