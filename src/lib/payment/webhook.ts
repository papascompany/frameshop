/**
 * Toss 결제 웹훅(PAYMENT_STATUS_CHANGED) 처리.
 *
 * 웹훅 본문은 "이 paymentKey 의 상태가 바뀌었다"는 신호로만 쓴다. 상태 반영의 근거는
 * 항상 우리 시크릿 키로 다시 조회한 Toss 결제(GET /v1/payments/{paymentKey})다 —
 * 위조·재전송·순서 뒤바뀐 웹훅이 와도 현재 Toss 의 진실만 반영되므로 서명에 의존하지
 * 않는다(서명은 라우트에서 오면 추가로 검증).
 *
 * 조회한 상태별 처리:
 *  - DONE             : 주문이 CREATED 면 confirm 과 같은 settleApprovedPayment 로 PAID 정산
 *                       (payment_events DONE 락 공유 → 쿠폰 소비 포함 부수효과가 경로와 무관하게 1회).
 *  - CANCELED         : Toss 쪽(대시보드 등)에서 전액 취소됨 → 주문을 CANCELLED(배송 완료면
 *                       REFUNDED)로 CAS 전이 + 적립금 복원 + (PAID 이후였으면) 쿠폰 복원.
 *                       고객 알림은 보내지 않는다.
 *  - PARTIAL_CANCELED : Toss 누적 취소액이 우리 refunded_amount 보다 크면 수동 보정 대상으로 로그.
 *  - 그 외            : 기록만.
 *
 * 우리 관리자 취소·환불은 Toss 취소 API 호출 직후 스스로 주문을 전이하는데, 그 취소도
 * 웹훅으로 다시 들어온다. 웹훅이 먼저 처리하면 관리자 흐름이 전이 오류를 내고 부수효과가
 * 엇갈리므로, 마지막 취소가 EXTERNAL_CANCEL_GRACE_MS 이내면 503 으로 미뤄 Toss 재전송
 * (1분 뒤)을 받는다. 그때는 관리자 흐름이 끝나 있어 웹훅은 무동작이 된다.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { PaymentKey } from '@/types/common';
import type { OrderStatus, OrderWithItems } from '@/types/order';
import { canTransition } from '../order/state';
import { getOrder, transitionIfStatus } from '../db/order';
import { releaseCouponByOrder } from '../db/coupons';
import { reversePointsForOrder } from '../db/points';
import { isWebhookAuditAvailable } from '../db/feature-probe';
import { getServiceRoleSupabase } from '../supabase/service';
import { settleApprovedPayment } from './confirm';
import { tossClient, TossApiError, type TossConfirmResponse } from './toss';

/** 우리 관리자 취소·환불 흐름이 먼저 전이를 끝내도록 주는 유예. */
export const EXTERNAL_CANCEL_GRACE_MS = 30_000;

export type WebhookOutcome =
  | 'payment_not_found'
  | 'order_not_found'
  | 'amount_mismatch'
  | 'settled_paid'
  | 'already_paid'
  | 'paid_order_inactive'
  | 'cancel_applied'
  | 'cancel_noop'
  | 'cancel_deferred'
  | 'cancel_manual'
  | 'partial_cancel_manual'
  | 'recorded'
  | 'retry';

export type WebhookResult = {
  /** 200 = 처리 끝(재전송 불필요), 503 = Toss 재전송으로 다시 받아야 함. */
  httpStatus: 200 | 503;
  outcome: WebhookOutcome;
  tossStatus: string | null;
  orderNo: string | null;
  detail?: string;
};

export type WebhookDelivery = {
  eventType: string;
  paymentKey: string;
  rawPayload: unknown;
  transmissionId: string | null;
  retriedCount: number | null;
};

export async function handlePaymentWebhook(
  delivery: WebhookDelivery,
  now: Date = new Date(),
): Promise<WebhookResult> {
  let result: WebhookResult;
  try {
    result = await resolve(delivery, now);
  } catch (err) {
    // DB 오류 등 — 처리 전체가 멱등이라 재전송으로 다시 받는다.
    result = {
      httpStatus: 503,
      outcome: 'retry',
      tossStatus: null,
      orderNo: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  console.log(
    JSON.stringify({
      event: 'payment_webhook',
      paymentKey: delivery.paymentKey,
      transmissionId: delivery.transmissionId,
      ...result,
    }),
  );
  await recordDelivery(delivery, result);
  return result;
}

async function resolve(
  delivery: WebhookDelivery,
  now: Date,
): Promise<WebhookResult> {
  let payment: TossConfirmResponse;
  try {
    payment = await tossClient.getPayment(asBrand<PaymentKey>(delivery.paymentKey));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (err instanceof TossApiError && (err.httpStatus === 400 || err.httpStatus === 404)) {
      // 위조이거나 이 상점 키로는 보이지 않는 결제 — 재전송해도 결과가 같다.
      return { httpStatus: 200, outcome: 'payment_not_found', tossStatus: null, orderNo: null, detail };
    }
    // 키 미설정·인증 오류·네트워크·Toss 5xx — 설정 복구 후 재전송으로 회복된다.
    return { httpStatus: 503, outcome: 'retry', tossStatus: null, orderNo: null, detail };
  }

  const at = { tossStatus: payment.status, orderNo: payment.orderId };
  const order = await getOrder(payment.orderId);
  if (!order) {
    return { httpStatus: 200, outcome: 'order_not_found', ...at };
  }

  // Toss 가 직접 돌려준 값이라도 우리 주문 금액과 다르면 어떤 전이도 하지 않는다.
  if (payment.totalAmount !== order.totalPrice) {
    console.error(
      JSON.stringify({
        event: 'webhook_amount_mismatch',
        orderNo: order.orderNo,
        paymentKey: payment.paymentKey,
        expected: order.totalPrice,
        received: payment.totalAmount,
      }),
    );
    return { httpStatus: 200, outcome: 'amount_mismatch', ...at };
  }

  switch (payment.status) {
    case 'DONE':
      return { httpStatus: 200, outcome: await settleDone(order, payment), ...at };
    case 'CANCELED':
      return { ...(await applyExternalCancel(order, payment, now)), ...at };
    case 'PARTIAL_CANCELED':
      return { ...flagPartialCancel(order, payment, now), ...at };
    default:
      return { httpStatus: 200, outcome: 'recorded', ...at };
  }
}

async function settleDone(
  order: OrderWithItems,
  payment: TossConfirmResponse,
): Promise<WebhookOutcome> {
  if (order.status === 'CREATED') {
    // confirm 경로가 아직(또는 끝내) 정산하지 못한 승인. 같은 락·같은 부수효과로 수렴.
    await settleApprovedPayment(order, asBrand<PaymentKey>(payment.paymentKey), payment);
    return 'settled_paid';
  }
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
    // 취소된 주문에 승인된 결제 — 돈은 받았는데 주문은 죽었다. 자동 처리하지 않는다.
    console.error(
      JSON.stringify({
        event: 'webhook_paid_for_inactive_order',
        orderNo: order.orderNo,
        orderStatus: order.status,
        paymentKey: payment.paymentKey,
      }),
    );
    return 'paid_order_inactive';
  }
  return 'already_paid';
}

/** 가장 최근 취소 시각(epoch ms). 취소 이력이 없거나 파싱 불가면 null. */
function latestCanceledAt(payment: TossConfirmResponse): number | null {
  const times = (payment.cancels ?? [])
    .map((c) => Date.parse(c.canceledAt))
    .filter((t) => Number.isFinite(t));
  return times.length > 0 ? Math.max(...times) : null;
}

function withinGrace(payment: TossConfirmResponse, now: Date): boolean {
  const latest = latestCanceledAt(payment);
  return latest !== null && now.getTime() - latest < EXTERNAL_CANCEL_GRACE_MS;
}

async function applyExternalCancel(
  order: OrderWithItems,
  payment: TossConfirmResponse,
  now: Date,
): Promise<Pick<WebhookResult, 'httpStatus' | 'outcome'>> {
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
    return { httpStatus: 200, outcome: 'cancel_noop' };
  }
  if (withinGrace(payment, now)) {
    return { httpStatus: 503, outcome: 'cancel_deferred' };
  }

  const target: OrderStatus | null = canTransition(order.status, 'CANCELLED')
    ? 'CANCELLED'
    : canTransition(order.status, 'REFUNDED')
      ? 'REFUNDED'
      : null;
  if (target === null) {
    // 예: SHIPPED — 상태기계상 자동 반영 불가. 돈은 이미 환불됐으므로 운영자가 처리.
    console.error(
      JSON.stringify({
        event: 'webhook_cancel_manual',
        orderNo: order.orderNo,
        orderStatus: order.status,
      }),
    );
    return { httpStatus: 200, outcome: 'cancel_manual' };
  }

  const won = await transitionIfStatus(order.id, order.status, target);
  if (!won) {
    // 조회와 전이 사이에 다른 경로가 먼저 상태를 바꿨다 — 그쪽이 부수효과를 담당한다.
    return { httpStatus: 200, outcome: 'cancel_noop' };
  }

  // 관리자 취소·환불과 같은 원장 정합(둘 다 멱등·never throw). 고객 알림은 보내지 않는다.
  if (
    order.userId &&
    ((order.pointsRedeemed ?? 0) > 0 || (order.pointsAccrued ?? 0) > 0)
  ) {
    await reversePointsForOrder(order.id, order.userId, {
      redeemed: order.pointsRedeemed ?? 0,
      accrued: order.pointsAccrued ?? 0,
    });
  }
  // 쿠폰은 PAID 전이 때 소비되므로 CREATED 였던 주문은 되돌릴 것이 없다.
  if (order.status !== 'CREATED' && order.couponCode) {
    await releaseCouponByOrder(order.couponCode, order.userId);
  }

  console.warn(
    JSON.stringify({
      event: 'webhook_external_cancel_applied',
      orderNo: order.orderNo,
      from: order.status,
      to: target,
    }),
  );
  return { httpStatus: 200, outcome: 'cancel_applied' };
}

function flagPartialCancel(
  order: OrderWithItems,
  payment: TossConfirmResponse,
  now: Date,
): Pick<WebhookResult, 'httpStatus' | 'outcome'> {
  if (withinGrace(payment, now)) {
    return { httpStatus: 503, outcome: 'cancel_deferred' };
  }
  const tossRefunded =
    payment.balanceAmount === undefined
      ? 0
      : payment.totalAmount - payment.balanceAmount;
  const recorded = order.refundedAmount ?? 0;
  if (tossRefunded > recorded) {
    // 우리 관리자 부분환불을 거치지 않은 부분취소. 누적액·상태 규칙(ADR-024)은 운영자 판단.
    console.error(
      JSON.stringify({
        event: 'webhook_partial_cancel_unreconciled',
        orderNo: order.orderNo,
        tossRefunded,
        recorded,
      }),
    );
    return { httpStatus: 200, outcome: 'partial_cancel_manual' };
  }
  return { httpStatus: 200, outcome: 'recorded' };
}

/** 감사 기록(043). 미적용·실패는 처리 결과에 영향을 주지 않는다. */
async function recordDelivery(
  delivery: WebhookDelivery,
  result: WebhookResult,
): Promise<void> {
  try {
    if (!(await isWebhookAuditAvailable())) return;
    const { error } = await getServiceRoleSupabase()
      .from('payment_webhook_events')
      .insert({
        transmission_id: delivery.transmissionId,
        retried_count: delivery.retriedCount,
        event_type: delivery.eventType,
        payment_key: delivery.paymentKey,
        order_no: result.orderNo,
        toss_status: result.tossStatus,
        outcome: result.outcome,
        raw_payload: delivery.rawPayload,
      });
    if (error) {
      console.warn(
        JSON.stringify({ event: 'webhook_audit_insert_failed', message: error.message }),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: 'webhook_audit_insert_failed',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
