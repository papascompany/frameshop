/**
 * /api/account/addresses — 회원 배송지 주소록 (Phase B-1).
 *  GET   → list the current user's saved addresses (default first, then newest).
 *  POST  → create one (body validated with addressInputSchema).
 *
 * Auth is required for both: the DB layer (service-role) BYPASSES RLS, so every
 * query is scoped by the verified session user_id — never a client-supplied id.
 * Mutating POST is additionally gated by the same-origin guard + a per-user
 * write throttle, mirroring the cart routes.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { addressInputSchema } from '@/types/address';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { createAddress, listAddresses } from '@/lib/db/addresses';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

async function getUserId(): Promise<UserId | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ? asBrand<UserId>(data.user.id) : null;
}

export async function GET(): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const { data, error } = await listAddresses(userId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, addresses: data });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const rate = await checkRate('address_write', userId as string, { max: 30, windowMs: 60_000 });
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
  const parsed = addressInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 422 },
    );
  }
  const { data, error } = await createAddress(userId, parsed.data);
  if (error || !data) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, address: data }, { status: 201 });
}
