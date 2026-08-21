import { createPortal } from 'react-dom'
import { t } from '../lib/i18n'

/** 단축키 치트시트 — ? 로 열고 닫는 오버레이. 데이터는 실제 바인딩과 동기 유지할 것. */
const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: '툴',
    rows: [
      ['V', '이동'], ['H', '핸드(팬)'], ['Y', '앵커 포인트'], ['G', '펜'],
      ['Q', '도형 순환 (사각형→원→삼각형→별→선)'], ['휠버튼 드래그', '팬'], ['⌘0', '줌 리셋'],
    ],
  },
  {
    title: '캔버스',
    rows: [
      ['드래그', '레이어 이동 (⇧ 축 잠금 · ⌥ 복제 · ⌘ 스냅 해제)'],
      ['빈 곳 드래그', '마키 다중 선택 (⇧ 추가)'],
      ['화살표', '1px 넛지 (⇧ 10px)'], ['⌫ / Delete', '선택 삭제'],
      ['⌘A', '전체 선택'], ['⌘D', '복제'], ['Esc', '드래그 취소 · 선택 해제'],
    ],
  },
  {
    title: '펜',
    rows: [
      ['클릭 / 드래그', '점 추가 / 곡선 점'], ['Enter', '패스 완료'], ['첫 점 클릭', '닫힌 패스'],
      ['⌥클릭', '포인트 변환 (코너 ↔ 스무스)'], ['⌥드래그', '핸들 한쪽만'],
      ['⇧클릭 · 마키', '포인트 다중 선택 (⇧마키 = 토글)'], ['그리는 중 ⌘Z', '마지막 점 취소'],
    ],
  },
  {
    title: '타임라인',
    rows: [
      ['Space', '재생/정지'], ['PgUp / PgDn', '±1프레임 (⇧ 10)'], ['Home / End', '컴프 시작/끝'],
      ['P·S·R·T', '채널 솔로 (⇧ 추가)'], ['U', '키 있는 채널 전부'],
      ['⌥P·S·R·T', '재생헤드에 채널 키 토글'], ['← →', '선택 키 이동 (⇧ 10f)'], ['⌘C', '키 복사'],
    ],
  },
  {
    title: '그래프 에디터',
    rows: [
      ['휠', '줌 (⇧ 시간축 · ⌥ 값축)'], ['드래그', '키 마키 선택'],
      ['아무 프레임 클릭', '구간 탄젠트 표시'], ['핸들 ⌥드래그', '탄젠트 브레이크'],
      ['F / H', '선택 맞춤 / 전체 맞춤'], ['Esc', '닫기'],
    ],
  },
  {
    title: '히스토리',
    rows: [['⌘Z / ⇧⌘Z', '실행 취소 / 다시 실행']],
  },
]

export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="shortcuts" onClick={onClose}>
      <div className="shortcuts__panel" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts__head">
          <strong>{t('단축키')}</strong>
          <span className="shortcuts__hint">{t('? 또는 Esc로 닫기')}</span>
          <button className="gepanel__close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts__grid">
          {SECTIONS.map((sec) => (
            <div key={sec.title} className="shortcuts__sec">
              <h4>{t(sec.title)}</h4>
              {sec.rows.map(([k, desc]) => (
                <div key={k} className="shortcuts__row">
                  <kbd>{k}</kbd>
                  <span>{t(desc)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
