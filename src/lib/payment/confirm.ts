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
 *
 * Callers: the /payment/success server render (primary — runs the moment the
 * buyer's browser lands back from Toss, no client JS needed), the
 * /api/payment/confirm retry button, and the payment-sweep cron backstop.
 */

import 'server-only';
import type { PaymentKey } from '@/types/common';
import type { ConfirmPaymentInput, ConfirmResult } from '@/types/payment';
import type { OrderWithItems } from '@/types/order';
import { tossClient, TossApiError, type TossConfirmResponse } from './toss';
import { getOrder, transitionIfStatus, transitionTo } from '../db/order';
import { consumeCouponByCode } from '../db/coupons';
import { enqueuePrintRender } from '../render/enqueue';
import { getServiceRoleSupabase } from '../supabase/service';
import { notifyNewOrder } from '../notify';

export type ConfirmOptions = {
  /**
   * 결제 백스톱 스윕 전용. payment_events 락은 이미 있는데 주문이 아직 CREATED 면
   * 락을 잡은 경로가 PAID 전이 전에 죽은 것이다(Toss 는 승인 완료 = 돈은 이미 받음).
   * true 면 CAS(CREATED→PAID)로 넘겨받아 쿠폰 소비·렌더·알림까지 마무리한다.
   * 라이브 경로(성공 페이지·재시도 버튼)는 락 소유자가 아직 진행 중일 수 있어 쓰지 않는다.
   */
  takeOverStaleLock?: boolean;
};

/** Toss: 이미 승인된 결제에 승인 API 를 다시 호출하면 400 ALREADY_PROCESSED_PAYMENT. */
const ALREADY_PROCESSED = 'ALREADY_PROCESSED_PAYMENT';

export async function confirmPayment(
  input: ConfirmPaymentInput,
  opts: ConfirmOptions = {},
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
  // true when Toss had already approved this paymentKey and we adopted its
  // current state via GET instead of a fresh approval.
  let recovered = false;
  try {
    tossResp = await tossClient.confirm({
      paymentKey: input.paymentKey,
      orderId: input.orderId as string,
      amount: input.amount,
    });
  } catch (err) {
    if (err instanceof TossApiError && err.code === ALREADY_PROCESSED) {
      // The server-side confirm on /payment/success, a retry-button click and
      // the sweep can all race on one paymentKey; only the first approval
      // succeeds. Adopt Toss's view of the already-approved payment and run it
      // through the same validation + payment_events lock below, so every
      // caller converges on PAID instead of the loser showing a failure.
      try {
        tossResp = await tossClient.getPayment(input.paymentKey);
        recovered = true;
      } catch (lookupErr) {
        return {
          ok: false,
          code: 'TOSS_REJECTED',
          message:
            lookupErr instanceof Error ? lookupErr.message : err.message,
        };
      }
    } else if (err instanceof TossApiError) {
      return { ok: false, code: 'TOSS_REJECTED', message: err.message };
    } else {
      return {
        ok: false,
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'unknown',
      };
    }
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
    // Never on the recovered path: that payment was approved by an earlier
    // call — possibly for a DIFFERENT, legitimately paid order whose
    // paymentKey is being replayed here. Cancelling it would refund that order.
    if (!recovered) {
      try {
        await tossClient.cancel({
          paymentKey: input.paymentKey,
          cancelReason: 'Payment response mismatch — internal security check',
        });
      } catch {
        // Cancellation failure is logged at Toss's end; we still refuse to confirm.
      }
    }
    console.error(
      JSON.stringify({
        event: 'payment_response_mismatch',
        recovered,
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

  return settleApprovedPayment(order, input.paymentKey, tossResp, opts);
}

/**
 * Takes the payment_events DONE lock for a payment Toss reports as approved
 * and moves the order to PAID exactly once. The caller must already have
 * validated `tossResp` against the order (orderId, totalAmount, status DONE).
 * Shared by confirmPayment and the webhook so the PAID side effects — coupon
 * consume included — are identical whichever path wins the lock.
 */
export async function settleApprovedPayment(
  order: OrderWithItems,
  paymentKey: PaymentKey,
  tossResp: TossConfirmResponse,
  opts: ConfirmOptions = {},
): Promise<ConfirmResult> {
  // P1-03: Insert payment_events BEFORE transitioning order status.
  // confirmPayment and the webhook both come through here and use
  // payment_events.payment_key UNIQUE as an atomic lock — whichever inserts
  // first proceeds with the transition; the other gets a UNIQUE conflict and
  // short-circuits. Eliminates the confirm↔webhook race and double-render.
  const supabaseSvc = getServiceRoleSupabase();
  const { error: peErr } = await supabaseSvc.from('payment_events').insert({
    payment_key: paymentKey as string,
    order_id: order.id as string,
    order_no: order.orderNo as string,
    status: 'DONE',
    raw_payload: tossResp as unknown as Record<string, unknown>,
  });

  if (peErr) {
    // UNIQUE conflict: the other path already owns this paymentKey.
    // Re-fetch current order state and return idempotent success.
    const current = await getOrder(order.orderNo as string);

    // Sweep backstop: the lock exists but the order never left CREATED, so the
    // lock owner died between its insert and the PAID transition while Toss
    // holds an approved (charged) payment. Take over via CAS so concurrent
    // sweeps settle the order exactly once.
    if (opts.takeOverStaleLock && current?.status === 'CREATED') {
      const won = await transitionIfStatus(current.id, 'CREATED', 'PAID', {
        paymentKey,
      });
      if (won) {
        console.warn(
          JSON.stringify({
            event: 'payment_stale_lock_takeover',
            orderNo: current.orderNo,
            paymentKey,
          }),
        );
        await settlePaidOrder(current, tossResp);
      }
      return { ok: true, orderNo: current.orderNo, paymentKey };
    }

    // Fallback render enqueue: the lock owner enqueues renders after its PAID
    // transition, but its fire-and-forget enqueue can be lost. If the order is
    // PAID, ensure renders are queued here too. createRenderJob is idempotent
    // (UNIQUE order_item_id + ignoreDuplicates), so this never double-renders.
    if (current?.status === 'PAID') {
      for (const item of current.items) {
        enqueuePrintRender(item.id);
      }
      // FS-EC-03: 현금영수증 발급 훅(내부에서 미신청/비현금성/기발급을 스스로
      // 거른다). fire-and-forget — 결제 플로우에 절대 영향 없음.
      void issueCashReceiptIfEligible(current, tossResp.method);
    }
    return { ok: true, orderNo: current?.orderNo ?? order.orderNo, paymentKey };
  }

  await transitionTo(order.id, 'PAID', { paymentKey });
  await settlePaidOrder(order, tossResp);

  return { ok: true, orderNo: order.orderNo, paymentKey };
}

/**
 * Side effects owed exactly once when an order becomes PAID: coupon consume,
 * print renders, admin notification, cash receipt. Callers must own the
 * PAID transition (payment_events lock + transitionTo, or the sweep's CAS).
 */
async function settlePaidOrder(
  order: OrderWithItems,
  tossResp: TossConfirmResponse,
): Promise<void> {
  // FS-X-FIX-A P1-2: consume the coupon at PAID, not at order creation. createOrder
  // only RESERVED the discount (orders.coupon_code snapshot); consuming here means a
  // failed/abandoned payment never burns a member's one-per-user coupon. This runs
  // only for the caller that owns the PAID transition (see doc above), so a
  // confirm retry short-circuits at the dedup branch and never re-consumes;
  // member re-use is additionally blocked by coupon_redemptions UNIQUE, and a guest's
  // used_count cannot double-increment because a second confirm never reaches here.
  // Fail-open: a consume failure after a successful charge keeps the paid order (the
  // customer already paid the discounted total) and only logs — under-counting
  // used_count is the safe direction per ADR-026. NOTE: Toss keys are placeholders,
  // so this path is logic/test-verified only; a real-payment smoke test is still
  // required (ADR-026 Postscript).
  if (order.couponCode) {
    const consumed = await consumeCouponByCode(
      order.couponCode,
      order.userId,
      order.orderNo,
    );
    if (!consumed.ok) {
      console.error(
        JSON.stringify({
          event: 'coupon_consume_after_paid_failed',
          orderNo: order.orderNo,
          errorCode: consumed.errorCode,
        }),
      );
    }
  }

  // ADR-005: kick off 300dpi print renders as soon as the order is paid.
  // Fire-and-forget — failures here must not bubble back to the buyer.
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
