/**
 * Anonymous read-only Supabase client (no cookie / no session).
 *
 *  Used by public catalog queries — landing page, /catalog, /product —
 *  so the calling Server Component is **not** marked dynamic by Next.
 *  The cookied SSR client (`getServerSupabase`) reads `cookies()`, which
 *  forces the route off the static / ISR path; this client doesn't,
 *  so wrapping it with `unstable_cache` (or `revalidate = N`) actually
 *  produces a cacheable HTML payload.
 *
 *  Safe to use for ANY read whose RLS policy permits the `anon` role —
 *  in our schema that includes `categories`, `products`, `product_images`,
 *  `frame_assets`, `product_variants`, and `curations` (migration 012).
 *
 *  Never write through this client. Writes belong to either the cookied
 *  user client (`server.ts`) or the service client (`service.ts`).
 */

import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envPublic } from '../env-public';

let cached: SupabaseClient | null = null;

export function getAnonSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(envPublic.supabaseUrl(), envPublic.supabaseAnonKey(), {
    auth: {
      // No session — this client is short-lived and read-only.
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      // Tag traffic so Supabase logs distinguish SSR catalog reads from
      // authenticated user reads. Helpful when investigating slow queries.
      headers: { 'x-client-info': 'frameshop-ssr-anon/1' },
    },
  });
  return cached;
}
