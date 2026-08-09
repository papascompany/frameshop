/**
 * Public env access — safe for client bundles.
 *
 * Only NEXT_PUBLIC_* variables live here. Anything sensitive (secret keys,
 * service-role, webhook secrets) MUST go in `src/lib/env.ts` which is
 * `'server-only'` and would fail the build if it leaked into a client chunk.
 *
 * ⚠️ 반드시 `process.env.NEXT_PUBLIC_X` **리터럴 정적 접근**으로 읽어야 한다.
 * `process.env[name]` 동적 접근은 Next(Turbopack)의 빌드타임 치환 대상이
 * 아니라서 클라이언트 번들에 값이 인라인되지 않는다 — 브라우저에서는
 * process 폴리필의 빈 env 를 읽어 전부 undefined 가 된다(2026-08-08 실사고:
 * siteUrl 이 localhost 로 폴백해 결제 successUrl 이 깨지고, supabaseUrl 은
 * throw 해 로그인 카트 동기화가 무음 실패).
 *
 * Throws lazily so build-time codepaths that don't actually call the helper
 * won't crash when env is missing locally.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const envPublic = {
  supabaseUrl: () =>
    required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () =>
    required(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  /**
   * 배포 기준 사이트 URL. 브라우저에서는 `window.location.origin` 이 더
   * 권위 있으므로(별칭·프리뷰 도메인 대응) 클라이언트 코드는 origin 을
   * 우선 사용하고 이 값은 서버·폴백 용도로만 쓴다.
   */
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
};

// tossClientKey 는 제거됨(2026-08-08) — 클라이언트 키는 어드민 설정(app_settings)
// 반영을 위해 서버가 getEffectiveTossClientKey() 로 해석해 RSC prop 으로 내린다.

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};
