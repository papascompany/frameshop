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
import { tossClient, TossApiError, type TossConfirmResponse } from './toss';
import { getOrder, transitionTo } from '../db/order';
import { enqueuePrintRender } from '../render/enqueue';

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
  let tossResp: TossConfirmResponse;
  try {
    tossResp = await tossClient.confirm({
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

  // P0-01: Validate every field in the Toss response against our stored order.
  // Prevents paymentKey-swap attacks where a paymentKey from a cheap order is
  // replayed against an expensive order. Toss returns its own view of the
  // transaction — if it disagrees with what we sent, something is wrong.
  if (
    tossResp.orderId !== (input.orderId as string) ||
    tossResp.totalAmount !== input.amount ||
    tossResp.status !== 'DONE'
  ) {
    // Best-effort cancel — Toss may reject if the payment is already in a
    // non-cancellable state, but we must never mark the order as PAID.
    try {
      await tossClient.cancel({
        paymentKey: input.paymentKey,
        cancelReason: 'Payment response mismatch — internal security check',
      });
    } catch {
      // Cancellation failure is logged at Toss's end; we still refuse to confirm.
    }
    console.error(
      JSON.stringify({
        event: 'payment_response_mismatch',
        orderId: input.orderId,
        expected: { orderId: input.orderId, amount: input.amount, status: 'DONE' },
        received: {
          orderId: tossResp.orderId,
          amount: tossResp.totalAmount,
          status: tossResp.status,
        },
      }),
    );
    return {
      ok: false,
      code: 'TOSS_REJECTED',
      message: 'Payment response mismatch',
    };
  }

  await transitionTo(order.id, 'PAID', { paymentKey: input.paymentKey });

  // ADR-005: kick off 300dpi print renders as soon as the order is paid.
  // Fire-and-forget — failures here must not bubble back to the buyer.
  // The full order (with items) was loaded above; reuse its items.
  for (const item of order.items) {
    enqueuePrintRender(item.id);
  }

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
    // Mirror confirmPayment's fire-and-forget render enqueue on PAID. The
    // webhook arrives independently from the confirm route, so we re-enqueue
    // here too; renderOrderItemPrint is idempotent (no-op if already
    // rendered).
    if (target === 'PAID') {
      for (const item of order.items) {
        enqueuePrintRender(item.id);
      }
    }
  } catch {
    // CANCELLED → PAID etc. are invalid; we already logged the raw payload.
  }
}
