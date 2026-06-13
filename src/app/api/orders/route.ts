/**
 * POST /api/orders — createOrder bridge.
 *
 * Body:
 *   {
 *     cartItems: CartItem[],
 *     orderer, shipping, shippingMethod,
 *     clientShippingFee?: number,
 *   }
 *
 * Returns: { ok: true, order } | { ok: false, code, message }.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cartItemSchema } from '@/types/cart';
import {
  createOrderInputSchema,
  CreateOrderError,
  type CreateOrderInput,
} from '@/types/order';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { createOrder } from '@/lib/db/order';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';
import { getClientIp } from '@/lib/security/client-ip';
import { z } from 'zod';

const GUEST_COOKIE_NAME = 'fs-guest-sid';

const bodySchema = z.object({
  cartItems: z.array(cartItemSchema).min(1),
}).and(createOrderInputSchema);

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
    return NextResponse.json(
      { ok: false, code: 'BAD_JSON' },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 422 },
    );
  }

  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  // Read the HttpOnly guest session cookie (set by middleware for anon users).
  // Falls back to sessionId in the request body (for clients that send it explicitly).
  const cookieStore = await cookies();
  const guestSidFromCookie = cookieStore.get(GUEST_COOKIE_NAME)?.value ?? null;
  const sessionId = guestSidFromCookie ?? parsed.data.sessionId ?? null;

  // Throttle order creation (each order fans out to DB inserts + render jobs).
  // Key by the most specific identity available so one actor can't flood.
  const rateKey = userId ?? sessionId ?? getClientIp(request);
  const orderRate = await checkRate('order_create', rateKey, { max: 10, windowMs: 60_000 });
  if (!orderRate.ok) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', message: '주문 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429, headers: { 'Retry-After': String(orderRate.retryAfterSec) } },
    );
  }

  const input: CreateOrderInput = {
    cartItems: parsed.data.cartItems as unknown as CreateOrderInput['cartItems'],
    orderer: parsed.data.orderer,
    shipping: parsed.data.shipping,
    shippingMethod: parsed.data.shippingMethod,
    clientShippingFee: parsed.data.clientShippingFee,
    userId: userId
      ? asBrand<UserId>(userId)
      : parsed.data.userId
        ? asBrand<UserId>(parsed.data.userId)
        : null,
    // P0-03: Forward sessionId for anonymous photo-ownership verification.
    // Prefer the HttpOnly cookie value (tamper-proof) over the body value.
    sessionId,
  };

  try {
    const order = await createOrder(input);
    return NextResponse.json({ ok: true, order }, { status: 200 });
  } catch (err) {
    if (err instanceof CreateOrderError) {
      const status = err.code === 'EMPTY_CART' ? 400
        : err.code === 'INVALID_VARIANT' ? 422
        : err.code === 'INVALID_SHIPPING_METHOD' ? 422
        : err.code === 'SHIPPING_FEE_MISMATCH' ? 422
        : err.code === 'PRICE_MISMATCH' ? 422
        : err.code === 'PHOTO_OWNERSHIP' ? 403
        : 500;
      return NextResponse.json(
        { ok: false, code: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
