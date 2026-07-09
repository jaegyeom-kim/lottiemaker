import { useCallback, useRef, useState } from 'react'
import { useEditor } from '../store'
import { durationSec, parseLottie } from '../lib/lottieUtils'
import LottiePlayer from './LottiePlayer'
import MockupView from './MockupView'

export default function Preview() {
  const {
    animationData, playing, speed, loop, bg, replayToken,
    setPlaying, setSpeed, setLoop, setBg, load, replay,
  } = useEditor()
  const [frame, setFrame] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [seek, setSeek] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [mode, setMode] = useState<'canvas' | 'mockup'>('canvas')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onFrame = useCallback((f: number, total: number) => {
    setFrame(f)
    setTotalFrames(total)
  }, [])

  const openFile = (file: File) => {
    file.text().then((text) => {
      try {
        load(parseLottie(text), file.name)
      } catch (e) {
        alert((e as Error).message)
      }
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) openFile(file)
  }

  return (
    <div
      className={`preview ${dragOver ? 'preview--drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {animationData && (
        <div className="preview__modebar">
          <div className="segment segment--compact">
            <button
              className={`segment__btn ${mode === 'canvas' ? 'segment__btn--on' : ''}`}
              onClick={() => setMode('canvas')}
            >
              미리보기
            </button>
            <button
              className={`segment__btn ${mode === 'mockup' ? 'segment__btn--on' : ''}`}
              onClick={() => setMode('mockup')}
            >
              사용 예시
            </button>
          </div>
        </div>
      )}

      <div className={`preview__canvas preview__canvas--${mode === 'mockup' ? 'dark' : bg}`}>
        {animationData ? (
          mode === 'mockup' ? (
            <MockupView />
          ) : (
            <LottiePlayer
              data={animationData}
              playing={playing}
              speed={speed}
              loop={loop}
              onFrame={onFrame}
              seekFrame={seek}
              replayToken={replayToken}
              onComplete={() => setPlaying(false)}
              className="preview__lottie"
            />
          )
        ) : (
          <div className="preview__empty">
            <p className="preview__empty-title">로티를 선택하거나 파일을 끌어다 놓으세요</p>
            <p className="preview__empty-sub">왼쪽 템플릿 클릭 · JSON 드래그앤드롭</p>
            <button className="btn btn--secondary" onClick={() => fileInputRef.current?.click()}>
              JSON 파일 열기
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) openFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {animationData && (
        <div className="playbar">
          <button
            className="btn btn--icon"
            onClick={() => setPlaying(!playing)}
            title={playing ? '일시정지 (Space)' : '재생 (Space)'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="btn btn--icon" onClick={replay} title="처음부터 재생 (루프 끄면 1회 재생)">
            ⟲
          </button>

          {mode === 'canvas' ? (
            <>
              <input
                className="playbar__scrub"
                type="range"
                min={0}
                max={Math.max(1, totalFrames)}
                step={0.01}
                value={frame}
                onChange={(e) => {
                  setPlaying(false)
                  setSeek(Number(e.target.value))
                }}
                // 포인터(마우스/터치/펜)와 키보드 조작 종료 모두에서 시크 모드 해제
                onPointerUp={() => setSeek(null)}
                onKeyUp={() => setSeek(null)}
              />
              <span className="playbar__time">
                {Math.round(frame)} / {Math.round(totalFrames)}f · {durationSec(animationData).toFixed(1)}s
              </span>
            </>
          ) : (
            <span className="playbar__spacer" />
          )}

          <div className="playbar__group">
            {[0.25, 0.5, 1, 1.5, 2].map((s) => (
              <button
                key={s}
                className={`chip ${speed === s ? 'chip--on' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>

          <button className={`chip ${loop ? 'chip--on' : ''}`} onClick={() => setLoop(!loop)}>
            루프
          </button>

          {mode === 'canvas' && (
            <div className="playbar__group">
              {(['checker', 'dark', 'light'] as const).map((b) => (
                <button
                  key={b}
                  className={`bgdot bgdot--${b} ${bg === b ? 'bgdot--on' : ''}`}
                  onClick={() => setBg(b)}
                  title={`배경: ${b}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
