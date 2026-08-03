// 드래그 중 전역 커서 고정 — 라이브 이동으로 요소가 포인터에 한 프레임 늦게 따라와도
// 커서가 grab/기본 사이를 깜빡이지 않게 body에 강제 커서 클래스를 얹는다.
export type DragCursor = 'grabbing' | 'ew' | 'row' | 'col' | 'cross'

const ALL = ['drag-grabbing', 'drag-ew', 'drag-row', 'drag-col', 'drag-cross']

export function setDragCursor(kind: DragCursor | null) {
  document.body.classList.remove(...ALL)
  if (kind) document.body.classList.add(`drag-${kind}`)
}
