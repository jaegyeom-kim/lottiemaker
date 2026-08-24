import { useEditor, type ShapeMeta, type TextMeta } from '../store'
import { TextSection } from './TextControls'
import { rgbArrayToHex } from '../lib/lottieColors'
import { idbLibPut } from '../lib/sessionStore'
import { t } from '../lib/i18n'
import {
  normSel, normKf, kfValueAt, kfChannelKeys, pkMismatch,
  type CustomKf, type CustomSel,
} from '../lib/customBuilder'
import { PosInput } from './CustomBuilder'
import AnchorControls from './AnchorControls'
import { AddIcon, CloseIcon } from './icons'

/** xshape.tool → 표시 라벨. */
const TOOL_LABELS: Record<string, string> = {
  rect: '사각형', ellipse: '원형', polygon: '삼각형', star: '별',
}

/** 로티 블렌드 모드 (bm) — 순서 = 로티 스펙 인덱스. */
const BLEND_MODES = [
  '표준', '곱하기', '스크린', '오버레이', '어둡게', '밝게', '컬러 닷지', '컬러 번',
  '하드 라이트', '소프트 라이트', '차이', '제외', '색조', '채도', '컬러', '광도',
]

/**
 * 우측 속성 패널 — 선택 레이어의 트랜스폼(위치/크기/회전/불투명도)·블렌드·앵커.
 * LottieFiles Creator의 우측 레이어 옵션 배치를 따른다.
 */
export default function TransformPanel() {
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)
  const curFrame = useEditor((s) => s.curFrame)
  const {
    setCustomChannelsLive, setKfChannelLive, commitEdit,
    nudgeCustomBase, setLayerBlend, setLayerStroke, setShapeGeom, togglePathKf, matchPathPoints,
    setLayerFill, setLayerFillStopsLive, addLayerStroke, removeLayerStroke,
  } = useEditor()

  const layers = sourceData?.layers ?? []
  if (!layers.length) return null
  const idx = Math.min(customIdx, layers.length - 1)
  const selLayer = layers[idx] as Record<string, unknown> | undefined
  if (!selLayer) return null
  const xsel: CustomSel = normSel(
    selLayer.xsel as Partial<CustomSel> | undefined,
    sourceData!.op,
  )
  const xkf: CustomKf = normKf(selLayer.xkf as Partial<CustomKf> | undefined)
  const kfOn = xkf.on
  const sKeys = kfOn && kfChannelKeys(xkf, 's').length > 0
  const rKeys = kfOn && kfChannelKeys(xkf, 'r').length > 0
  const oKeys = kfOn && kfChannelKeys(xkf, 'o').length > 0
  const base: [number, number] = Array.isArray(selLayer.xbase)
    ? [(selLayer.xbase as number[])[0], (selLayer.xbase as number[])[1]]
    : [256, 256]
  const pos = kfOn ? (kfValueAt(xkf, 'p', curFrame, base) as [number, number]) : base

  return (
    <section className="panel__group">
      {/* 섹션 제목은 바깥 Section이 — 여기선 선택 레이어 이름만 */}
      <h4 className="grouphead grouphead--row">
        {String(selLayer.nm ?? '')}
        {(() => {
          // 재사용 가능한 그래픽 소스 — SVG 원본(xsrc) 또는 이미지 에셋 dataURI
          const svg = typeof selLayer.xsrc === 'string' ? (selLayer.xsrc as string) : null
          const asset = ((sourceData?.assets as Record<string, unknown>[] | undefined) ?? []).find(
            (a) => a.id === selLayer.refId && typeof a.p === 'string' && (a.p as string).startsWith('data:image'),
          )
          if (!svg && !asset) return null
          return (
            <button
              className="linkbtn"
              title={t('이 그래픽을 라이브러리에 저장 — 다른 문서에서도 재사용')}
              onClick={async () => {
                const at = Date.now()
                await idbLibPut(
                  svg
                    ? { id: `lib_${at}`, name: String(selLayer.nm ?? '그래픽'), at, kind: 'svg', data: svg }
                    : {
                        id: `lib_${at}`, name: String(selLayer.nm ?? '이미지'), at, kind: 'image',
                        data: String(asset!.p),
                        w: Number(asset!.w ?? 256), h: Number(asset!.h ?? 256),
                      },
                )
                window.dispatchEvent(new Event('lm:library-changed'))
              }}
            >
              {t('라이브러리에 저장')}
            </button>
          )
        })()}
      </h4>

      {/* 위치 */}
      <div className="knob">
        <div className="knob__head">
          <span className="knob__name">
            {t('위치')}
            {kfOn ? ` (${curFrame}f)` : ''}
          </span>
          <button className="linkbtn" onClick={() => nudgeCustomBase(256 - pos[0], 256 - pos[1])}>
            {t('캔버스 중앙')}
          </button>
        </div>
        <div className="posrow">
          <PosInput label="X" value={pos[0]} onCommit={(v) => nudgeCustomBase(v - pos[0], 0)} />
          <PosInput label="Y" value={pos[1]} onCommit={(v) => nudgeCustomBase(0, v - pos[1])} />
        </div>
      </div>

      {/* 변형 — AE식 숫자 입력 (스케일/회전/불투명도). 키 있는 채널만 재생헤드에 키 */}
      <div className="knob">
        <div className="posrow">
          <PosInput
            label={`${t('스케일')}${sKeys ? ' ◆' : ''} %`}
            value={sKeys ? (kfValueAt(xkf, 's', curFrame, xsel.scale) as number) : xsel.scale}
            onCommit={(v) => {
              if (sKeys) setKfChannelLive('s', curFrame, v)
              else setCustomChannelsLive({ ...xsel, scale: v })
              commitEdit()
            }}
          />
          <PosInput
            label={`${t('회전')}${rKeys ? ' ◆' : ''} °`}
            value={rKeys ? (kfValueAt(xkf, 'r', curFrame, xsel.rotation) as number) : xsel.rotation}
            onCommit={(v) => {
              if (rKeys) setKfChannelLive('r', curFrame, v)
              else setCustomChannelsLive({ ...xsel, rotation: v })
              commitEdit()
            }}
          />
        </div>
        <div className="posrow">
          <PosInput
            label={`${t('불투명도')}${oKeys ? ' ◆' : ''} %`}
            value={oKeys ? (kfValueAt(xkf, 'o', curFrame, xsel.opacity) as number) : xsel.opacity}
            onCommit={(v) => {
              const c = Math.max(0, Math.min(100, v))
              if (oKeys) setKfChannelLive('o', curFrame, c)
              else setCustomChannelsLive({ ...xsel, opacity: c })
              commitEdit()
            }}
          />
        </div>
        {kfOn && (sKeys || rKeys || oKeys) && (
          <p className="knob__note">
            {t('◆ 채널은 값 변경 시 재생헤드({f}f)에 키를 찍습니다.').replace('{f}', String(curFrame))}
          </p>
        )}
      </div>

      {/* 도형 — 드로잉 툴로 만든 레이어(xshape 메타): 지오메트리 크기·라운드 코너 */}
      {(() => {
        const xs = selLayer.xshape as ShapeMeta | undefined
        if (!xs) return null
        return (
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">{t('도형')}</span>
              <span className="knob__unit">{t(TOOL_LABELS[xs.tool] ?? xs.tool)}</span>
            </div>
            <div className="posrow">
              <PosInput label="W" value={xs.w} onCommit={(v) => setShapeGeom(idx, { w: v })} />
              <PosInput label="H" value={xs.h} onCommit={(v) => setShapeGeom(idx, { h: v })} />
            </div>
            {xs.tool === 'rect' && (
              <div className="posrow">
                <PosInput
                  label={t('라운드')}
                  value={xs.r ?? 0}
                  onCommit={(v) => setShapeGeom(idx, { r: v })}
                />
              </div>
            )}
          </div>
        )
      })()}

      {/* 패스 애니메이션 — 단일 sh 레이어(펜/도형): pk 채널 스톱워치 */}
      {(() => {
        const shs: Record<string, unknown>[] = []
        const walkSh = (items?: Record<string, unknown>[]) => {
          for (const it of items ?? []) {
            if (it.ty === 'sh') shs.push(it)
            else if (it.ty === 'gr') walkSh(it.it as Record<string, unknown>[])
          }
        }
        walkSh(((selLayer.shapes as Record<string, unknown>[] | undefined)?.[0] as Record<string, unknown> | undefined)?.it as Record<string, unknown>[])
        if (shs.length !== 1 || Number(selLayer.ty) !== 4) return null
        const pkOn = kfChannelKeys(xkf, 'pk').length > 0
        return (
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">{t('패스 애니메이션')}{pkOn ? ' ◆' : ''}</span>
              <button className="linkbtn" onClick={() => togglePathKf(idx)}>
                {pkOn ? t('끄기 (현재 형태로 고정)') : t('켜기')}
              </button>
            </div>
            {pkOn && (
              <p className="knob__note">
                {t('펜 툴로 패스를 수정하면 재생헤드({f}f)에 키를 찍습니다.').replace('{f}', String(curFrame))}
              </p>
            )}
            {pkOn && pkMismatch(xkf) && (
              <p className="knob__note knob__note--warn">
                {t('⚠ 키 간 포인트 수가 달라 모핑되지 않는 구간이 있습니다.')}{' '}
                <button className="linkbtn" onClick={() => matchPathPoints(idx)}>
                  {t('포인트 수 맞추기')}
                </button>
              </p>
            )}
          </div>
        )
      })()}

      {/* 텍스트 — xtext 레이어: 내용·크기·줄간격·폰트 재생성 */}
      {selLayer.xtext != null && (
        <TextSection idx={idx} meta={selLayer.xtext as TextMeta} />
      )}

      {/* 칠 — 단색 ↔ 그라디언트 (선형/방사), 드로잉 레이어의 fl/gf */}
      {(() => {
        let painter: Record<string, unknown> | null = null
        const walkF = (items?: Record<string, unknown>[]) => {
          for (const it of items ?? []) {
            if ((it.ty === 'fl' || it.ty === 'gf') && !painter) painter = it
            else if (it.ty === 'gr') walkF(it.it as Record<string, unknown>[])
          }
        }
        walkF(((selLayer.shapes as Record<string, unknown>[] | undefined)?.[0] as Record<string, unknown> | undefined)?.it as Record<string, unknown>[])
        if (!painter) return null
        const pt = painter as Record<string, unknown>
        const isG = pt.ty === 'gf'
        const stops = isG
          ? (((pt.g as Record<string, unknown>)?.k as Record<string, unknown>)?.k as number[] | undefined) ?? []
          : []
        const from = isG && stops.length >= 8 ? rgbArrayToHex([stops[1], stops[2], stops[3]]) : '#3380f5'
        const to = isG && stops.length >= 8 ? rgbArrayToHex([stops[5], stops[6], stops[7]]) : '#9b6ee8'
        const solidHex = !isG
          ? rgbArrayToHex(((pt.c as Record<string, unknown>)?.k as number[] | undefined) ?? [0.2, 0.5, 0.96])
          : from
        const kind: 'solid' | 'linear' | 'radial' = !isG ? 'solid' : Number(pt.t) === 2 ? 'radial' : 'linear'
        // 현재 각도 — s→e 벡터에서 역산
        const sPt = ((pt.s as Record<string, unknown>)?.k as number[] | undefined) ?? [0, 0]
        const ePt = ((pt.e as Record<string, unknown>)?.k as number[] | undefined) ?? [1, 0]
        const angle = Math.round((Math.atan2(ePt[1] - sPt[1], ePt[0] - sPt[0]) * 180) / Math.PI)
        return (
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">{t('칠')}</span>
              <select
                className="input input--inline"
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as 'solid' | 'linear' | 'radial'
                  if (k === 'solid') setLayerFill(idx, { kind: 'solid', hex: solidHex })
                  else setLayerFill(idx, { kind: k, from: isG ? from : solidHex, to, angle: kind === 'solid' ? 0 : angle })
                }}
              >
                <option value="solid">{t('단색')}</option>
                <option value="linear">{t('선형 그라디언트')}</option>
                <option value="radial">{t('방사 그라디언트')}</option>
              </select>
            </div>
            {isG && (() => {
              // 스톱 목록 [{t, hex}] — g.k.k = [t,r,g,b]×N
              const list: { t: number; hex: string }[] = []
              for (let i = 0; i + 3 < stops.length; i += 4)
                list.push({ t: stops[i], hex: rgbArrayToHex([stops[i + 1], stops[i + 2], stops[i + 3]]) })
              const commitStops = (next: { t: number; hex: string }[]) => {
                setLayerFillStopsLive(idx, next)
                commitEdit()
              }
              // 새 스톱 — 가장 넓은 구간의 중간, 색은 이웃 보간
              const addStop = () => {
                let gi = 0
                let gap = -1
                for (let i = 0; i < list.length - 1; i++)
                  if (list[i + 1].t - list[i].t > gap) {
                    gap = list[i + 1].t - list[i].t
                    gi = i
                  }
                const a = list[gi]
                const b = list[gi + 1]
                const pa = [1, 3, 5].map((o) => parseInt(a.hex.slice(o, o + 2), 16))
                const pb = [1, 3, 5].map((o) => parseInt(b.hex.slice(o, o + 2), 16))
                const mixHex = `#${pa.map((v, j) => Math.round((v + pb[j]) / 2).toString(16).padStart(2, '0')).join('')}`
                commitStops([...list, { t: Math.round(((a.t + b.t) / 2) * 1000) / 1000, hex: mixHex }])
              }
              return (
                <>
                  {list.map((sp, i) => (
                    <div className="posrow posrow--fill" key={i}>
                      <input
                        type="color"
                        value={sp.hex}
                        title={t('스톱 색')}
                        onChange={(e) =>
                          setLayerFillStopsLive(
                            idx,
                            list.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)),
                          )
                        }
                        onBlur={commitEdit}
                      />
                      <PosInput
                        label="%"
                        value={Math.round(sp.t * 100)}
                        onCommit={(v) =>
                          commitStops(list.map((x, j) => (j === i ? { ...x, t: Math.max(0, Math.min(100, v)) / 100 } : x)))
                        }
                      />
                      <button
                        className="linkbtn linkbtn--icon"
                        disabled={list.length <= 2}
                        title={t('스톱 삭제')}
                        onClick={() => commitStops(list.filter((_, j) => j !== i))}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ))}
                  <div className="posrow posrow--fill">
                    <button className="linkbtn linkbtn--icon" title={t('스톱 추가')} onClick={addStop}>
                      <AddIcon /> {t('스톱 추가')}
                    </button>
                    {kind === 'linear' && (
                      <PosInput
                        label={`${t('각도')} °`}
                        value={angle}
                        onCommit={(v) => setLayerFill(idx, { kind, from, to, angle: v })}
                      />
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        )
      })()}

      {/* 선(스트로크) — 패스/선 레이어일 때만: 두께·라인캡 */}
      {(() => {
        const strokes: Record<string, unknown>[] = []
        const walk = (items?: Record<string, unknown>[]) => {
          for (const it of items ?? []) {
            if (it.ty === 'st') strokes.push(it)
            else if (it.ty === 'gr') walk(it.it as Record<string, unknown>[])
          }
        }
        walk(((selLayer.shapes as Record<string, unknown>[] | undefined)?.[0] as Record<string, unknown> | undefined)?.it as Record<string, unknown>[])
        // 셰이프 레이어인데 선이 없으면 — 추가 버튼
        if (!strokes.length) {
          if (Number(selLayer.ty) !== 4 || !(selLayer.shapes as unknown[])?.length) return null
          return (
            <div className="knob">
              <div className="knob__head">
                <span className="knob__name">{t('선')}</span>
                <button className="linkbtn" onClick={() => addLayerStroke(idx)}>
                  {t('선 추가')}
                </button>
              </div>
            </div>
          )
        }
        const st0 = strokes[0]
        const w = Number((st0.w as { k?: number } | undefined)?.k ?? 1)
        const lc = Number(st0.lc ?? 2)
        const dash = (() => {
          const d = st0.d as { n?: string; v?: { k?: number } }[] | undefined
          const dd = d?.find((x) => x.n === 'd')
          return Number(dd?.v?.k ?? 0)
        })()
        return (
          <div className="knob">
            <div className="knob__head">
              <span className="knob__name">{t('선')}</span>
              <button className="linkbtn" onClick={() => removeLayerStroke(idx)}>
                {t('선 제거')}
              </button>
            </div>
            <div className="posrow posrow--stroke">
              <PosInput
                label={`${t('두께')} px`}
                value={w}
                onCommit={(v) => setLayerStroke(idx, { w: Math.max(0.5, v) })}
              />
              <select
                className="input"
                value={lc}
                title={t('라인 캡')}
                onChange={(e) => setLayerStroke(idx, { lc: Number(e.target.value) })}
              >
                <option value={1}>{t('버트')}</option>
                <option value={2}>{t('라운드')}</option>
                <option value={3}>{t('스퀘어')}</option>
              </select>
            </div>
            <div className="posrow">
              <PosInput
                label={`${t('대시')} px`}
                value={dash}
                onCommit={(v) => setLayerStroke(idx, { dash: Math.max(0, v) })}
              />
            </div>
          </div>
        )
      })()}

      {/* 블렌드 모드 — Lottie bm, 내보낸 JSON에도 그대로 실림 */}
      <div className="knob">
        <div className="knob__head">
          <span className="knob__name">{t('블렌드 모드')}</span>
        </div>
        <select
          className="input"
          value={Number(selLayer.bm ?? 0)}
          onChange={(e) => setLayerBlend(Number(e.target.value))}
        >
          {BLEND_MODES.map((label, i) => (
            <option key={label} value={i}>
              {t(label)}
            </option>
          ))}
        </select>
      </div>

      {/* 트림 패스 — 셰이프 레이어 전용. 값 변경 = 재생헤드에 키 (키 1개 = 정적) */}
      {Number(selLayer.ty) === 4 && (
        <div className="knob">
          <div className="knob__head">
            <span className="knob__name">{t('트림 패스')}</span>
            <span className="knob__unit">{t('값 변경 = 재생헤드에 키')}</span>
          </div>
          <div className="posrow">
            <PosInput
              label={`${t('시작')} %`}
              value={kfValueAt(xkf, 'ts', curFrame, 0) as number}
              onCommit={(v) => {
                setKfChannelLive('ts', curFrame, Math.max(0, Math.min(100, v)))
                commitEdit()
              }}
            />
            <PosInput
              label={`${t('끝')} %`}
              value={kfValueAt(xkf, 'te', curFrame, 100) as number}
              onCommit={(v) => {
                setKfChannelLive('te', curFrame, Math.max(0, Math.min(100, v)))
                commitEdit()
              }}
            />
          </div>
        </div>
      )}

      {/* 앵커 포인트 — 9점 그리드 + 이미지 드래그 패드 (기존 컴포넌트 재사용) */}
      <div className="knob">
        <AnchorControls />
      </div>
    </section>
  )
}
