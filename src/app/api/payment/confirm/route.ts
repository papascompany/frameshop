/**
 * POST /api/payment/confirm
 *
 * Body: ConfirmPaymentInput.
 * Returns ConfirmResult JSON.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { confirmPaymentInputSchema } from '@/types/payment';
import { asBrand } from '@/types/common';
import type { PaymentKey } from '@/types/common';
import { confirmPayment } from '@/lib/payment/confirm';

export async function POST(request: Request): Promise<Response> {
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

  const result = await confirmPayment({
    paymentKey: asBrand<PaymentKey>(parsed.data.paymentKey),
    orderId: parsed.data.orderId as unknown as ReturnType<typeof asBrand>,
    amount: parsed.data.amount,
  } as Parameters<typeof confirmPayment>[0]);

  const status = result.ok
    ? 200
    : result.code === 'AMOUNT_MISMATCH'
      ? 400
      : result.code === 'ORDER_NOT_FOUND'
        ? 404
        : 500;

  return NextResponse.json(result, { status });
}
