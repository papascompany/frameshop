/**
 * POST /api/payment/confirm
 *
 * Body: ConfirmPaymentInput.
 * Returns ConfirmResult JSON.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { confirmPaymentInputSchema, type ConfirmPaymentInput } from '@/types/payment';
import { asBrand } from '@/types/common';
import type { OrderNo, PaymentKey } from '@/types/common';
import { confirmPayment } from '@/lib/payment/confirm';
import { isSameOrigin } from '@/lib/security/same-origin';

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
      { ok: false, code: 'BAD_JSON', message: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const parsed = confirmPaymentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 400 },
    );
  }

  // Explicit branded-ID mapping at the IO boundary (P2-01). The Zod schema
  // already enforces the `YYYYMMDD-NNNN` shape on `orderId` and a non-empty
  // string on `paymentKey`, so casting via `asBrand` is the single chokepoint.
  const input: ConfirmPaymentInput = {
    paymentKey: asBrand<PaymentKey>(parsed.data.paymentKey),
    orderId: asBrand<OrderNo>(parsed.data.orderId),
    amount: parsed.data.amount,
  };

  const result = await confirmPayment(input);

  const status = result.ok
    ? 200
    : result.code === 'AMOUNT_MISMATCH'
      ? 400
      : result.code === 'ORDER_NOT_FOUND'
        ? 404
        : 500;

  return NextResponse.json(result, { status });
}
