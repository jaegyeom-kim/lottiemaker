// 세션 영속화 — IndexedDB (용량 제한 사실상 없음) + localStorage 미러(소형·동기 부팅용).
// localStorage 단독이던 자동 저장의 5MB 쿼터 한계를 제거한다.

const DB_NAME = 'lottiemaker'
const STORE = 'sessions'
const FONT_STORE = 'fonts'
const VER_STORE = 'versions'
const LIB_STORE = 'library'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, 4)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      if (!req.result.objectStoreNames.contains(FONT_STORE)) req.result.createObjectStore(FONT_STORE)
      if (!req.result.objectStoreNames.contains(VER_STORE)) req.result.createObjectStore(VER_STORE)
      if (!req.result.objectStoreNames.contains(LIB_STORE)) req.result.createObjectStore(LIB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet(key: string): Promise<string | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function idbDel(key: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// ── 폰트 저장소 — 텍스트 툴용 업로드 폰트 (.ttf/.otf 바이너리, 세션 간 유지) ──
export async function idbFontPut(name: string, buf: ArrayBuffer): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readwrite')
      tx.objectStore(FONT_STORE).put(buf, name)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function idbFontGet(name: string): Promise<ArrayBuffer | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readonly')
      const req = tx.objectStore(FONT_STORE).get(name)
      req.onsuccess = () => resolve(req.result instanceof ArrayBuffer ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function idbFontList(): Promise<string[]> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readonly')
      const req = tx.objectStore(FONT_STORE).getAllKeys()
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String))
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

// ── 버전 스냅샷 — 수동 저장 포인트 (이름 + 시각 + 세션 페이로드) ──
export interface VersionMeta {
  id: string
  name: string
  at: number
  bytes: number
}

export async function idbVersionPut(id: string, value: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VER_STORE, 'readwrite')
      tx.objectStore(VER_STORE).put(value, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function idbVersionGet(id: string): Promise<string | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(VER_STORE, 'readonly')
      const req = tx.objectStore(VER_STORE).get(id)
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function idbVersionDel(id: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VER_STORE, 'readwrite')
      tx.objectStore(VER_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** 메타 목록 — 최신순. 값 전체를 읽지 않도록 커서 없이 keys + 미리 저장한 메타 파싱. */
export async function idbVersionList(): Promise<VersionMeta[]> {
  const db = await openDb()
  try {
    const rows: VersionMeta[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(VER_STORE, 'readonly')
      const req = tx.objectStore(VER_STORE).openCursor()
      const out: VersionMeta[] = []
      req.onsuccess = () => {
        const cur = req.result
        if (!cur) {
          resolve(out)
          return
        }
        try {
          const v = JSON.parse(String(cur.value)) as { name?: string; at?: number }
          out.push({
            id: String(cur.key),
            name: String(v.name ?? cur.key),
            at: Number(v.at ?? 0),
            bytes: String(cur.value).length,
          })
        } catch {
          // 손상 엔트리 — 목록에서 제외
        }
        cur.continue()
      }
      req.onerror = () => reject(req.error)
    })
    return rows.sort((a, b) => b.at - a.at)
  } finally {
    db.close()
  }
}

// ── 에셋 라이브러리 — 문서 간 재사용 그래픽 (SVG 원본 / 이미지 dataURI) ──
export interface LibItem {
  id: string
  name: string
  at: number
  kind: 'svg' | 'image'
  data: string
  /** 이미지 원본 크기 (kind=image). */
  w?: number
  h?: number
}

export async function idbLibPut(item: LibItem): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LIB_STORE, 'readwrite')
      tx.objectStore(LIB_STORE).put(JSON.stringify(item), item.id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function idbLibDel(id: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LIB_STORE, 'readwrite')
      tx.objectStore(LIB_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function idbLibList(): Promise<LibItem[]> {
  const db = await openDb()
  try {
    const rows: LibItem[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(LIB_STORE, 'readonly')
      const req = tx.objectStore(LIB_STORE).getAll()
      req.onsuccess = () => {
        const out: LibItem[] = []
        for (const raw of req.result as unknown[]) {
          try {
            const v = JSON.parse(String(raw)) as LibItem
            if (v?.id && v?.data) out.push(v)
          } catch {
            // 손상 엔트리 — 제외
          }
        }
        resolve(out)
      }
      req.onerror = () => reject(req.error)
    })
    return rows.sort((a, b) => b.at - a.at)
  } finally {
    db.close()
  }
}
