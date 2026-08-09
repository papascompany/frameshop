/**
 * Server-only env access. Importing this from a client component would
 * fail the build via the `'server-only'` marker.
 *
 * For NEXT_PUBLIC_* variables (safe in client bundles), use `env-public.ts`.
 *
 * Throws lazily so build-time codepaths that don't actually call the helper
 * won't crash when env is missing locally.
 */

import 'server-only';

import { envPublic } from './env-public';

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function readOptional(name: string): string | undefined {
  return process.env[name];
}

/**
 * placeholder 값(`test_ck_placeholder` 등)은 미설정으로 간주한다.
 * 초기 배포 때 심어둔 placeholder env 가 어드민 DB 설정(app_settings)을
 * 영구히 가리는 것을 막는다 — 실값 env 는 여전히 DB 보다 우선.
 */
function readOptionalReal(name: string): string | undefined {
  const value = process.env[name];
  if (!value || /placeholder/i.test(value)) return undefined;
  return value;
}

export const env = {
  // Public (re-exported via envPublic for ergonomics inside server modules).
  publicSupabaseUrl: () => envPublic.supabaseUrl(),
  publicSupabaseAnonKey: () => envPublic.supabaseAnonKey(),
  publicSiteUrl: () => envPublic.siteUrl(),

  // Server-only secrets — never re-exported from env-public.
  supabaseServiceRoleKey: () => readRequired('SUPABASE_SERVICE_ROLE_KEY'),
  tossSecretKey: () => readRequired('TOSS_SECRET_KEY'),
  tossWebhookSecret: () => readRequired('TOSS_WEBHOOK_SECRET'),

  // Optional — used for fallback to DB when env var is missing or placeholder.
  tossSecretKeyOptional: () => readOptionalReal('TOSS_SECRET_KEY'),
  tossWebhookSecretOptional: () => readOptionalReal('TOSS_WEBHOOK_SECRET'),
  tossClientKeyOptional: () => readOptionalReal('NEXT_PUBLIC_TOSS_CLIENT_KEY'),
  resendApiKey: () => readOptional('RESEND_API_KEY'),
};

/**
 * Toss 클라이언트 키를 반환 (없으면 null — 체크아웃이 결제 비활성 안내).
 * 실값 환경변수 우선 → placeholder/미설정이면 app_settings DB 조회.
 * 클라이언트 번들은 빌드 시점 env 를 인라인하므로, 어드민 설정이 재배포 없이
 * 반영되려면 반드시 이 서버 getter 를 거쳐 RSC prop 으로 내려야 한다.
 */
export async function getEffectiveTossClientKey(): Promise<string | null> {
  const envKey = env.tossClientKeyOptional();
  if (envKey) return envKey;
  const { getSetting } = await import('./db/settings');
  return getSetting('toss_client_key');
}

/**
 * Toss 시크릿 키를 반환.
 * 환경변수 우선 → 없으면 app_settings DB 조회.
 */
export async function getEffectiveTossSecretKey(): Promise<string> {
  const envKey = env.tossSecretKeyOptional();
  if (envKey) return envKey;
  const { getSetting } = await import('./db/settings');
  const dbKey = await getSetting('toss_secret_key');
  if (dbKey) return dbKey;
  throw new Error('Toss 시크릿 키가 설정되지 않았습니다. 환경변수 또는 어드민 설정을 확인하세요.');
}

/**
 * Toss 웹훅 시크릿을 반환.
 * 환경변수 우선 → 없으면 app_settings DB 조회.
 */
export async function getEffectiveTossWebhookSecret(): Promise<string> {
  const envKey = env.tossWebhookSecretOptional();
  if (envKey) return envKey;
  const { getSetting } = await import('./db/settings');
  const dbKey = await getSetting('toss_webhook_secret');
  if (dbKey) return dbKey;
  throw new Error('Toss 웹훅 시크릿이 설정되지 않았습니다. 환경변수 또는 어드민 설정을 확인하세요.');
}
