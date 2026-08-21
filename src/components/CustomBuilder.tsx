import { useEffect, useRef, useState } from 'react'
import { evalNumExpr } from '../lib/num'
import { getAiKey, setAiKey, verifyAiKey, summarizeDoc, generateMotion } from '../lib/ai'
import { useEditor } from '../store'
import { svgToLottie, readImageFile } from '../lib/svgImport'
import { parseLottie } from '../lib/lottieUtils'
import { readDotLottie } from '../lib/dotlottie'
import {
  IN_TYPES,
  LOOP_TYPES,
  OUT_TYPES,
  KF_EASES,
  KF_CHANNEL_DEFS,
  normSel,
  normKf,
  kfValueAt,
  kfChannelKeys,
  kfFallbackValue,
  type CustomSel,
  type CustomKf,
  type KfChannel,
  type CustomPayload,
} from '../lib/customBuilder'
import { t } from '../lib/i18n'
import LibraryPanel from './LibraryPanel'

/** Lottie 블렌드 모드 라벨 — 인덱스 = bm 값. */
/**
 * 커스텀 탭 — 그래픽(SVG/PNG)을 레이어로 쌓고, 레이어별로
 * 등장/루프/퇴장 3슬롯(상용 모션 툴 방식)을 조합한다. 위치는 프리뷰에서 직접 드래그.
 */
export default function CustomBuilder() {
  const {
    templateId, addCustomLayer,
    setCustomChannels, setCustomChannelsLive,
    setFileName, commitEdit,
    setCompLengthLive,
  } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  // 선택 없음(빈 곳 클릭) 상태에선 레이어 옵션을 숨긴다 — 안 보이는 레이어를 편집하는 사고 방지
  const hasSel = useEditor((s) => s.customIdxs.length > 0)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const active = templateId === '__custom'
  const layers = active && sourceData ? sourceData.layers : []
  const idx = Math.min(customIdx, Math.max(0, layers.length - 1))
  const selLayer = layers[idx] as
    | (Record<string, unknown> & { nm?: string; refId?: string })
    | undefined
  // 부분/구버전 xsel 방어 — normSel이 기본값 채움 + 구버전 이관
  const compOp = (active && sourceData?.op) || 90
  const xsel: CustomSel = normSel(selLayer?.xsel as Partial<CustomSel> | undefined, compOp)
  // 키프레임 모드 상태 (AE 사용자용) — 프리셋과 레이어 단위로 전환
  const xkf: CustomKf = normKf(selLayer?.xkf as Partial<CustomKf> | undefined)
  const kfOn = xkf.on
  const setLayerKfMode = useEditor((s) => s.setLayerKfMode)

  // 선택 레이어 기준(정착) 위치 — xbase
  let base: [number, number] | null = null
  if (selLayer) {
    base = Array.isArray(selLayer.xbase)
      ? [(selLayer.xbase as number[])[0], (selLayer.xbase as number[])[1]]
      : [256, 256]
  }

  const onFiles = async (files: FileList | File[]) => {
    setError('')
    const errors: string[] = []
    for (const file of files) {
      try {
        // 로티 문서(.json/.lottie) — 레이어 변환 임포트 (키프레임 유지)
        if (/\.(json|lottie)$/i.test(file.name)) {
          let doc
          if (/\.lottie$/i.test(file.name)) {
            const inner = await readDotLottie(await file.arrayBuffer())
            if (!inner) throw new Error(t('dotLottie 파일을 읽을 수 없습니다'))
            doc = parseLottie(JSON.stringify(inner))
          } else {
            const text = await file.text()
            const maybe = JSON.parse(text) as { app?: string; v?: number }
            if (maybe?.app === 'lottiemaker') {
              // 프로젝트 파일 — 복원 흐름으로
              if (
                !useEditor.getState().animationData ||
                window.confirm(t('현재 작업을 프로젝트 파일 내용으로 교체할까요?'))
              )
                useEditor.getState().restoreSession(maybe as never)
              continue
            }
            doc = parseLottie(text)
          }
          const res = useEditor.getState().importLottieLayers(doc)
          if (!res.added)
            throw new Error(t('가져올 수 있는 레이어가 없습니다 — 셰이프/이미지/솔리드 레이어만 지원합니다'))
          for (const w of res.warnings) errors.push(t(w))
          continue
        }
        let payload: CustomPayload
        if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
          payload = { kind: 'svg', graphic: svgToLottie(await file.text()) }
        } else if (
          /^image\/(png|jpeg|webp)$/.test(file.type) ||
          /\.(png|jpe?g|webp)$/i.test(file.name)
        ) {
          payload = { kind: 'image', image: await readImageFile(file) }
        } else {
          throw new Error(t('{name}: SVG/PNG/JPG/WebP/JSON/lottie 파일만 지원합니다').replace('{name}', file.name))
        }
        const name = file.name.replace(/\.[^.]+$/, '') || 'graphic'
        const first =
          useEditor.getState().templateId !== '__custom' || !useEditor.getState().sourceData
        addCustomLayer(payload, name)
        if (first) setFileName(name)
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    if (errors.length) setError(errors.join(' · '))
  }

  return (
    <div className="custombuilder">
      <div
        className={`dropzone ${dragOver ? 'dropzone--over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(false)
          if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files)
        }}
      >
        <span className="dropzone__icon">⬆</span>
        <span>
          {t('SVG/PNG/로티 JSON을 끌어다 놓거나')} <u>{t('클릭해서 선택')}</u>{' '}
          {active && t('(여러 장 가능)')}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".svg,.png,.jpg,.jpeg,.webp,.json,.lottie,image/svg+xml,image/png,image/jpeg,image/webp,application/json"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {error && <p className="panel__error">{error}</p>}

      {/* 라이브러리 — 문서 간 재사용 그래픽 (properties '라이브러리에 저장'으로 채움) */}
      <h4 className="grouphead">{t('라이브러리')}</h4>
      <LibraryPanel />

      {active && layers.length > 0 && (
        <>
          {/* 컴포지션 설정은 레이어 선택과 무관 — 항상 표시 */}
          <h4 className="grouphead">{t('컴포지션')}</h4>
          <div className="knob">
            {/* AE 컴프 길이 — 레이어 클립/키프레임은 절대 시간 유지 */}
            <SliderRow
              label={t('재생 길이')}
              min={0.5}
              max={6}
              step={0.1}
              unit="s"
              value={compOp / 60}
              onLive={(v) => setCompLengthLive(v)}
              onCommit={commitEdit}
            />
            <p className="knob__note">{t('길이를 늘려도 각 레이어의 애니메이션 타이밍은 그대로입니다.')}</p>
          </div>
        </>
      )}

      {active && layers.length > 0 && !hasSel && (
        <p className="knob__note">{t('캔버스나 레이어 목록에서 레이어를 선택하면 애니메이션 옵션이 나타납니다.')}</p>
      )}

      {active && selLayer && hasSel && (
        <>
          <h4 className="grouphead">{t('애니메이션')}</h4>

          {/* 모드 — 프리셋(3슬롯) vs 키프레임(AE식 직접 키) */}
          <div className="opttabs" style={{ marginBottom: 8 }}>
            <button
              className={`opttab ${!kfOn ? 'opttab--on' : ''}`}
              title={t('등장/루프/퇴장 조합 — 간단하고 빠르게')}
              onClick={() => kfOn && setLayerKfMode(false)}
            >
              {t('프리셋')}
            </button>
            <button
              className={`opttab ${kfOn ? 'opttab--on' : ''}`}
              title={t('채널별 키프레임 직접 편집 — AE 방식')}
              onClick={() => !kfOn && setLayerKfMode(true)}
            >
              {t('키프레임')}
            </button>
          </div>

          {kfOn && <KfPanel xkf={xkf} xsel={xsel} base={base} compOp={compOp} />}

          {!kfOn && (
          <>
          {/* 등장 (In) */}
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">{t('등장')}</span>
            </div>
            <div className="knob__chips">
              {IN_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.in.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, in: { ...xsel.in, type: i } })}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            {xsel.in.type > 0 && (
              <>
                <SliderRow
                  label={t('시간')}
                  min={0.1}
                  max={1.2}
                  step={0.05}
                  unit="s"
                  value={xsel.in.dur / 60}
                  onLive={(v) =>
                    setCustomChannelsLive({ ...xsel, in: { ...xsel.in, dur: Math.round(v * 60) } })
                  }
                  onCommit={commitEdit}
                />
                {((xsel.in.type >= 2 && xsel.in.type <= 5) || xsel.in.type === 7) && (
                  <SliderRow
                    label={t('거리')}
                    min={10}
                    max={400}
                    step={5}
                    unit="px"
                    value={xsel.in.dist}
                    onLive={(v) => setCustomChannelsLive({ ...xsel, in: { ...xsel.in, dist: v } })}
                    onCommit={commitEdit}
                  />
                )}
                {xsel.in.type !== 1 && xsel.in.type !== 7 && (
                  <label className="check" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={xsel.in.bounce !== 0}
                      onChange={(e) =>
                        setCustomChannels({
                          ...xsel,
                          in: { ...xsel.in, bounce: e.target.checked ? 1 : 0 },
                        })
                      }
                    />
                    {t('바운스 (오버슈트)')}
                  </label>
                )}
              </>
            )}
          </div>

          {/* 루프 (Loop) */}
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">{t('루프')}</span>
            </div>
            <div className="knob__chips">
              {LOOP_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.loop.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, loop: { ...xsel.loop, type: i } })}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            {xsel.loop.type > 0 && (
              <>
                {xsel.loop.type !== 4 && (
                  <SliderRow
                    label={t('세기')}
                    min={2}
                    max={xsel.loop.type === 2 ? 60 : 200}
                    step={2}
                    unit={xsel.loop.type === 2 ? '%' : 'px'}
                    value={xsel.loop.amount}
                    onLive={(v) =>
                      setCustomChannelsLive({ ...xsel, loop: { ...xsel.loop, amount: v } })
                    }
                    onCommit={commitEdit}
                  />
                )}
                <SliderRow
                  label={t('주기')}
                  min={0.2}
                  max={1.5}
                  step={0.05}
                  unit="s"
                  value={xsel.loop.period / 60}
                  onLive={(v) =>
                    setCustomChannelsLive({
                      ...xsel,
                      loop: { ...xsel.loop, period: Math.round(v * 60) },
                    })
                  }
                  onCommit={commitEdit}
                />
              </>
            )}
          </div>

          {/* 퇴장 (Out) */}
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">{t('퇴장')}</span>
            </div>
            <div className="knob__chips">
              {OUT_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.out.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, out: { ...xsel.out, type: i } })}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            {xsel.out.type > 0 && (
              <>
                <SliderRow
                  label={t('시간')}
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  unit="s"
                  value={xsel.out.dur / 60}
                  onLive={(v) =>
                    setCustomChannelsLive({ ...xsel, out: { ...xsel.out, dur: Math.round(v * 60) } })
                  }
                  onCommit={commitEdit}
                />
                {xsel.out.type >= 2 && xsel.out.type <= 5 && (
                  <SliderRow
                    label={t('거리')}
                    min={10}
                    max={400}
                    step={5}
                    unit="px"
                    value={xsel.out.dist}
                    onLive={(v) => setCustomChannelsLive({ ...xsel, out: { ...xsel.out, dist: v } })}
                    onCommit={commitEdit}
                  />
                )}
                {xsel.out.type !== 1 && (
                  <label className="check" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={xsel.out.bounce !== 0}
                      onChange={(e) =>
                        setCustomChannels({
                          ...xsel,
                          out: { ...xsel.out, bounce: e.target.checked ? 1 : 0 },
                        })
                      }
                    />
                    {t('바운스 (윈드업 — 당겼다가 나감)')}
                  </label>
                )}
              </>
            )}
          </div>
          </>
          )}

        </>
      )}

      {active && layers.length > 0 && (
        <>
          <h4 className="grouphead">{t('AI 모션 (베타)')}</h4>
          <AiMotionPanel />
        </>
      )}

      <p className="panel__hint">
        {active
          ? kfOn
            ? t('재생헤드를 옮기고 값을 바꾸면 키가 찍힙니다. 타임라인 다이아몬드 = 키 (드래그 이동 · 더블클릭 삭제).')
            : t('등장·루프·퇴장을 조합하세요. 타이밍은 아래 타임라인에서 밀고 당기기.')
          : t('그래픽을 올리면 등장/루프/퇴장을 조합해 애니메이션을 만듭니다. 여러 장 올리면 레이어로 쌓입니다.')}
      </p>
    </div>
  )
}

const AI_EXAMPLES = [
  '통통 튀며 등장했다가 붕 떠다니게',
  '왼쪽에서 순서대로 슬라이드 인',
  '두근거리는 하트비트 루프',
]

/** AI 모션 — 자연어 → 키프레임 (Motion Copilot 벤치, BYOK). */
function AiMotionPanel() {
  const applyAiMotion = useEditor((s) => s.applyAiMotion)
  const [apiKey, setApiKeyState] = useState(getAiKey)
  const [editKey, setEditKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 언마운트 시 진행 중 요청 정리
  useEffect(() => () => abortRef.current?.abort(), [])

  const [keyChecking, setKeyChecking] = useState(false)
  const keyCheckingRef = useRef(false) // Enter 연타 — 리렌더 전 중복 제출 가드
  const saveKey = async () => {
    if (keyCheckingRef.current) return
    keyCheckingRef.current = true
    // 콘솔에서 복사 시 줄바꿈/공백 섞임 방지 — 키에 공백은 없다
    const k = keyDraft.replace(/\s+/g, '')
    setKeyChecking(true)
    const v = await verifyAiKey(k)
    keyCheckingRef.current = false
    setKeyChecking(false)
    if (!v.ok) {
      setMsg({ kind: 'err', text: v.msg ?? t('키 확인 실패') })
      return
    }
    setAiKey(k)
    setApiKeyState(k)
    setKeyDraft('')
    setEditKey(false)
    setMsg(null)
  }

  const run = async () => {
    const req = prompt.trim()
    if (!req || busy) return
    const { sourceData, customIdxs, curFrame } = useEditor.getState()
    if (!sourceData) return
    setBusy(true)
    setMsg(null)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const doc = summarizeDoc(sourceData, customIdxs, curFrame)
      const plan = await generateMotion({ apiKey, prompt: req, doc, signal: ac.signal })
      const applied = applyAiMotion(plan)
      if (applied === 0) {
        setMsg({ kind: 'err', text: t('적용된 레이어가 없습니다 — 대상 레이어가 잠겨 있는지 확인하세요') })
      } else {
        setMsg({
          kind: 'ok',
          text: t('{note} — ⌘Z로 되돌릴 수 있어요').replace('{note}', plan.note ?? t('모션 적용됨')),
        })
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsg({ kind: 'err', text: (e as Error).message })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  if (!apiKey || editKey) {
    return (
      <div className="knob aipanel">
        <p className="knob__note">
          {t('문장으로 모션을 만들려면 Anthropic API 키가 필요합니다. 키는 이 브라우저에만 저장되고 Anthropic API 호출에만 쓰입니다 — 프로젝트 파일이나 내보내기에 포함되지 않습니다.')}
        </p>
        <div className="aipanel__keyrow">
          <input
            className="input"
            type="password"
            placeholder="sk-ant-…"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && keyDraft.trim()) saveKey()
            }}
            spellCheck={false}
          />
          <button className="btn" disabled={!keyDraft.trim() || keyChecking} onClick={saveKey}>
            {keyChecking ? t('확인 중…') : t('저장')}
          </button>
          {editKey && (
            <button className="btn" onClick={() => { setEditKey(false); setKeyDraft('') }}>
              {t('취소')}
            </button>
          )}
        </div>
        {msg && <p className={msg.kind === 'err' ? 'panel__error' : 'aipanel__ok'}>{msg.text}</p>}
        {editKey && apiKey && (
          <button
            className="aipanel__keybtn"
            onClick={() => {
              setAiKey('')
              setApiKeyState('')
              setEditKey(false)
              setKeyDraft('')
            }}
          >
            {t('저장된 키 삭제')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="knob aipanel">
      <textarea
        className="input aipanel__prompt"
        rows={2}
        placeholder={t('원하는 모션을 문장으로 — 예: 로고가 통통 튀며 들어오고 살짝 흔들리는 루프')}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            run()
          }
        }}
        disabled={busy}
        spellCheck={false}
      />
      <div className="knob__chips">
        {AI_EXAMPLES.map((ex) => (
          <button key={ex} className="chip" disabled={busy} onClick={() => setPrompt(t(ex))}>
            {t(ex)}
          </button>
        ))}
      </div>
      <div className="aipanel__actions">
        {busy ? (
          <>
            <button className="btn" disabled>
              {t('생성 중…')}
            </button>
            <button className="btn" onClick={() => abortRef.current?.abort()}>
              {t('취소')}
            </button>
          </>
        ) : (
          <button className="btn btn--primary" disabled={!prompt.trim()} onClick={run}>
            {t('모션 생성')}
          </button>
        )}
        <button className="aipanel__keybtn" onClick={() => setEditKey(true)} title={t('API 키 변경/삭제')}>
          {t('키 관리')}
        </button>
      </div>
      {msg && (
        <p className={msg.kind === 'err' ? 'panel__error' : 'aipanel__ok'}>{msg.text}</p>
      )}
      <p className="knob__note">
        {t('선택한 레이어가 있으면 그 레이어 위주로, 없으면 요청에 맞는 레이어에 적용합니다. 결과는 일반 키프레임이라 그대로 수정할 수 있습니다 (⌘Enter = 생성).')}
      </p>
    </div>
  )
}

/** 키프레임 모드 패널 — 채널별 키 토글/탐색/값 입력 + 이징 (AE 라이트). */
function KfPanel({
  xkf,
  xsel,
  base,
  compOp,
}: {
  xkf: CustomKf
  xsel: CustomSel
  base: [number, number] | null
  compOp: number
}) {
  const { setKfChannel, removeKfChannel, setKfEase, setKfSmooth, jumpTo, commitEdit } = useEditor()
  const curFrame = useEditor((s) => s.curFrame)
  const frame = Math.max(0, Math.min(compOp, curFrame))

  const channels = KF_CHANNEL_DEFS.filter(({ ch }) => ch !== 'pk')

  // 채널의 현재 프레임 값 (보간) — ◆로 캡처되는 값이기도 하다
  const valueOf = (ch: KfChannel): number | [number, number] =>
    kfValueAt(xkf, ch, frame, kfFallbackValue(ch, xsel, base ?? [256, 256]))

  return (
    <div className="knob kfpanel">
      <div className="knob__head">
        <span className="knob__name">{t('키프레임')}</span>
        <span className="knob__unit">
          {t('재생헤드 {f}f · {s}s')
            .replace('{f}', String(frame))
            .replace('{s}', (frame / 60).toFixed(2))}
        </span>
      </div>

      {channels.map(({ ch, label, unit }) => {
        const keys = kfChannelKeys(xkf, ch)
        const hasAt = keys.some((k) => Math.abs(k.t - frame) < 0.5)
        const prev = [...keys].reverse().find((k) => k.t < frame - 0.5)
        const next = keys.find((k) => k.t > frame + 0.5)
        const v = valueOf(ch)
        return (
          <div key={ch} className="kfrow">
            <button
              className="kfrow__nav"
              disabled={!prev}
              title={t('이전 키로')}
              onClick={() => prev && jumpTo(prev.t)}
            >
              ◀
            </button>
            <button
              className={`kfrow__key ${hasAt ? 'kfrow__key--on' : ''}`}
              title={hasAt ? t('이 프레임의 키 제거') : t('이 프레임에 키 추가')}
              onClick={() => {
                if (hasAt) removeKfChannel(ch, frame)
                else setKfChannel(ch, frame, v)
              }}
            >
              ◆
            </button>
            <button
              className="kfrow__nav"
              disabled={!next}
              title={t('다음 키로')}
              onClick={() => next && jumpTo(next.t)}
            >
              ▶
            </button>
            <span className="kfrow__label">
              {t(label)}
              {keys.length > 0 && <em className="kfrow__count">{keys.length}</em>}
            </span>
            {/* 위치 값은 아래 '위치' 행(X/Y)이 담당 — 여기선 스칼라 채널만 직접 입력 */}
            {ch !== 'p' && (
              <span className="kfrow__vals">
                <PosInput
                  label={unit}
                  value={v as number}
                  onCommit={(nv) => setKfChannel(ch, frame, nv)}
                />
              </span>
            )}
          </div>
        )
      })}

      <div className="knob__head" style={{ marginTop: 10 }}>
        <span className="knob__name">{t('기본 이징')}</span>
        <span className="knob__unit">{t('구간별: 타임라인 커브 버튼')}</span>
      </div>
      <div className="knob__chips">
        {KF_EASES.map((label, i) => (
          <button
            key={label}
            className={`chip ${xkf.ease === i ? 'chip--on' : ''}`}
            onClick={() => {
              setKfEase(i)
              commitEdit()
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="knob__head" style={{ marginTop: 10 }}>
        <span className="knob__name">{t('모션 패스')}</span>
      </div>
      <div className="knob__chips">
        <button className={`chip ${!xkf.smooth ? 'chip--on' : ''}`} onClick={() => setKfSmooth(false)}>
          {t('직선')}
        </button>
        <button
          className={`chip ${xkf.smooth ? 'chip--on' : ''}`}
          title={t('위치 키들을 부드러운 곡선으로 통과 (Catmull-Rom)')}
          onClick={() => setKfSmooth(true)}
        >
          {t('곡선')}
        </button>
      </div>
      <p className="knob__note">
        {t('캔버스 드래그·방향키·우측 패널 위치 X/Y = 재생헤드에 위치 키. 키가 있는 채널은 우측 변형 슬라이더도 키를 찍습니다.')}
      </p>
    </div>
  )
}

/** 위치 행 — 키프레임 모드에선 현재 프레임의 보간 위치를 보여주고 키를 찍는다. */
/** 위치 수치 입력 — blur/Enter 커밋, 외부 변경(드래그/undo) 자동 반영. */
export function PosInput({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
}) {
  const rounded = Math.round(value * 10) / 10
  const [draft, setDraft] = useState(String(rounded))
  const [focused, setFocused] = useState(false)
  const shown = focused ? draft : String(rounded)

  const commit = () => {
    setFocused(false)
    const v = evalNumExpr(draft, rounded)
    if (v !== null && Math.abs(v - rounded) > 1e-9) onCommit(v)
  }

  // 스크러비 넘버 — 라벨 좌우 드래그로 값 조절 (⇧ ×10 · ⌥ ×0.1), 릴리즈에 커밋
  const scrub = useRef<{ x0: number; v0: number; last: number; moved: boolean } | null>(null)

  return (
    <label className="posinput">
      <span
        className="posinput__label posinput__label--scrub"
        title={t('드래그로 값 조절 (⇧ ×10 · ⌥ ×0.1)')}
        onPointerDown={(e) => {
          scrub.current = { x0: e.clientX, v0: rounded, last: rounded, moved: false }
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const sc = scrub.current
          if (!sc) return
          const dx = e.clientX - sc.x0
          if (Math.abs(dx) > 2) sc.moved = true
          if (!sc.moved) return
          const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
          sc.last = Math.round((sc.v0 + dx * step) * 10) / 10
          setFocused(true)
          setDraft(String(sc.last))
        }}
        onPointerUp={(e) => {
          const sc = scrub.current
          scrub.current = null
          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
          setFocused(false)
          if (sc?.moved && Math.abs(sc.last - rounded) > 1e-9) onCommit(sc.last)
        }}
        onPointerCancel={() => {
          scrub.current = null
          setFocused(false)
        }}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        title={t('산술 입력 가능 — 100+50, *2, /4')}
        value={shown}
        onFocus={(e) => {
          setFocused(true)
          setDraft(e.target.value)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

/** 슬라이더 + 수치 직접 입력 — 슬라이더는 라이브, 입력은 blur/Enter 커밋. */
export function SliderRow({
  label,
  min,
  max,
  step,
  unit,
  value,
  onLive,
  onCommit,
}: {
  label: string
  min: number
  max: number
  step: number
  unit: string
  value: number
  onLive: (v: number) => void
  onCommit: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const decimals = step < 1 ? 2 : 0
  const shownValue = Number(value.toFixed(decimals))

  const commitDraft = () => {
    if (draft === null) return
    // 산술 입력 지원 — "100+50", "*2", "/4" (Creator 2.0 벤치)
    const v = evalNumExpr(draft, shownValue)
    setDraft(null)
    if (v !== null) {
      const clamped = Number(Math.min(max, Math.max(min, v)).toFixed(decimals))
      if (clamped !== shownValue) {
        onLive(clamped)
        onCommit()
      }
    }
  }

  return (
    <>
      <div className="knob__head" style={{ marginTop: 8 }}>
        <span className="knob__name">{label}</span>
        <span className="knob__valinput">
          <input
            type="text"
            inputMode="decimal"
            title={t('산술 입력 가능 — 100+50, *2, /4')}
            value={draft ?? String(shownValue)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <span className="knob__unit">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shownValue}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </>
  )
}
