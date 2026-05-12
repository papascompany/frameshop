/**
 * confirmPayment: server-side payment confirmation entry point.
 *
 * Flow (security-critical, see ADR + payment.md):
 *   1. Look up the order by orderId (== orderNo). If missing → ORDER_NOT_FOUND.
 *   2. If already PAID → ALREADY_PAID (idempotent).
 *   3. Compare `order.total_price === amount`. Mismatch → AMOUNT_MISMATCH,
 *      Toss confirm API is NOT called.
 *   4. Toss confirm API call (server secret key).
 *   5. On Toss success → transition the order to PAID + attach paymentKey.
 *
 * Never trust the client's `amount` — DB is the source of truth.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { OrderNo, PaymentKey } from '@/types/common';
import type { ConfirmPaymentInput, ConfirmResult } from '@/types/payment';
import { tossClient, TossApiError } from './toss';
import { getOrder, transitionTo } from '../db/order';

export async function confirmPayment(
  input: ConfirmPaymentInput,
): Promise<ConfirmResult> {
  const order = await getOrder(input.orderId as string);
  if (!order) {
    return { ok: false, code: 'ORDER_NOT_FOUND', message: 'Order not found' };
  }

  if (order.status === 'PAID') {
    return {
      ok: true,
      orderNo: order.orderNo,
      paymentKey: order.paymentId ?? input.paymentKey,
    };
  }

  if (order.totalPrice !== input.amount) {
    return {
      ok: false,
      code: 'AMOUNT_MISMATCH',
      message: `expected ${order.totalPrice}, got ${input.amount}`,
    };
  }

  // Call Toss confirm.
  try {
    await tossClient.confirm({
      paymentKey: input.paymentKey,
      orderId: input.orderId as string,
      amount: input.amount,
    });
  } catch (err) {
    if (err instanceof TossApiError) {
      return { ok: false, code: 'TOSS_REJECTED', message: err.message };
    }
    return {
      ok: false,
      code: 'INTERNAL',
      message: err instanceof Error ? err.message : 'unknown',
    };
  }

  await transitionTo(order.id, 'PAID', { paymentKey: input.paymentKey });

  return {
    ok: true,
    orderNo: asBrand<OrderNo>(input.orderId as string),
    paymentKey: input.paymentKey,
  };
}

// ---------- Webhook handler ----------

import { getServiceRoleSupabase } from '../supabase/service';
import type { WebhookEvent } from '@/types/payment';
import { TOSS_STATUS_TO_ORDER_STATUS } from '@/types/payment';

export async function handleWebhook(event: WebhookEvent): Promise<void> {
  const supabase = getServiceRoleSupabase();

  // Dedup on paymentKey UNIQUE.
  const { data: existing } = await supabase
    .from('payment_events')
    .select('id')
    .eq('payment_key', event.data.paymentKey)
    .maybeSingle();

  if (existing) {
    return; // already processed
  }

  const order = await getOrder(event.data.orderId as string);

  // Defense-in-depth: even with a valid signature, refuse to transition if
  // webhook-reported amount disagrees with the order's stored totalPrice.
  // Protects against WEBHOOK_SECRET leak or replay with mutated amount.
  const amountMatches =
    order != null && event.data.totalAmount === order.totalPrice;

  // payment_events.status is constrained to TossPaymentStatus values, so we
  // record the raw status here and surface the mismatch only in raw_payload.
  await supabase.from('payment_events').insert({
    payment_key: event.data.paymentKey,
    order_id: order?.id ?? null,
    order_no: event.data.orderId,
    status: event.data.status,
    raw_payload: order && !amountMatches
      ? { ...event, _frameshop: { amountMismatch: true, expected: order.totalPrice } }
      : event,
  });

  if (!order) return;

  // P1-01 fix: skip state transition on amount mismatch and alert.
  if (!amountMatches) {
    console.error(
      JSON.stringify({
        event: 'webhook_amount_mismatch',
        orderNo: event.data.orderId,
        paymentKey: event.data.paymentKey,
        expected: order.totalPrice,
        received: event.data.totalAmount,
      }),
    );
    return;
  }

  const target = TOSS_STATUS_TO_ORDER_STATUS[event.data.status];
  if (!target) return;
  if (order.status === target) return;

  try {
    await transitionTo(order.id, target, {
      paymentKey: event.data.paymentKey as PaymentKey,
    });
  } catch {
    // CANCELLED → PAID etc. are invalid; we already logged the raw payload.
  }
}
