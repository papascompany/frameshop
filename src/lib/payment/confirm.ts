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
import type { OrderWithItems } from '@/types/order';
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
    // Fallback render enqueue: the webhook owns rendering in this race, but its
    // transition/enqueue is best-effort (its errors are swallowed). If the order
    // is PAID, ensure renders are queued here too. createRenderJob is idempotent
    // (UNIQUE order_item_id + ignoreDuplicates), so this never double-renders.
    if (current?.status === 'PAID') {
      for (const item of current.items) {
        enqueuePrintRender(item.id);
      }
      // FS-EC-03: 현금영수증 발급 훅(내부에서 미신청/비현금성/기발급을 스스로
      // 거른다). fire-and-forget — 결제 플로우에 절대 영향 없음.
      void issueCashReceiptIfEligible(current, tossResp.method);
    }
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

  // FS-EC-03: 현금영수증 발급 훅 — 신청 주문 + 현금성 결제만. fire-and-forget,
  // 발급 실패는 로그만 남기고 결제 확정 결과에 영향을 주지 않는다.
  void issueCashReceiptIfEligible(order, tossResp.method);

  return {
    ok: true,
    orderNo: asBrand<OrderNo>(input.orderId as string),
    paymentKey: input.paymentKey,
  };
}

// ---------- Cash receipt hook (FS-EC-03, migration 039) ----------

/**
 * 현금영수증 발급 대상 결제수단(Toss confirm 응답 `method`). 카드 결제는
 * 매출전표가 증빙이라 제외 — 계좌이체/가상계좌 등 현금성 결제만 발급한다.
 * Toss v1 은 한글 라벨을 돌려주지만, 방어적으로 영문 enum 도 허용한다.
 */
const CASH_LIKE_METHODS: ReadonlySet<string> = new Set([
  '계좌이체',
  '가상계좌',
  'TRANSFER',
  'VIRTUAL_ACCOUNT',
]);

/** orders.receipt_type('income'|'proof') → Toss cash-receipts `type`. */
const RECEIPT_TYPE_TO_TOSS = {
  income: '소득공제',
  proof: '지출증빙',
} as const;

/** Toss cash-receipts `orderName` — 대표 상품명 + 나머지 건수 요약. */
function receiptOrderName(order: OrderWithItems): string {
  const first = order.items[0]?.snapshot.productName ?? '액자 주문';
  return order.items.length > 1
    ? `${first} 외 ${order.items.length - 1}건`
    : first;
}

/**
 * PAID 확정 직후 현금영수증 자동 발급 훅.
 *
 * 발급 조건(모두 충족 시에만 Toss 호출):
 *  - 주문 생성 시 현금영수증 신청(receipt_type + receipt_info 존재). 039
 *    미적용이면 mapOrder 가 null 로 폴백하므로 자연스럽게 스킵(graceful).
 *  - 아직 미발급(receipt_url/receipt_issued_at null) — 재확정 멱등성.
 *  - 결제수단이 현금성(CASH_LIKE_METHODS).
 *
 * 성공 시 receipt_url/receipt_issued_at 을 조건부 UPDATE(`receipt_issued_at IS
 * NULL` 가드 — 동시 발급 경합에서도 최초 기록을 덮어쓰지 않는다). 실패는
 * 구조화 로그만 남기고 절대 throw 하지 않는다(주문 흐름 무영향).
 */
export async function issueCashReceiptIfEligible(
  order: OrderWithItems,
  method: string | undefined,
): Promise<void> {
  if (!order.receiptType || !order.receiptInfo) return;
  if (order.receiptUrl || order.receiptIssuedAt) return;
  if (!method || !CASH_LIKE_METHODS.has(method)) return;

  try {
    const resp = await tossClient.issueCashReceipt({
      amount: order.totalPrice,
      orderId: order.orderNo as string,
      orderName: receiptOrderName(order),
      customerIdentityNumber: order.receiptInfo,
      type: RECEIPT_TYPE_TO_TOSS[order.receiptType],
    });

    const supabase = getServiceRoleSupabase();
    const { error } = await supabase
      .from('orders')
      .update({
        receipt_url: resp.receiptUrl ?? null,
        receipt_issued_at: new Date().toISOString(),
      })
      .eq('id', order.id as string)
      .is('receipt_issued_at', null);

    if (error) {
      // Toss 발급은 성공했으나 기록 실패 — 은폐하지 않고 수동 보정 근거를 남긴다.
      console.error(
        JSON.stringify({
          event: 'cash_receipt_update_failed',
          ctx: {
            orderNo: order.orderNo,
            receiptType: order.receiptType,
            message: error.message,
          },
        }),
      );
      return;
    }

    console.log(
      JSON.stringify({
        event: 'cash_receipt_issued',
        ctx: {
          orderNo: order.orderNo,
          receiptType: order.receiptType,
          method,
        },
      }),
    );
  } catch (err) {
    // 식별번호(receiptInfo)는 민감정보 — 로그에 남기지 않는다.
    console.error(
      JSON.stringify({
        event: 'cash_receipt_issue_failed',
        ctx: {
          orderNo: order.orderNo,
          receiptType: order.receiptType,
          method,
          message: err instanceof Error ? err.message : String(err),
        },
      }),
    );
  }
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
  } catch (err) {
    // An invalid transition (e.g. CANCELLED→PAID) is expected and benign — the
    // raw payload is already persisted. But a real failure (DB error/timeout)
    // here means the order may be stuck unrendered, so log it for ops/drains
    // instead of swallowing silently.
    console.error(
      JSON.stringify({
        event: 'webhook_transition_failed',
        orderNo: event.data.orderId,
        target,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
