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
import type { ConfirmPaymentInput, ConfirmResult, WebhookEvent } from '@/types/payment';
import { TOSS_STATUS_TO_ORDER_STATUS } from '@/types/payment';
import { tossClient, TossApiError, type TossConfirmResponse } from './toss';
import { getOrder, transitionTo } from '../db/order';
import { enqueuePrintRender } from '../render/enqueue';
import { getServiceRoleSupabase } from '../supabase/service';
import { notifyNewOrder } from '../notify';

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
      alreadyPaid: true, // distinguishes idempotent re-confirm from fresh PAID
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

  // P1-03: Insert payment_events BEFORE transitioning order status.
  // Both confirmPayment and handleWebhook use payment_events.payment_key UNIQUE
  // as an atomic lock — whichever path inserts first proceeds with the transition;
  // the other path gets a UNIQUE conflict and short-circuits. Eliminates the
  // confirm↔webhook race and double-render.
  const supabaseSvc = getServiceRoleSupabase();
  const { error: peErr } = await supabaseSvc.from('payment_events').insert({
    payment_key: input.paymentKey as string,
    order_id: order.id as string,
    order_no: input.orderId as string,
    status: 'DONE',
    raw_payload: tossResp as unknown as Record<string, unknown>,
  });

  if (peErr) {
    // UNIQUE conflict: handleWebhook already processed this paymentKey.
    // Re-fetch current order state and return idempotent success.
    const current = await getOrder(input.orderId as string);
    return {
      ok: true,
      orderNo: current?.orderNo ?? order.orderNo,
      paymentKey: input.paymentKey,
    };
  }

  await transitionTo(order.id, 'PAID', { paymentKey: input.paymentKey });

  // ADR-005: kick off 300dpi print renders as soon as the order is paid.
  // Fire-and-forget — failures here must not bubble back to the buyer.
  // The full order (with items) was loaded above; reuse its items.
  for (const item of order.items) {
    enqueuePrintRender(item.id);
  }

  // 관리자 알림 (이메일 + Slack) — fire-and-forget, 실패해도 주문 플로우 무관.
  notifyNewOrder(order).catch((e: unknown) => {
    console.warn('[notify] notifyNewOrder 예외:', e);
  });

  return {
    ok: true,
    orderNo: asBrand<OrderNo>(input.orderId as string),
    paymentKey: input.paymentKey,
  };
}

// ---------- Webhook handler ----------

export async function handleWebhook(event: WebhookEvent): Promise<void> {
  const supabase = getServiceRoleSupabase();

  // P1-02: Reject replayed webhook events older than 10 minutes.
  const ageMs = Date.now() - new Date(event.createdAt).getTime();
  if (ageMs > 10 * 60_000) {
    console.warn(JSON.stringify({ event: 'webhook_too_old', ageMs, paymentKey: event.data.paymentKey }));
    return; // accept HTTP 200 to Toss but do nothing
  }

  const order = await getOrder(event.data.orderId as string);

  // Defense-in-depth: even with a valid signature, refuse to transition if
  // webhook-reported amount disagrees with the order's stored totalPrice.
  // Protects against WEBHOOK_SECRET leak or replay with mutated amount.
  const amountMatches =
    order != null && event.data.totalAmount === order.totalPrice;

  // P1-03: Insert payment_events atomically — UNIQUE(payment_key) is the lock.
  // If confirmPayment already inserted this paymentKey, this insert returns an
  // error → we short-circuit without transitioning order status or enqueuing renders.
  const { error: peErr } = await supabase.from('payment_events').insert({
    payment_key: event.data.paymentKey,
    order_id: order?.id ?? null,
    order_no: event.data.orderId,
    status: event.data.status,
    raw_payload: order && !amountMatches
      ? { ...event, _frameshop: { amountMismatch: true, expected: order.totalPrice } }
      : event,
  });

  if (peErr) {
    // UNIQUE conflict: confirmPayment already processed this payment. No-op.
    return;
  }

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
      // 관리자 알림 — fire-and-forget.
      notifyNewOrder(order).catch((e: unknown) => {
        console.warn('[notify] webhook notifyNewOrder 예외:', e);
      });
    }
  } catch {
    // CANCELLED → PAID etc. are invalid; we already logged the raw payload.
  }
}
