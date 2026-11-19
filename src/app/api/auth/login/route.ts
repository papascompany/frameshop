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
import { claimGuestOrdersByEmail } from '@/lib/db/order';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';

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
  const rl = await checkLoginRate(email);
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
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Do NOT reset the bucket on failure — allow the counter to accumulate.
    console.warn(
      JSON.stringify({
        event: 'login_failed',
        domain: email.split('@')[1],
        code: error.status,
        authCode: error.code ?? null,
      }),
    );
    return loginFailureResponse(error);
  }

  // Reset rate limit bucket on successful login.
  await resetLoginRate(email);
  console.info(JSON.stringify({ event: 'login_success', domain: email.split('@')[1] }));

  // Link any guest orders placed with this email to the account so they show
  // up in /account/orders. Best-effort — must not block login.
  // SECURITY (P1-7): only when Supabase says the account's OWN email is
  // confirmed, and only with that email — never the typed one. A password
  // login alone does not prove mailbox ownership if "Confirm email" is off,
  // which would let anyone register a victim's address and pull in their
  // guest orders (addresses, phone numbers).
  const verifiedEmail = confirmedAccountEmail(data.user);
  if (data.user?.id && verifiedEmail) {
    const claimed = await claimGuestOrdersByEmail(
      asBrand<UserId>(data.user.id),
      verifiedEmail,
    );
    if (claimed > 0) {
      console.info(JSON.stringify({ event: 'guest_orders_claimed', count: claimed }));
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

type AuthErrorFields = { status?: number; code?: string };

/**
 * Supabase Auth 오류 → 사용자 문구(한국어). 원문(영어)은 응답에 싣지 않는다.
 *  - email_not_confirmed: 비밀번호는 맞지만 메일 인증 전(Confirm email 켜짐) — 안내가 다르다.
 *    비밀번호가 맞을 때만 나오는 코드라 계정 존재 여부를 새로 드러내지 않는다.
 *  - 그 외 4xx(invalid_credentials 등): 이메일·비밀번호 불일치로 묶는다(계정 존재 비노출).
 *  - 5xx·요청 한도: 일시 오류 — 자격 증명 탓으로 안내하지 않는다.
 */
function loginFailureResponse(error: AuthErrorFields): NextResponse {
  if (error.code === 'email_not_confirmed') {
    return NextResponse.json(
      {
        ok: false,
        code: 'EMAIL_NOT_CONFIRMED',
        message: '이메일 인증이 아직 완료되지 않았습니다. 받은 인증 메일의 링크를 눌러 인증한 뒤 다시 로그인해주세요.',
      },
      { status: 401 },
    );
  }
  if ((error.status ?? 0) >= 500 || error.code === 'over_request_rate_limit') {
    return NextResponse.json(
      {
        ok: false,
        code: 'AUTH_UNAVAILABLE',
        message: '로그인 처리 중 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { ok: false, code: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' },
    { status: 401 },
  );
}

type AuthUserEmailFields = {
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
};

/** The account's own email when Supabase has confirmed it; otherwise null. */
function confirmedAccountEmail(user: AuthUserEmailFields | null | undefined): string | null {
  if (!user?.email) return null;
  return user.email_confirmed_at || user.confirmed_at ? user.email : null;
}
