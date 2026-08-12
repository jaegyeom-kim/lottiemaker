import { useEditor } from '../store'
import { t } from '../lib/i18n'
import {
  normSel, normKf, kfValueAt, kfChannelKeys,
  type CustomKf, type CustomSel,
} from '../lib/customBuilder'
import { PosInput } from './CustomBuilder'
import AnchorControls from './AnchorControls'

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
    nudgeCustomBase, setLayerBlend,
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
      <h4 className="grouphead">{String(selLayer.nm ?? '')}</h4>

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
