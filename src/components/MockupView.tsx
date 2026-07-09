import { useState } from 'react'
import { useEditor } from '../store'
import LottiePlayer from './LottiePlayer'

const CONTEXTS = [
  { id: 'dialog', label: '결과 다이얼로그' },
  { id: 'button', label: '버튼 로딩' },
  { id: 'empty', label: '엠티 스테이트' },
  { id: 'list', label: '리스트 아이콘' },
  { id: 'toast', label: '토스트' },
] as const

type ContextId = (typeof CONTEXTS)[number]['id']

/** 현재 로티를 실제 서비스 화면 맥락에 배치해 보여주는 목업 뷰. */
export default function MockupView() {
  const { animationData, playing, speed, loop } = useEditor()
  const [ctx, setCtx] = useState<ContextId>('dialog')

  if (!animationData) return null

  // 크기는 각 래퍼 클래스 CSS에서 지정
  const anim = () => (
    <LottiePlayer
      data={animationData}
      playing={playing}
      speed={speed}
      loop={loop}
      className="mockup__anim"
    />
  )

  return (
    <div className="mockup">
      <div className="mockup__chips">
        {CONTEXTS.map((c) => (
          <button
            key={c.id}
            className={`chip ${ctx === c.id ? 'chip--on' : ''}`}
            onClick={() => setCtx(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="phone">
        <div className="phone__notch" />
        <div className="phone__screen">
          {/* 상태바 */}
          <div className="phone__statusbar">
            <span>9:41</span>
            <span className="phone__statusicons">●●●</span>
          </div>

          {ctx === 'dialog' && (
            <div className="mock-app">
              <MockHeader title="송금" />
              <div className="mock-rows">
                <SkeletonRow w={70} />
                <SkeletonRow w={45} />
                <SkeletonRow w={60} />
              </div>
              <div className="mock-dim">
                <div className="mock-dialog">
                  <div className="mock-dialog__anim">{anim()}</div>
                  <p className="mock-dialog__title">결제가 완료됐어요</p>
                  <p className="mock-dialog__sub">스타벅스 · 5,600원</p>
                  <button className="mock-btn">확인</button>
                </div>
              </div>
            </div>
          )}

          {ctx === 'button' && (
            <div className="mock-app">
              <MockHeader title="이체하기" />
              <div className="mock-form">
                <div className="mock-field">
                  <span className="mock-field__label">받는 분</span>
                  <SkeletonRow w={55} />
                </div>
                <div className="mock-field">
                  <span className="mock-field__label">금액</span>
                  <span className="mock-field__amount">2,000,000원</span>
                </div>
              </div>
              <button className="mock-btn mock-btn--bottom mock-btn--loading">
                <span className="mock-btn__anim">{anim()}</span>
                송금 중...
              </button>
            </div>
          )}

          {ctx === 'empty' && (
            <div className="mock-app">
              <MockHeader title="알림" />
              <div className="mock-empty">
                <div className="mock-empty__anim">{anim()}</div>
                <p className="mock-empty__title">아직 알림이 없어요</p>
                <p className="mock-empty__sub">새로운 소식이 오면 알려드릴게요</p>
              </div>
            </div>
          )}

          {ctx === 'list' && (
            <div className="mock-app">
              <MockHeader title="혜택" />
              <ul className="mock-list">
                <li className="mock-list__item mock-list__item--hero">
                  <span className="mock-list__anim">{anim()}</span>
                  <div className="mock-list__text">
                    <span className="mock-list__title">이번 주 미션 도착</span>
                    <span className="mock-list__sub">참여하고 포인트 받기</span>
                  </div>
                </li>
                {[80, 65, 72].map((w, i) => (
                  <li key={i} className="mock-list__item">
                    <span className="mock-list__dot" />
                    <div className="mock-list__text">
                      <SkeletonRow w={w} />
                      <SkeletonRow w={w - 25} thin />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ctx === 'toast' && (
            <div className="mock-app">
              <MockHeader title="내 계좌" />
              <div className="mock-rows">
                <SkeletonRow w={75} />
                <SkeletonRow w={50} />
                <SkeletonRow w={65} />
                <SkeletonRow w={40} />
              </div>
              <div className="mock-toast">
                <span className="mock-toast__anim">{anim()}</span>
                계좌번호가 복사됐어요
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mockup__hint">색상·속도 편집이 목업에 실시간 반영됩니다</p>
    </div>
  )
}

function MockHeader({ title }: { title: string }) {
  return (
    <div className="mock-header">
      <span className="mock-header__back">‹</span>
      <span className="mock-header__title">{title}</span>
    </div>
  )
}

function SkeletonRow({ w, thin = false }: { w: number; thin?: boolean }) {
  return <span className={`mock-skel ${thin ? 'mock-skel--thin' : ''}`} style={{ width: `${w}%` }} />
}
