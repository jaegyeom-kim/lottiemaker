// lottie_canvas 빌드는 패키지에 d.ts가 없음 — 본체 타입 재사용
declare module 'lottie-web/build/player/lottie_canvas' {
  import Lottie from 'lottie-web'
  export * from 'lottie-web'
  export default Lottie
}
