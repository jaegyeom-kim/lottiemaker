import { useEditor } from '../store'
import { t } from '../lib/i18n'
import { normSel, type CustomSel } from '../lib/customBuilder'
import AnchorPad from './AnchorPad'

/**
 * 선택 레이어의 앵커 포인트 컨트롤 — 9점 그리드 + (이미지) 드래그 패드.
 * 캔버스 팝오버와 어디서든 재사용 가능하게 스토어에서 직접 읽는다.
 */
export default function AnchorControls() {
  const { setCustomAnchor, setCustomAnchorLive, commitEdit } = useEditor()
  const sourceData = useEditor((s) => s.sourceData)
  const customIdx = useEditor((s) => s.customIdx)

  if (!sourceData?.layers.length) return null
  const idx = Math.min(customIdx, sourceData.layers.length - 1)
  const layer = sourceData.layers[idx] as Record<string, unknown> & { refId?: string }
  const xsel: CustomSel = normSel(layer.xsel as Partial<CustomSel> | undefined, sourceData.op)
  const anchor = xsel.anchor ?? [0.5, 0.5]

  const asset = layer.refId
    ? ((sourceData.assets as Record<string, unknown>[] | undefined)?.find(
        (a) => a.id === layer.refId,
      ) as { p?: string; w?: number; h?: number; layers?: unknown } | undefined)
    : undefined

  // 패드 소스 — 이미지는 썸네일, 컴프/씬은 뷰포트 비율, SVG는 셰이프 bbox 비율
  let padUri: string | undefined
  let padAspect: number | null = null
  if (asset?.p && asset.w && asset.h && !asset.layers) {
    padUri = asset.p
    padAspect = asset.w / asset.h
  } else if (Number(layer.ty) === 0 && typeof layer.w === 'number' && Number(layer.h)) {
    padAspect = (layer.w as number) / (layer.h as number)
  } else {
    const g = (layer.shapes as Record<string, unknown>[] | undefined)?.[0]
    const bw = Number(g?.bboxW)
    const bh = Number(g?.bboxH)
    if (bw > 0 && bh > 0) padAspect = bw / bh
  }

  return (
    <div>
      <div className="knob__head">
        <span className="knob__name">{t('앵커 포인트')}</span>
        <span className="knob__unit">
          {Math.round(anchor[0] * 100)}% · {Math.round(anchor[1] * 100)}%
        </span>
      </div>
      {/* 퀵설정(9점 그리드)과 직접 조정(패드)을 같은 크기로 좌우 배치 */}
      <div className="anchorrow">
        <div className="anchorgrid anchorgrid--big">
          {[0, 0.5, 1].map((fy) =>
            [0, 0.5, 1].map((fx) => {
              const on = Math.abs(anchor[0] - fx) < 0.02 && Math.abs(anchor[1] - fy) < 0.02
              return (
                <button
                  key={`${fx}-${fy}`}
                  className={`anchorgrid__dot ${on ? 'anchorgrid__dot--on' : ''}`}
                  onClick={() => setCustomAnchor(fx, fy)}
                />
              )
            }),
          )}
        </div>
        <div className="anchorcell">
          {padAspect ? (
            <AnchorPad
              dataUri={padUri}
              aspect={padAspect}
              frac={anchor}
              onLive={setCustomAnchorLive}
              onCommit={commitEdit}
              maxH={116}
            />
          ) : (
            <span className="anchorcell__empty">◇<br />{t('그리드로 지정')}</span>
          )}
        </div>
      </div>
      <p className="knob__note">{t('그래픽은 제자리 — 회전·스케일 피벗만 바뀝니다.')}</p>
    </div>
  )
}
