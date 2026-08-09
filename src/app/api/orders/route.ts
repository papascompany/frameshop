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
import { getEffectiveTossClientKey } from '@/lib/env';
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

  // 결제 키 미구성이면 주문을 만들지 않는다 — 결제 불가 상태에서 주문만 생기면
  // 적립금 차감(031)·쿠폰 예약 등 부수효과만 남는 고아 주문이 된다.
  // 클라이언트 가드(CheckoutClient)와 이중화 — 직접 POST·키 회전 창 대비.
  if (!(await getEffectiveTossClientKey().catch(() => null))) {
    return NextResponse.json(
      {
        ok: false,
        code: 'PAYMENT_UNAVAILABLE',
        message: '결제 수단이 설정되지 않아 주문을 생성할 수 없습니다.',
      },
      { status: 503 },
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
  // Key by a TAMPER-PROOF identity only: the authenticated userId, the HttpOnly
  // guest cookie, or the client IP. The body sessionId (parsed.data.sessionId) is
  // attacker-rotatable, so it is EXCLUDED from the rate-limit key (Sec-2) — an
  // actor could otherwise mint a fresh sessionId per request to evade the throttle.
  // It is still forwarded to createOrder below for photo-ownership verification.
  const rateKey = userId ?? guestSidFromCookie ?? getClientIp(request);
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
    // FS-EC P0-001: forward the reward-points redeem and cash-receipt request.
    // Dropping these here made the server charge the FULL amount while the
    // checkout UI displayed the redeemed total (표시≠청구) and silently ignored
    // receipt requests. createOrder re-validates both server-side.
    redeemPoints: parsed.data.redeemPoints,
    receipt: parsed.data.receipt ?? null,
    // FS-X-01 (ADR-026): forward the coupon code — same P0-001 lesson as
    // redeemPoints/receipt above (dropping it here would silently charge the
    // undiscounted amount). createOrder re-validates + consumes atomically.
    couponCode: parsed.data.couponCode,
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
        // FS-EC P2-003: user-correctable failures, not server errors — a 500
        // here would pollute Sentry and hide the real cause from the client.
        : err.code === 'POINTS_UNAVAILABLE' ? 422
        : err.code === 'POINTS_INSUFFICIENT' ? 422
        : err.code === 'RECEIPT_UNAVAILABLE' ? 422
        // FS-X-01 (ADR-026): coupon rejections are user-correctable — 422.
        : err.code === 'COUPON_INVALID' ? 422
        : err.code === 'COUPON_EXHAUSTED' ? 422
        : err.code === 'COUPON_ALREADY_USED' ? 422
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
