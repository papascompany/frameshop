/**
 * Browser Supabase client (singleton).
 *
 * Safe to import from client components. Uses the public anon key.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { envPublic } from '../env-public';

let cached: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createBrowserClient(
    envPublic.supabaseUrl(),
    envPublic.supabaseAnonKey(),
  );
  return cached;
}
