import 'server-only';
import { NextResponse } from 'next/server';
import { asBrand } from '@/types/common';
import type { LocalId, UserId } from '@/types/common';
import { CART_QUANTITY_MAX, CART_QUANTITY_MIN } from '@/types/cart';
import { removeCartItem, updateCartQuantity } from '@/lib/db/cart';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

async function getUserId(): Promise<UserId | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ? asBrand<UserId>(data.user.id) : null;
}

/** Per-user cart-mutation throttle (shared by PATCH/DELETE). null = allowed. */
async function cartRateLimited(userId: UserId): Promise<Response | null> {
  const rate = await checkRate('cart_write', userId as string, { max: 60, windowMs: 60_000 });
  if (rate.ok) return null;
  return NextResponse.json(
    { ok: false, code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ localId: string }> },
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
  const limited = await cartRateLimited(userId);
  if (limited) return limited;
  const { localId } = await context.params;
  let body: { quantity?: number };
  try {
    body = (await request.json()) as { quantity?: number };
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_JSON' }, { status: 400 });
  }
  const qty = body.quantity;
  if (typeof qty !== 'number' || qty < CART_QUANTITY_MIN || qty > CART_QUANTITY_MAX) {
    return NextResponse.json({ ok: false, code: 'BAD_INPUT' }, { status: 422 });
  }
  await updateCartQuantity(userId, asBrand<LocalId>(localId), qty);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ localId: string }> },
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
  const limited = await cartRateLimited(userId);
  if (limited) return limited;
  const { localId } = await context.params;
  await removeCartItem(userId, asBrand<LocalId>(localId));
  return NextResponse.json({ ok: true });
}
