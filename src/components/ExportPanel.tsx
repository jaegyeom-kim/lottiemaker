import { useState } from 'react'
import { useEditor, sessionPayload } from '../store'
import { t } from '../lib/i18n'
import { bakeSpeed, download, durationSec } from '../lib/lottieUtils'
import { buildDotLottie, saveBlob } from '../lib/dotlottie'
import { exportWebM, webmSupported } from '../lib/videoExport'
import { exportGif } from '../lib/gifExport'
import VersionPanel from './VersionPanel'
import { optimizeLottie } from '../lib/optimize'
import { exportFramePng, exportPngSequence } from '../lib/pngExport'
import Section from './Section'
import { DownloadIcon, CopyIcon, MovieIcon, CodeIcon, SaveIcon } from './icons'

export default function ExportPanel() {
  const { animationData, fileName, setFileName, speed } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)

  // 프로젝트 세이브 파일 — 자동 저장과 같은 페이로드에 app 마커만 얹는다 (드롭으로 복원).
  const saveProject = () => {
    const payload = sessionPayload()
    if (!payload) return
    const blob = new Blob([JSON.stringify({ app: 'lottiemaker', ...payload })], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${payload.fileName}.lmproj.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const [applySpeed, setApplySpeed] = useState(false)
  const [optimize, setOptimize] = useState(true)
  const [copied, setCopied] = useState<'json' | 'code' | null>(null)
  const [recording, setRecording] = useState<number | null>(null)
  const [videoErr, setVideoErr] = useState('')
  const bg = useEditor((s) => s.bg)

  if (!animationData) return null

  const rawData = () => (applySpeed && speed !== 1 ? bakeSpeed(animationData, speed) : animationData)
  const finalData = () => (optimize ? optimizeLottie(rawData()) : rawData())

  const [gifBusy, setGifBusy] = useState<number | null>(null)
  const [pngBusy, setPngBusy] = useState<number | null>(null)
  const curFrame = useEditor((s) => s.curFrame)
  const savePngFrame = async () => {
    try {
      saveBlob(await exportFramePng(finalData(), curFrame), `${fileName}_${curFrame}f.png`)
    } catch (err) {
      setVideoErr(err instanceof Error ? err.message : String(err))
    }
  }
  const savePngSeq = async () => {
    if (pngBusy !== null) return
    setVideoErr('')
    setPngBusy(0)
    try {
      const blob = await exportPngSequence(finalData(), { onProgress: setPngBusy })
      saveBlob(blob, `${fileName}_seq.zip`)
    } catch (err) {
      setVideoErr(err instanceof Error ? err.message : String(err))
    } finally {
      setPngBusy(null)
    }
  }
  const saveGif = async () => {
    if (gifBusy !== null) return
    setVideoErr('')
    setGifBusy(0)
    try {
      const solidBg = bg === 'checker' ? '#ffffff' : bg
      const blob = await exportGif(finalData(), { bg: solidBg, onProgress: setGifBusy })
      saveBlob(blob, `${fileName}.gif`)
    } catch (err) {
      setVideoErr(err instanceof Error ? err.message : String(err))
    } finally {
      setGifBusy(null)
    }
  }

  const recordWebm = async () => {
    if (recording !== null) return
    setVideoErr('')
    setRecording(0)
    try {
      // 체커보드(투명) 배경은 영상에 못 싣는다 — 흰색으로
      const solidBg = bg === 'checker' ? '#ffffff' : bg
      const blob = await exportWebM(finalData(), { bg: solidBg, onProgress: setRecording })
      saveBlob(blob, `${fileName}.webm`)
    } catch (e) {
      setVideoErr((e as Error).message)
    } finally {
      setRecording(null)
    }
  }

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
    <>
      <Section key="exp-file" id="exp-file" title="내보내기">
        <div className="panel__section">
      <input
        className="input"
        type="text"
        value={fileName}
        onChange={(e) => setFileName(e.target.value)}
        placeholder={t('파일 이름')}
      />
      {speed !== 1 && (
        <label className="check">
          <input
            type="checkbox"
            checked={applySpeed}
            onChange={(e) => setApplySpeed(e.target.checked)}
          />
          {t('현재 배속({speed}x)을 파일에 적용').replace('{speed}', String(speed))}
        </label>
      )}
      <label className="check" title={t('소수점 3자리 라운딩 + 미사용 에셋·에디터 메타 제거 — 시각 결과 동일')}>
        <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} />
        {t('최적화')}{' '}
        <span className="panel__hint">
          {(JSON.stringify(optimizeLottie(rawData())).length / 1024).toFixed(1)}KB /{' '}
          {(JSON.stringify(rawData()).length / 1024).toFixed(1)}KB
        </span>
      </label>
      <div className="exportrow">
        <button className="btn btn--primary" onClick={() => download(finalData(), fileName)}>
          <DownloadIcon /> {t('JSON 다운로드')}
        </button>
        <button className="btn btn--secondary" onClick={copyJson}>
          <CopyIcon /> {copied === 'json' ? t('복사됨 ✓') : t('JSON 복사')}
        </button>
      </div>
      <div className="exportrow">
        <button
          className="btn btn--secondary"
          title={t('dotLottie — 압축 단일 파일 (.lottie), dotLottie 플레이어용')}
          onClick={async () => saveBlob(await buildDotLottie(finalData()), `${fileName}.lottie`)}
        >
          <DownloadIcon /> {t('.lottie 저장')}
        </button>
        <button
          className="btn btn--secondary"
          disabled={recording !== null || !webmSupported()}
          title={
            webmSupported()
              ? t('컴포지션을 1회 재생하며 WebM 영상으로 녹화 (배경색 포함)')
              : t('이 브라우저는 WebM 녹화 미지원 (Chrome/Edge 권장)')
          }
          onClick={recordWebm}
        >
          <MovieIcon />{' '}
          {recording !== null
            ? t('녹화 중 {pct}%').replace('{pct}', String(Math.round(recording * 100)))
            : t('WebM 영상')}
        </button>
      </div>
      <div className="exportrow">
        <button
          className="btn btn--secondary"
          title={t('현재 프레임을 투명 배경 PNG로 (2x)')}
          onClick={savePngFrame}
        >
          <DownloadIcon /> {t('프레임 PNG')}
        </button>
        <button
          className="btn btn--secondary"
          disabled={pngBusy !== null}
          title={t('전체 프레임을 PNG 시퀀스 zip으로 (30fps, 투명 배경)')}
          onClick={savePngSeq}
        >
          <DownloadIcon />{' '}
          {pngBusy !== null
            ? t('시퀀스 {pct}%').replace('{pct}', String(Math.round(pngBusy * 100)))
            : t('PNG 시퀀스')}
        </button>
      </div>
      <div className="exportrow">
        <button
          className="btn btn--secondary btn--full"
          disabled={gifBusy !== null}
          title={t('프레임 단위로 정확히 뽑아 GIF 인코딩 (배경색 포함, 30fps)')}
          onClick={saveGif}
        >
          <MovieIcon />{' '}
          {gifBusy !== null
            ? t('GIF 인코딩 {pct}%').replace('{pct}', String(Math.round(gifBusy * 100)))
            : t('GIF 저장')}
        </button>
      </div>
      {videoErr && <p className="panel__error">{videoErr}</p>}
      <button className="btn btn--secondary btn--full" onClick={copyCode}>
        <CodeIcon /> {copied === 'code' ? t('복사됨 ✓') : t('lottie-web 코드 복사')}
      </button>
        </div>
      </Section>
      <Section key="exp-ver" id="exp-ver" title="버전">
        <VersionPanel />
      </Section>
      <Section key="exp-proj" id="exp-proj" title="프로젝트">
        <div className="panel__section">
      {sourceData && (
        <>
          <button className="btn btn--secondary btn--full" onClick={saveProject} title={t('편집 가능한 프로젝트 파일 — 미리보기에 드롭하면 이어서 편집')}>
            <SaveIcon /> {t('프로젝트 파일 저장 (.lmproj)')}
          </button>
          <p className="panel__hint">
            {(() => {
              const imgs = ((sourceData.assets as { p?: string }[] | undefined) ?? []).filter(
                (a) => typeof a.p === 'string' && a.p.startsWith('data:'),
              ).length
              const svgs = sourceData.layers.filter(
                (l) => typeof (l as Record<string, unknown>).xsrc === 'string',
              ).length
              const kb = (JSON.stringify(sourceData).length / 1024).toFixed(0)
              return t('에셋 내장: 이미지 {imgs} · SVG 원본 {svgs} · 약 {kb}KB — 파일 하나로 완결')
                .replace('{imgs}', String(imgs))
                .replace('{svgs}', String(svgs))
                .replace('{kb}', kb)
            })()}
          </p>
        </>
      )}
        </div>
      </Section>
      <Section key="exp-spec" id="exp-spec" title="스펙">
        <div className="panel__section">
      <ul className="spec">
        <li>
          <span>{t('캔버스 크기')}</span>
          <span>
            {animationData.w} × {animationData.h}px
          </span>
        </li>
        <li>
          <span>{t('길이')}</span>
          <span>
            {dur.toFixed(1)}s · {animationData.op - animationData.ip}f · {animationData.fr}fps
          </span>
        </li>
        <li>
          <span>{t('레이어')}</span>
          <span>{t('{n}개').replace('{n}', String(animationData.layers.length))}</span>
        </li>
        <li>
          <span>{t('파일')}</span>
          <span>{(JSON.stringify(animationData).length / 1024).toFixed(1)}KB</span>
        </li>
      </ul>
      <p className="panel__hint">{t('lottie-web · dotLottie · 네이티브 Lottie 라이브러리 호환')}</p>
      {animationData.fonts?.list?.length ? (
        <p className="panel__hint">
          {t('텍스트 레이어 포함 — 재생 환경에 폰트({font})가 설치·로드되어 있어야 동일하게 보입니다.').replace(
            '{font}',
            animationData.fonts.list[0].fFamily.split(',')[0],
          )}
        </p>
      ) : null}
        </div>
      </Section>
    </>
  )
}
