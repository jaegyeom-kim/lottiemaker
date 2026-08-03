import { useEffect, useRef, useState } from 'react'
import { evalNumExpr } from '../lib/num'
import { getAiKey, setAiKey, summarizeDoc, generateMotion } from '../lib/ai'
import { useEditor } from '../store'
import { svgToLottie, readImageFile } from '../lib/svgImport'
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

/**
 * 커스텀 탭 — 그래픽(SVG/PNG)을 레이어로 쌓고, 레이어별로
 * 등장/루프/퇴장 3슬롯(상용 모션 툴 방식)을 조합한다. 위치는 프리뷰에서 직접 드래그.
 */
export default function CustomBuilder() {
  const {
    templateId, addCustomLayer,
    setCustomChannels, setCustomChannelsLive, setCustomSizeLive, nudgeCustomBase,
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
  const setKfChannelLive = useEditor((s) => s.setKfChannelLive)
  const curFrame = useEditor((s) => s.curFrame)
  // 키가 있는 채널은 변형 슬라이더가 재생헤드에 키를 찍는다 (AE 스톱워치 방식)
  const rKeys = kfOn && kfChannelKeys(xkf, 'r').length > 0
  const oKeys = kfOn && kfChannelKeys(xkf, 'o').length > 0

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
        let payload: CustomPayload
        if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
          payload = { kind: 'svg', graphic: svgToLottie(await file.text()) }
        } else if (
          /^image\/(png|jpeg|webp)$/.test(file.type) ||
          /\.(png|jpe?g|webp)$/i.test(file.name)
        ) {
          payload = { kind: 'image', image: await readImageFile(file) }
        } else {
          throw new Error(`${file.name}: SVG/PNG/JPG/WebP 파일만 지원합니다`)
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
          SVG/PNG를 끌어다 놓거나 <u>클릭해서 선택</u> {active && '(여러 장 가능)'}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {error && <p className="panel__error">{error}</p>}

      {active && layers.length > 0 && (
        <>
          {/* 컴포지션 설정은 레이어 선택과 무관 — 항상 표시 */}
          <h4 className="grouphead">컴포지션</h4>
          <div className="knob">
            {/* AE 컴프 길이 — 레이어 클립/키프레임은 절대 시간 유지 */}
            <SliderRow
              label="재생 길이"
              min={0.5}
              max={6}
              step={0.1}
              unit="s"
              value={compOp / 60}
              onLive={(v) => setCompLengthLive(v)}
              onCommit={commitEdit}
            />
            <p className="knob__note">길이를 늘려도 각 레이어의 애니메이션 타이밍은 그대로입니다.</p>
          </div>
        </>
      )}

      {active && layers.length > 0 && !hasSel && (
        <p className="knob__note">캔버스나 레이어 목록에서 레이어를 선택하면 애니메이션 옵션이 나타납니다.</p>
      )}

      {active && selLayer && hasSel && (
        <>
          <h4 className="grouphead">애니메이션</h4>

          {/* 모드 — 프리셋(3슬롯) vs 키프레임(AE식 직접 키) */}
          <div className="opttabs" style={{ marginBottom: 8 }}>
            <button
              className={`opttab ${!kfOn ? 'opttab--on' : ''}`}
              title="등장/루프/퇴장 조합 — 간단하고 빠르게"
              onClick={() => kfOn && setLayerKfMode(false)}
            >
              프리셋
            </button>
            <button
              className={`opttab ${kfOn ? 'opttab--on' : ''}`}
              title="채널별 키프레임 직접 편집 — AE 방식"
              onClick={() => !kfOn && setLayerKfMode(true)}
            >
              키프레임
            </button>
          </div>

          {kfOn && <KfPanel xkf={xkf} xsel={xsel} base={base} compOp={compOp} />}

          {!kfOn && (
          <>
          {/* 등장 (In) */}
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">등장</span>
            </div>
            <div className="knob__chips">
              {IN_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.in.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, in: { ...xsel.in, type: i } })}
                >
                  {label}
                </button>
              ))}
            </div>
            {xsel.in.type > 0 && (
              <>
                <SliderRow
                  label="시간"
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
                    label="거리"
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
                    바운스 (오버슈트)
                  </label>
                )}
              </>
            )}
          </div>

          {/* 루프 (Loop) */}
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">루프</span>
            </div>
            <div className="knob__chips">
              {LOOP_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.loop.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, loop: { ...xsel.loop, type: i } })}
                >
                  {label}
                </button>
              ))}
            </div>
            {xsel.loop.type > 0 && (
              <>
                {xsel.loop.type !== 4 && (
                  <SliderRow
                    label="세기"
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
                  label="주기"
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
              <span className="knob__name">퇴장</span>
            </div>
            <div className="knob__chips">
              {OUT_TYPES.map((label, i) => (
                <button
                  key={label}
                  className={`chip ${xsel.out.type === i ? 'chip--on' : ''}`}
                  onClick={() => setCustomChannels({ ...xsel, out: { ...xsel.out, type: i } })}
                >
                  {label}
                </button>
              ))}
            </div>
            {xsel.out.type > 0 && (
              <>
                <SliderRow
                  label="시간"
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
                    label="거리"
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
                    바운스 (윈드업 — 당겼다가 나감)
                  </label>
                )}
              </>
            )}
          </div>
          </>
          )}

          <h4 className="grouphead">변형</h4>
          <div className="knob">
            <SliderRow
              label="그래픽 크기"
              min={40}
              max={480}
              step={4}
              unit="px"
              value={xsel.size}
              onLive={setCustomSizeLive}
              onCommit={commitEdit}
            />
          </div>

          <div className="knob">
            <SliderRow
              label={rKeys ? `회전 (${curFrame}f 키)` : '회전'}
              min={-180}
              max={180}
              step={1}
              unit="°"
              value={
                rKeys ? (kfValueAt(xkf, 'r', curFrame, xsel.rotation) as number) : xsel.rotation
              }
              onLive={(v) => {
                if (rKeys) setKfChannelLive('r', curFrame, v)
                else setCustomChannelsLive({ ...xsel, rotation: v })
              }}
              onCommit={commitEdit}
            />
          </div>

          <div className="knob">
            <SliderRow
              label={oKeys ? `불투명도 (${curFrame}f 키)` : '불투명도'}
              min={0}
              max={100}
              step={1}
              unit="%"
              value={
                oKeys ? (kfValueAt(xkf, 'o', curFrame, xsel.opacity) as number) : xsel.opacity
              }
              onLive={(v) => {
                if (oKeys) setKfChannelLive('o', curFrame, v)
                else setCustomChannelsLive({ ...xsel, opacity: v })
              }}
              onCommit={commitEdit}
            />
            {kfOn && (rKeys || oKeys) && (
              <p className="knob__note">
                키가 있는 채널은 슬라이더가 재생헤드({curFrame}f)에 키를 찍습니다.
              </p>
            )}
          </div>

          {base && (
            <PositionRow
              kfOn={kfOn}
              xkf={xkf}
              base={base}
              nudge={nudgeCustomBase}
            />
          )}
        </>
      )}

      {active && layers.length > 0 && (
        <>
          <h4 className="grouphead">AI 모션 (베타)</h4>
          <AiMotionPanel />
        </>
      )}

      <p className="panel__hint">
        {active
          ? kfOn
            ? '재생헤드를 옮기고 값을 바꾸면 키가 찍힙니다. 타임라인 다이아몬드 = 키 (드래그 이동 · 더블클릭 삭제).'
            : '등장·루프·퇴장을 조합하세요. 타이밍은 아래 타임라인에서 밀고 당기기.'
          : '그래픽을 올리면 등장/루프/퇴장을 조합해 애니메이션을 만듭니다. 여러 장 올리면 레이어로 쌓입니다.'}
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

  const saveKey = () => {
    // 콘솔에서 복사 시 줄바꿈/공백 섞임 방지 — 키에 공백은 없다
    const k = keyDraft.replace(/\s+/g, '')
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
      applyAiMotion(plan)
      setMsg({ kind: 'ok', text: `${plan.note ?? '모션 적용됨'} — ⌘Z로 되돌릴 수 있어요` })
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
          문장으로 모션을 만들려면 Anthropic API 키가 필요합니다. 키는 이 브라우저에만 저장되고
          Anthropic API 호출에만 쓰입니다 — 프로젝트 파일이나 내보내기에 포함되지 않습니다.
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
          <button className="btn" disabled={!keyDraft.trim()} onClick={saveKey}>
            저장
          </button>
          {editKey && (
            <button className="btn" onClick={() => { setEditKey(false); setKeyDraft('') }}>
              취소
            </button>
          )}
        </div>
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
            저장된 키 삭제
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
        placeholder="원하는 모션을 문장으로 — 예: 로고가 통통 튀며 들어오고 살짝 흔들리는 루프"
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
          <button key={ex} className="chip" disabled={busy} onClick={() => setPrompt(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <div className="aipanel__actions">
        {busy ? (
          <>
            <button className="btn" disabled>
              생성 중…
            </button>
            <button className="btn" onClick={() => abortRef.current?.abort()}>
              취소
            </button>
          </>
        ) : (
          <button className="btn btn--primary" disabled={!prompt.trim()} onClick={run}>
            모션 생성
          </button>
        )}
        <button className="aipanel__keybtn" onClick={() => setEditKey(true)} title="API 키 변경/삭제">
          키 관리
        </button>
      </div>
      {msg && (
        <p className={msg.kind === 'err' ? 'panel__error' : 'aipanel__ok'}>{msg.text}</p>
      )}
      <p className="knob__note">
        선택한 레이어가 있으면 그 레이어 위주로, 없으면 요청에 맞는 레이어에 적용합니다. 결과는
        일반 키프레임이라 그대로 수정할 수 있습니다 (⌘Enter = 생성).
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
  const { setKfChannel, removeKfChannel, setKfEase, jumpTo, commitEdit } = useEditor()
  const curFrame = useEditor((s) => s.curFrame)
  const t = Math.max(0, Math.min(compOp, curFrame))

  const channels = KF_CHANNEL_DEFS

  // 채널의 현재 프레임 값 (보간) — ◆로 캡처되는 값이기도 하다
  const valueOf = (ch: KfChannel): number | [number, number] =>
    kfValueAt(xkf, ch, t, kfFallbackValue(ch, xsel, base ?? [256, 256]))

  return (
    <div className="knob kfpanel">
      <div className="knob__head">
        <span className="knob__name">키프레임</span>
        <span className="knob__unit">
          재생헤드 {t}f · {(t / 60).toFixed(2)}s
        </span>
      </div>

      {channels.map(({ ch, label, unit }) => {
        const keys = kfChannelKeys(xkf, ch)
        const hasAt = keys.some((k) => Math.abs(k.t - t) < 0.5)
        const prev = [...keys].reverse().find((k) => k.t < t - 0.5)
        const next = keys.find((k) => k.t > t + 0.5)
        const v = valueOf(ch)
        return (
          <div key={ch} className="kfrow">
            <button
              className="kfrow__nav"
              disabled={!prev}
              title="이전 키로"
              onClick={() => prev && jumpTo(prev.t)}
            >
              ◀
            </button>
            <button
              className={`kfrow__key ${hasAt ? 'kfrow__key--on' : ''}`}
              title={hasAt ? '이 프레임의 키 제거' : '이 프레임에 키 추가'}
              onClick={() => {
                if (hasAt) removeKfChannel(ch, t)
                else setKfChannel(ch, t, v)
              }}
            >
              ◆
            </button>
            <button
              className="kfrow__nav"
              disabled={!next}
              title="다음 키로"
              onClick={() => next && jumpTo(next.t)}
            >
              ▶
            </button>
            <span className="kfrow__label">
              {label}
              {keys.length > 0 && <em className="kfrow__count">{keys.length}</em>}
            </span>
            {/* 위치 값은 아래 '위치' 행(X/Y)이 담당 — 여기선 스칼라 채널만 직접 입력 */}
            {ch !== 'p' && (
              <span className="kfrow__vals">
                <PosInput
                  label={unit}
                  value={v as number}
                  onCommit={(nv) => setKfChannel(ch, t, nv)}
                />
              </span>
            )}
          </div>
        )
      })}

      <div className="knob__head" style={{ marginTop: 10 }}>
        <span className="knob__name">기본 이징</span>
        <span className="knob__unit">구간별: 타임라인 커브 버튼</span>
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
            {label}
          </button>
        ))}
      </div>
      <p className="knob__note">
        캔버스 드래그·방향키·아래 위치 X/Y = 재생헤드에 위치 키. 키가 있는 채널은 변형 슬라이더도 키를
        찍습니다.
      </p>
    </div>
  )
}

/** 위치 행 — 키프레임 모드에선 현재 프레임의 보간 위치를 보여주고 키를 찍는다. */
function PositionRow({
  kfOn,
  xkf,
  base,
  nudge,
}: {
  kfOn: boolean
  xkf: CustomKf
  base: [number, number]
  nudge: (dx: number, dy: number) => void
}) {
  const curFrame = useEditor((s) => s.curFrame)
  const pos = kfOn ? (kfValueAt(xkf, 'p', curFrame, base) as [number, number]) : base
  return (
    <div className="knob">
      <div className="knob__head">
        <span className="knob__name">위치{kfOn ? ` (${curFrame}f)` : ''}</span>
        <button className="linkbtn" onClick={() => nudge(256 - pos[0], 256 - pos[1])}>
          캔버스 중앙
        </button>
      </div>
      <div className="posrow">
        <PosInput label="X" value={pos[0]} onCommit={(v) => nudge(v - pos[0], 0)} />
        <PosInput label="Y" value={pos[1]} onCommit={(v) => nudge(0, v - pos[1])} />
      </div>
    </div>
  )
}

/** 위치 수치 입력 — blur/Enter 커밋, 외부 변경(드래그/undo) 자동 반영. */
function PosInput({
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

  return (
    <label className="posinput">
      <span className="posinput__label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        title="산술 입력 가능 — 100+50, *2, /4"
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
function SliderRow({
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
            title="산술 입력 가능 — 100+50, *2, /4"
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
