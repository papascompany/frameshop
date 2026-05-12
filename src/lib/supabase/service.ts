/**
 * Service-role Supabase client. Bypasses RLS — handle with care.
 *
 * Allowed callers:
 *   - app/api/webhook/payment/route.ts (Toss webhook handler)
 *   - app/api/payment/confirm/route.ts (post-confirm order mutation)
 *   - app/api/photos/upload/route.ts   (anon photo INSERT)
 *   - app/api/orders/* (guest order creation, status transitions)
 *   - supabase/functions/* (Edge Functions)
 *
 * Never imported by client code. `'server-only'` will fail the build if it
 * leaks into a client bundle.
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';

let cached: SupabaseClient | null = null;

export function getServiceRoleSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(env.publicSupabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
