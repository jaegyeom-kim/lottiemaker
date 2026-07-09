import { useState } from 'react'
import { useEditor } from '../store'
import { bakeSpeed, download, durationSec } from '../lib/lottieUtils'

export default function ExportPanel() {
  const { animationData, fileName, setFileName, speed } = useEditor()
  const [applySpeed, setApplySpeed] = useState(false)
  const [copied, setCopied] = useState<'json' | 'code' | null>(null)

  if (!animationData) return null

  const finalData = () => (applySpeed && speed !== 1 ? bakeSpeed(animationData, speed) : animationData)

  const flash = (kind: 'json' | 'code') => {
    setCopied(kind)
    setTimeout(() => setCopied(null), 1500)
  }

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(finalData()))
    flash('json')
  }

  const copyCode = async () => {
    const snippet = `import lottie from 'lottie-web'

lottie.loadAnimation({
  container: document.querySelector('#anim'),
  renderer: 'svg',
  loop: true,
  autoplay: true,
  path: '${fileName}.json',
})`
    await navigator.clipboard.writeText(snippet)
    flash('code')
  }

  const dur = durationSec(animationData)

  return (
    <div className="panel__section">
      <h3 className="panel__label">내보내기</h3>
      <input
        className="input"
        type="text"
        value={fileName}
        onChange={(e) => setFileName(e.target.value)}
        placeholder="파일 이름"
      />
      {speed !== 1 && (
        <label className="check">
          <input
            type="checkbox"
            checked={applySpeed}
            onChange={(e) => setApplySpeed(e.target.checked)}
          />
          현재 배속({speed}x)을 파일에 적용
        </label>
      )}
      <div className="exportrow">
        <button className="btn btn--primary" onClick={() => download(finalData(), fileName)}>
          JSON 다운로드
        </button>
        <button className="btn btn--secondary" onClick={copyJson}>
          {copied === 'json' ? '복사됨 ✓' : 'JSON 복사'}
        </button>
      </div>
      <button className="btn btn--secondary btn--full" onClick={copyCode}>
        {copied === 'code' ? '복사됨 ✓' : 'lottie-web 코드 복사'}
      </button>

      <h3 className="panel__label">스펙</h3>
      <ul className="spec">
        <li>
          <span>크기</span>
          <span>
            {animationData.w} × {animationData.h}px
          </span>
        </li>
        <li>
          <span>길이</span>
          <span>
            {dur.toFixed(1)}s · {animationData.op - animationData.ip}f · {animationData.fr}fps
          </span>
        </li>
        <li>
          <span>레이어</span>
          <span>{animationData.layers.length}개</span>
        </li>
        <li>
          <span>파일</span>
          <span>{(JSON.stringify(animationData).length / 1024).toFixed(1)}KB</span>
        </li>
      </ul>
      <p className="panel__hint">lottie-web · dotLottie · 네이티브 Lottie 라이브러리 호환</p>
      {animationData.fonts?.list?.length ? (
        <p className="panel__hint">
          텍스트 레이어 포함 — 재생 환경에 폰트({animationData.fonts.list[0].fFamily.split(',')[0]})가
          설치·로드되어 있어야 동일하게 보입니다.
        </p>
      ) : null}
    </div>
  )
}
