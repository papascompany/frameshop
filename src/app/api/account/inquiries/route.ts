/**
 * /api/account/inquiries — 회원 1:1 문의 (FS-X-02, ADR-026).
 *  GET  → { ok, available, inquiries } — 내 문의 목록(최신순).
 *  POST → 문의 작성(body 는 inquiryInputSchema — contactEmail 은 검증된 세션
 *         이메일로 서버가 확정한다: 입력값 무시, 타인 이메일 사칭 차단).
 *
 * Auth is required for both: the DB layer (service-role) BYPASSES RLS, so every
 * query is scoped by the verified session user_id — never a client-supplied id.
 * Mutating POST is additionally gated by the same-origin guard + a per-user
 * write throttle(5/hour — 스팸 문의 억제), mirroring the addresses routes.
 *
 * graceful 계약: migration 040 미적용이면 GET 은 200 { available:false,
 * inquiries:[] }, POST 는 503 UNAVAILABLE — 42P01 이 클라로 새지 않는다.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { inquiryInputSchema } from '@/types/inquiry';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import {
  createInquiry,
  INQUIRIES_UNAVAILABLE,
  listMyInquiries,
} from '@/lib/db/inquiries';
import { isInquiriesAvailable } from '@/lib/db/feature-probe';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

type SessionUser = { userId: UserId; email: string | null };

async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) return null;
  return {
    userId: asBrand<UserId>(data.user.id),
    email: data.user.email ?? null,
  };
}

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const available = await isInquiriesAvailable().catch(() => false);
  if (!available) {
    return NextResponse.json({ ok: true, available: false, inquiries: [] });
  }

  const { data, error } = await listMyInquiries(user.userId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, available: true, inquiries: data });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const rate = await checkRate('inquiry_write', user.userId as string, {
    max: 5,
    windowMs: 3_600_000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_JSON' }, { status: 400 });
  }

  // contact_email 회원 강제(Sec P2): 로그인 회원의 문의 연락처는 검증된 세션
  // 이메일로 서버가 확정한다 — 입력값은 무시하여 타인 이메일 사칭을 차단한다.
  // 세션에 이메일이 없는 예외적 계정만 입력값으로 폴백하고, 둘 다 없으면 422.
  const candidate =
    typeof body === 'object' && body !== null
      ? {
          ...(body as Record<string, unknown>),
          contactEmail:
            user.email ?? (body as Record<string, unknown>).contactEmail ?? undefined,
        }
      : body;

  const parsed = inquiryInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 422 },
    );
  }

  const { data, error } = await createInquiry(user.userId, parsed.data);
  if (error || !data) {
    if (error === INQUIRIES_UNAVAILABLE) {
      return NextResponse.json({ ok: false, code: 'UNAVAILABLE' }, { status: 503 });
    }
    if (error === 'REF_NOT_FOUND') {
      return NextResponse.json({ ok: false, code: 'BAD_INPUT' }, { status: 422 });
    }
    return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inquiry: data }, { status: 201 });
}
