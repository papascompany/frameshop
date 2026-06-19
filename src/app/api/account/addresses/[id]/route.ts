/**
 * /api/account/addresses/[id] — single saved address (Phase B-1).
 *  PATCH  → update; an `isDefault: true` in the body promotes this address to
 *           the user's default (the DB layer clears any prior default first).
 *  DELETE → remove the address.
 *
 * Both require an authenticated session + same-origin. The DB layer matches on
 * (id, user_id), so a caller can never touch another user's address even by
 * guessing the id — a non-owned id resolves to NOT_FOUND, not a leak.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { addressInputSchema } from '@/types/address';
import type { UserAddressId } from '@/types/address';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { deleteAddress, updateAddress } from '@/lib/db/addresses';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

async function getUserId(): Promise<UserId | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ? asBrand<UserId>(data.user.id) : null;
}

/**
 * UserAddressId uses its own brand (not the common `Brand`), so `asBrand` can't
 * widen to it. Cast the route segment string at this IO boundary; the DB layer
 * still re-scopes by (id, user_id), so a forged id can never escape ownership.
 */
function asAddressId(id: string): UserAddressId {
  return id as UserAddressId;
}

/** Per-user address-mutation throttle (shared by PATCH/DELETE). null = allowed. */
async function addressRateLimited(userId: UserId): Promise<Response | null> {
  const rate = await checkRate('address_write', userId as string, { max: 30, windowMs: 60_000 });
  if (rate.ok) return null;
  return NextResponse.json(
    { ok: false, code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
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
  const limited = await addressRateLimited(userId);
  if (limited) return limited;

  const { id } = await context.params;
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
  const { data, error } = await updateAddress(userId, asAddressId(id), parsed.data);
  if (error || !data) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, address: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
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
  const limited = await addressRateLimited(userId);
  if (limited) return limited;

  const { id } = await context.params;
  const { error } = await deleteAddress(userId, asAddressId(id));
  if (error) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
