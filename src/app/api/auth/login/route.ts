/**
 * POST /api/auth/login
 *
 * Server-side login proxy. Adds per-email rate limiting (5 attempts / 15 min)
 * before forwarding credentials to Supabase. LoginClient.tsx should call this
 * instead of supabase.auth.signInWithPassword directly.
 *
 * Body: { email: string; password: string }
 * Returns: { ok: true } | { ok: false; code; message }
 *
 * On success the Supabase SSR cookies are set by createServerClient —
 * calling window.location.assign() from the client is still required to
 * trigger a cookie-aware navigation.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkLoginRate, resetLoginRate } from '@/lib/login-ratelimit';
import { getServerSupabase } from '@/lib/supabase/server';

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;

  // Rate limit check BEFORE touching Supabase auth.
  const rl = checkLoginRate(email);
  if (!rl.ok) {
    console.warn(JSON.stringify({ event: 'login_rate_limited', email: email.split('@')[1] }));
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      },
    );
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Do NOT reset the bucket on failure — allow the counter to accumulate.
    console.warn(JSON.stringify({ event: 'login_failed', domain: email.split('@')[1], code: error.status }));
    return NextResponse.json(
      { ok: false, code: 'INVALID_CREDENTIALS', message: error.message },
      { status: 401 },
    );
  }

  // Reset rate limit bucket on successful login.
  resetLoginRate(email);
  console.info(JSON.stringify({ event: 'login_success', domain: email.split('@')[1] }));

  return NextResponse.json({ ok: true }, { status: 200 });
}
