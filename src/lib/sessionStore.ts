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
      for (const st of [STORE, FONT_STORE, VER_STORE, LIB_STORE])
        if (!req.result.objectStoreNames.contains(st)) req.result.createObjectStore(st)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 트랜잭션 보일러플레이트 공통화 — 열고, fn의 요청을 프라미스로 감싸고, 닫는다. */
async function op<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (os: IDBObjectStore) => IDBRequest | void,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode)
      const req = fn(tx.objectStore(store))
      if (req) {
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      } else {
        tx.oncomplete = () => resolve(undefined as T)
        tx.onerror = () => reject(tx.error)
      }
    })
  } finally {
    db.close()
  }
}

const put = (store: string, key: string, value: unknown) =>
  op<void>(store, 'readwrite', (os) => void os.put(value, key))
const del = (store: string, key: string) => op<void>(store, 'readwrite', (os) => void os.delete(key))

export const idbGet = (key: string) =>
  op<unknown>(STORE, 'readonly', (os) => os.get(key)).then((v) => (typeof v === 'string' ? v : null))
export const idbSet = (key: string, value: string) => put(STORE, key, value)
export const idbDel = (key: string) => del(STORE, key)

// ── 폰트 저장소 — 텍스트 툴용 업로드 폰트 (.ttf/.otf 바이너리, 세션 간 유지) ──
export const idbFontPut = (name: string, buf: ArrayBuffer) => put(FONT_STORE, name, buf)
export const idbFontGet = (name: string) =>
  op<unknown>(FONT_STORE, 'readonly', (os) => os.get(name)).then((v) =>
    v instanceof ArrayBuffer ? v : null,
  )
export const idbFontList = () =>
  op<IDBValidKey[]>(FONT_STORE, 'readonly', (os) => os.getAllKeys()).then((ks) => ks.map(String))

// ── 버전 스냅샷 — 수동 저장 포인트 (이름 + 시각 + 세션 페이로드) ──
export interface VersionMeta {
  id: string
  name: string
  at: number
  bytes: number
}

export const idbVersionPut = (id: string, value: string) => put(VER_STORE, id, value)
export const idbVersionGet = (id: string) =>
  op<unknown>(VER_STORE, 'readonly', (os) => os.get(id)).then((v) =>
    typeof v === 'string' ? v : null,
  )
export const idbVersionDel = (id: string) => del(VER_STORE, id)

/** 메타 목록 — 최신순. 값 전체를 파싱하되 손상 엔트리는 제외. */
export async function idbVersionList(): Promise<VersionMeta[]> {
  const rows: VersionMeta[] = []
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(VER_STORE, 'readonly').objectStore(VER_STORE).openCursor()
      req.onsuccess = () => {
        const cur = req.result
        if (!cur) {
          resolve()
          return
        }
        try {
          const v = JSON.parse(String(cur.value)) as { name?: string; at?: number }
          rows.push({
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

export const idbLibPut = (item: LibItem) => put(LIB_STORE, item.id, JSON.stringify(item))
export const idbLibDel = (id: string) => del(LIB_STORE, id)

export const idbLibList = () =>
  op<unknown[]>(LIB_STORE, 'readonly', (os) => os.getAll()).then((raws) => {
    const out: LibItem[] = []
    for (const raw of raws) {
      try {
        const v = JSON.parse(String(raw)) as LibItem
        if (v?.id && v?.data) out.push(v)
      } catch {
        // 손상 엔트리 — 제외
      }
    }
    return out.sort((a, b) => b.at - a.at)
  })
