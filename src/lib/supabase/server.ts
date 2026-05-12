/**
 * Server-side Supabase client (RLS enforced via end-user JWT).
 *
 * Use in: Server Components, Server Actions, Route Handlers that act on
 * behalf of the user. NOT for service-role operations — see `service.ts`.
 *
 * Next.js 16: `cookies()` returns a Promise.
 */

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '../env';

export async function getServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(env.publicSupabaseUrl(), env.publicSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options as CookieOptions);
          }
        } catch {
          // Server Components cannot mutate cookies — Supabase will retry from
          // middleware. This catch is documented in the SSR docs.
        }
      },
    },
  });
}
