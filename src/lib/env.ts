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
};
