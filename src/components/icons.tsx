import type { SVGProps } from 'react'

/** Google Material Symbols 계열 24×24 패스 — currentColor, 크기는 CSS가 결정. */
function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
      {children}
    </svg>
  )
}

/** contrast — 트랙 매트 (반 채운 원). */
export function MatteIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18V4a8 8 0 0 1 0 16z" />
    </Icon>
  )
}

/** picture_in_picture_alt — 부모 설정 (사각 안 사각). */
export function ParentIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M19 11h-8v6h8v-6zm4 8V5a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2zm-2 .02H3V4.97h18v14.05z" />
    </Icon>
  )
}

/** center_focus_strong — 솔로/포커스. */
export function SoloIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 15H3v4a2 2 0 0 0 2 2h4v-2H5v-4zM5 5h4V3H5a2 2 0 0 0-2 2v4h2V5zm14-2h-4v2h4v4h2V5a2 2 0 0 0-2-2zm0 16h-4v2h4a2 2 0 0 0 2-2v-4h-2v4z" />
    </Icon>
  )
}

/** visibility — 보임. */
export function EyeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
    </Icon>
  )
}

/** visibility_off — 숨김. */
export function EyeOffIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 7a5 5 0 0 1 5 5c0 .65-.13 1.26-.36 1.83l2.92 2.92A11.82 11.82 0 0 0 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55A4.98 4.98 0 0 1 7 12c0-.79.18-1.53.53-2.2z" />
    </Icon>
  )
}

/** lock — 잠금. */
export function LockIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM9 8V6a3 3 0 0 1 6 0v2H9z" />
    </Icon>
  )
}

/** lock_open — 잠금 해제. */
export function LockOpenIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6-5H9V6a3 3 0 0 1 5.91-.74l1.94-.49A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm0 12H6V10h12v10z" />
    </Icon>
  )
}

/** do_not_disturb_on — 타임라인에서 끄기. */
export function TloffIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-5-9h10v2H7v-2z" />
    </Icon>
  )
}

/** show_chart — 그래프 에디터. */
export function GraphIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 17.08l1.5 1.41z" />
    </Icon>
  )
}

/** undo. */
export function UndoIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
    </Icon>
  )
}

/** redo. */
export function RedoIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.97 7.22l2.37.78c1.05-3.19 4.06-5.5 7.6-5.5 1.96 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" />
    </Icon>
  )
}

/** wb_sunny — 라이트 모드. */
export function LightModeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z" />
    </Icon>
  )
}

/** dark_mode — 다크 모드. */
export function DarkModeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" />
    </Icon>
  )
}

/** near_me — 이동(선택) 툴. */
export function CursorIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z" />
    </Icon>
  )
}

/** back_hand — 핸드 툴. */
export function HandIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M13 23c-3.03 0-5.78-1.83-6.96-4.63l-2.87-7.2a1.4 1.4 0 0 1 2.28-1.5l1.55 1.55V4.5a1.5 1.5 0 0 1 3 0V11h1V2.5a1.5 1.5 0 0 1 3 0V11h1V3.5a1.5 1.5 0 0 1 3 0V11h1V6.5a1.5 1.5 0 0 1 3 0V15.5c0 4.14-3.36 7.5-7.5 7.5H13z" />
    </Icon>
  )
}

/** crop_square — 사각형 툴. */
export function SquareIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M18 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H6V6h12v12z" />
    </Icon>
  )
}

/** circle — 원 툴. */
export function CircleIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />
    </Icon>
  )
}

/** change_history — 삼각형 툴. */
export function TriangleIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 7.77L18.39 18H5.61L12 7.77M12 4L2 20h20L12 4z" />
    </Icon>
  )
}

/** star_border — 별 툴. */
export function StarIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z" />
    </Icon>
  )
}

/** 대각선 — 선 툴. */
export function LineIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M19.07 3.52L20.48 4.93 4.93 20.48 3.52 19.07z" />
    </Icon>
  )
}

/** edit — 펜 툴. */
export function AnchorTargetIcon(props: SVGProps<SVGSVGElement>) {
  // Material Symbols 'my_location' — 앵커/피벗 표적
  return (
    <Icon {...props}>
      <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4Zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06ZM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7Z" />
    </Icon>
  )
}

export function PenIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </Icon>
  )
}

/** play_arrow. */
export function PlayIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M8 5v14l11-7L8 5z" />
    </Icon>
  )
}

/** pause. */
export function PauseIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </Icon>
  )
}

/** content_copy — 복제. */
export function CopyIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" />
    </Icon>
  )
}

/** delete — 삭제. */
export function TrashIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </Icon>
  )
}

/** chevron_right — 접힘. */
export function ChevronRightIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6z" />
    </Icon>
  )
}

/** expand_more — 펼침. */
export function ExpandMoreIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6-1.41-1.41z" />
    </Icon>
  )
}

/** replay — 처음부터 재생. */
export function ReplayIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
    </Icon>
  )
}

/** crop_free — 100%/중앙 맞춤. */
export function FitIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M5 5h4V3H5a2 2 0 0 0-2 2v4h2V5zM3 15h2v4h4v2H5a2 2 0 0 1-2-2v-4zm16 4h-4v2h4a2 2 0 0 0 2-2v-4h-2v4zM19 3h-4v2h4v4h2V5a2 2 0 0 0-2-2z" />
    </Icon>
  )
}

/** layers — 어니언 스킨. */
export function LayersIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.26-7.38 5.73zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z" />
    </Icon>
  )
}

/** grid_view — 씬 탭. */
export function SceneIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h8v8h-8v-8zm2 2v4h4v-4h-4z" />
    </Icon>
  )
}

/** file_download — 다운로드. */
export function DownloadIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
    </Icon>
  )
}

/** videocam — 영상. */
export function MovieIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
    </Icon>
  )
}

/** code — 코드 스니펫. */
export function CodeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
    </Icon>
  )
}

/** save — 프로젝트 저장. */
export function SaveIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...p}>
      <path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z" />
    </Icon>
  )
}

/** Material 'add' — 그라디언트 스톱 추가 등. */
export function AddIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M11 13H5v-2h6V5h2v6h6v2h-6v6h-2v-6Z" />
    </Icon>
  )
}

/** Material 'close' — 스톱 삭제 등 작은 닫기. */
export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
    </Icon>
  )
}
