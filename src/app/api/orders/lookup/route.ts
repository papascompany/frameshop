/**
 * POST /api/orders/lookup — Guest order lookup by orderNo + phone.
 *
 * P2-08: Rate-limited to prevent phone enumeration against known order numbers.
 * (orderNo is a sequential daily counter — YYYYMMDD-NNNN — and is therefore
 * predictable; without rate limiting an attacker could brute-force phone numbers.)
 *
 * Rate limit: 10 attempts per 15 minutes per IP.
 * Auth: none (guest-accessible by design).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { findOrderByGuest } from '@/lib/db/order';
import { checkLookupRate } from '@/lib/lookup-ratelimit';
import { asBrand } from '@/types/common';
import type { OrderNo } from '@/types/common';

const lookupSchema = z.object({
  orderNo: z
    .string()
    .regex(/^\d{8}-\d{4}$/, '주문번호 형식이 올바르지 않습니다. 예: 20260512-0001'),
  phone: z
    .string()
    .regex(/^01[0-9]-\d{3,4}-\d{4}$/, '전화번호 형식이 올바르지 않습니다.'),
});

/** Extract caller IP from Vercel's x-forwarded-for or fallback. */
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Rate limit check (by IP).
  const ip = getClientIp(req);
  const rateResult = checkLookupRate(ip);
  if (!rateResult.ok) {
    return NextResponse.json(
      { error: '너무 많은 조회 요청입니다. 잠시 후 다시 시도해 주세요.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateResult.retryAfterSec) },
      },
    );
  }

  // Parse body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const parsed = lookupSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { orderNo, phone } = parsed.data;

  // Constant-time-ish: always perform the DB query regardless of format,
  // so response time doesn't reveal "orderNo exists" from format rejection.
  const order = await findOrderByGuest(asBrand<OrderNo>(orderNo), phone).catch(() => null);

  if (!order) {
    // Do NOT distinguish "order not found" from "phone mismatch" — both return 404.
    return NextResponse.json(
      { error: '주문을 찾을 수 없습니다. 주문번호와 전화번호를 확인해 주세요.' },
      { status: 404 },
    );
  }

  // Return only fields safe for guest display (no internal IDs, payment keys, etc.).
  return NextResponse.json({
    orderNo: order.orderNo,
    status: order.status,
    createdAt: order.createdAt,
    orderer: { name: order.orderer.name },
    shipping: {
      name: order.shipping.name,
      zip: order.shipping.zip,
      addr1: order.shipping.addr1,
      addr2: order.shipping.addr2,
    },
    totalPrice: order.totalPrice,
    shippingFee: order.shippingFee,
    trackingNumber: order.trackingNumber ?? null,
    courier: order.courier ?? null,
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.snapshot.productName,
      sizeLabel: item.snapshot.sizeLabel,
      colorLabel: item.snapshot.colorLabel,
      quantity: item.quantity,
      price: item.price,
    })),
  });
}
