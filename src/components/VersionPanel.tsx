import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { useEditor, sessionPayload, type SavedSession } from '../store'
import {
  idbVersionPut, idbVersionGet, idbVersionDel, idbVersionList, type VersionMeta,
} from '../lib/sessionStore'

const CAP = 20

/** 버전 스냅샷 — 수동 저장 포인트 목록 + 복원 (복원 직전 자동 백업). */
export default function VersionPanel() {
  const restoreSession = useEditor((s) => s.restoreSession)
  const [list, setList] = useState<VersionMeta[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = () => idbVersionList().then(setList).catch(() => setList([]))
  useEffect(() => {
    void refresh()
  }, [])

  const save = async (label: string) => {
    const payload = sessionPayload()
    if (!payload) return
    const at = Date.now()
    const id = `ver_${at}_${Math.random().toString(36).slice(2, 6)}`
    await idbVersionPut(id, JSON.stringify({ name: label, at, payload }))
    // 상한 초과분 정리 — 오래된 것부터
    const all = await idbVersionList()
    for (const v of all.slice(CAP)) await idbVersionDel(v.id)
    await refresh()
  }

  const restore = async (id: string) => {
    if (busy) return
    setBusy(true)
    try {
      const raw = await idbVersionGet(id)
      if (!raw) return
      const { payload } = JSON.parse(raw) as { payload: SavedSession }
      if (!payload?.sourceData) return
      // 복원 직전 현재 상태 자동 백업 — 실수 복원도 안전
      await save(t('복원 전 자동 백업'))
      restoreSession(payload)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel__section versions">
      <div className="versions__save">
        <input
          className="input"
          placeholder={t('스냅샷 이름 (선택)')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn btn--secondary"
          onClick={async () => {
            await save(name.trim() || new Date().toLocaleString())
            setName('')
          }}
        >
          {t('스냅샷 저장')}
        </button>
      </div>
      {list.length === 0 ? (
        <p className="panel__hint">{t('저장된 버전 없음 — 스냅샷은 이 브라우저에 보관됩니다 (최근 {n}개)').replace('{n}', String(CAP))}</p>
      ) : (
        <ul className="versions__list">
          {list.map((v) => (
            <li key={v.id} className="versions__item">
              <div className="versions__meta">
                <strong>{v.name}</strong>
                <span>
                  {new Date(v.at).toLocaleString()} · {(v.bytes / 1024).toFixed(0)}KB
                </span>
              </div>
              <button className="linkbtn" disabled={busy} onClick={() => void restore(v.id)}>
                {t('복원')}
              </button>
              <button
                className="linkbtn versions__del"
                title={t('삭제')}
                onClick={async () => {
                  await idbVersionDel(v.id)
                  await refresh()
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
