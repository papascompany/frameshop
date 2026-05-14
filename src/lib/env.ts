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

export const env = {
  // Public (re-exported via envPublic for ergonomics inside server modules).
  publicSupabaseUrl: () => envPublic.supabaseUrl(),
  publicSupabaseAnonKey: () => envPublic.supabaseAnonKey(),
  publicTossClientKey: () => envPublic.tossClientKey(),
  publicSiteUrl: () => envPublic.siteUrl(),

  // Server-only secrets — never re-exported from env-public.
  supabaseServiceRoleKey: () => readRequired('SUPABASE_SERVICE_ROLE_KEY'),
  tossSecretKey: () => readRequired('TOSS_SECRET_KEY'),
  tossWebhookSecret: () => readRequired('TOSS_WEBHOOK_SECRET'),

  // Optional — used for fallback to DB when env var is missing.
  tossSecretKeyOptional: () => readOptional('TOSS_SECRET_KEY'),
  tossWebhookSecretOptional: () => readOptional('TOSS_WEBHOOK_SECRET'),
  resendApiKey: () => readOptional('RESEND_API_KEY'),
};

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
