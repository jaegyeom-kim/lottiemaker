import { useEditor } from '../store'
import { t } from '../lib/i18n'
import {
  normSel, normKf, kfValueAt, kfChannelKeys,
  type CustomKf, type CustomSel,
} from '../lib/customBuilder'
import { SliderRow, PosInput } from './CustomBuilder'
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
    setCustomChannelsLive, setCustomSizeLive, setKfChannelLive, commitEdit,
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

      <div className="knob">
        <SliderRow
          label={t('그래픽 크기')}
          min={40}
          max={480}
          step={4}
          unit="px"
          value={xsel.size}
          onLive={setCustomSizeLive}
          onCommit={commitEdit}
        />
      </div>

      {/* 스케일 (%) — 키프레임 모드 전용 s 채널. 프리셋 모드는 위 '그래픽 크기(px)'가 담당 */}
      {kfOn && (
        <div className="knob">
          <SliderRow
            label={sKeys ? t('스케일 ({f}f 키)').replace('{f}', String(curFrame)) : t('스케일')}
            min={0}
            max={400}
            step={1}
            unit="%"
            value={sKeys ? (kfValueAt(xkf, 's', curFrame, xsel.scale) as number) : xsel.scale}
            onLive={(v) => {
              // 키가 이미 있는 채널만 재생헤드에 키 — 없으면 정적 값 (AE 스톱워치 꺼짐)
              if (sKeys) setKfChannelLive('s', curFrame, v)
              else setCustomChannelsLive({ ...xsel, scale: v })
            }}
            onCommit={commitEdit}
          />
        </div>
      )}

      <div className="knob">
        <SliderRow
          label={rKeys ? t('회전 ({f}f 키)').replace('{f}', String(curFrame)) : t('회전')}
          min={-180}
          max={180}
          step={1}
          unit="°"
          value={rKeys ? (kfValueAt(xkf, 'r', curFrame, xsel.rotation) as number) : xsel.rotation}
          onLive={(v) => {
            if (rKeys) setKfChannelLive('r', curFrame, v)
            else setCustomChannelsLive({ ...xsel, rotation: v })
          }}
          onCommit={commitEdit}
        />
      </div>

      <div className="knob">
        <SliderRow
          label={oKeys ? t('불투명도 ({f}f 키)').replace('{f}', String(curFrame)) : t('불투명도')}
          min={0}
          max={100}
          step={1}
          unit="%"
          value={oKeys ? (kfValueAt(xkf, 'o', curFrame, xsel.opacity) as number) : xsel.opacity}
          onLive={(v) => {
            if (oKeys) setKfChannelLive('o', curFrame, v)
            else setCustomChannelsLive({ ...xsel, opacity: v })
          }}
          onCommit={commitEdit}
        />
        {kfOn && (rKeys || oKeys) && (
          <p className="knob__note">
            {t('키가 있는 채널은 슬라이더가 재생헤드({f}f)에 키를 찍습니다.').replace(
              '{f}',
              String(curFrame),
            )}
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
          <SliderRow
            label={t('트림 시작')}
            min={0}
            max={100}
            step={1}
            unit="%"
            value={kfValueAt(xkf, 'ts', curFrame, 0) as number}
            onLive={(v) => setKfChannelLive('ts', curFrame, v)}
            onCommit={commitEdit}
          />
          <SliderRow
            label={t('트림 끝')}
            min={0}
            max={100}
            step={1}
            unit="%"
            value={kfValueAt(xkf, 'te', curFrame, 100) as number}
            onLive={(v) => setKfChannelLive('te', curFrame, v)}
            onCommit={commitEdit}
          />
        </div>
      )}

      {/* 앵커 포인트 — 9점 그리드 + 이미지 드래그 패드 (기존 컴포넌트 재사용) */}
      <div className="knob">
        <AnchorControls />
      </div>
    </section>
  )
}
