/**
 * 브라우저에 Supabase 로그인 쿠키(`sb-*`)가 있는지 — 네트워크·Supabase 클라이언트 없이
 * 판단하는 힌트. middleware.ts 의 비회원 쿠키 발급과 같은 기준이며, @supabase/ssr 의
 * 기본 쿠키는 httpOnly:false 라 document.cookie 로 보인다.
 *
 * 쿠키가 있어도 세션이 만료됐을 수 있으므로 "없으면 확실히 비로그인"으로만 쓴다 —
 * 있으면 요청을 보내고 서버가 최종 판단한다.
 */
export function hasAuthCookieHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .some((cookie) => cookie.trim().startsWith('sb-'));
}
