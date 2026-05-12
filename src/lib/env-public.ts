/**
 * Public env access — safe for client bundles.
 *
 * Only NEXT_PUBLIC_* variables live here. Anything sensitive (secret keys,
 * service-role, webhook secrets) MUST go in `src/lib/env.ts` which is
 * `'server-only'` and would fail the build if it leaked into a client chunk.
 *
 * Throws lazily so build-time codepaths that don't actually call the helper
 * won't crash when env is missing locally.
 */

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

export const envPublic = {
  supabaseUrl: () => readRequired('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => readRequired('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  tossClientKey: () => readRequired('NEXT_PUBLIC_TOSS_CLIENT_KEY'),
  siteUrl: () =>
    readOptional('NEXT_PUBLIC_SITE_URL') ?? 'http://localhost:3000',
};

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  tossClientKey: string;
};
