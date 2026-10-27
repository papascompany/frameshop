/**
 * 결제 백스톱 스윕 — 확정되지 않은 CREATED 주문을 Toss 의 실제 결제 상태에 맞춰 정리한다.
 * /api/cron/payment-sweep(Vercel Cron, Hobby 는 하루 1회)이 호출한다.
 *
 * 1차 확정 경로는 성공 URL 서버 렌더(redirect-confirm.ts)다. 이 스윕은 그 경로가 끝내
 * 마무리하지 못한 주문을 orderId 결제 조회로 판정한다:
 *  - DONE        : Toss 는 승인(청구)했는데 DB 는 CREATED → confirmPayment 로 PAID 정산
 *                  (ALREADY_PROCESSED_PAYMENT 수렴 + 끊긴 payment_events 락 CAS 인수).
 *  - IN_PROGRESS : 인증만 끝나고 승인 전 → 승인 시도. 인증 후 10분 안일 때만 성공하므로
 *                  하루 1회 크론에서는 드물다(실패해도 상태 무변경).
 *  - 결제 없음(NOT_FOUND_PAYMENT)·READY·EXPIRED·ABORTED·CANCELED : 생성 후
 *                  SWEEP_ABANDON_AFTER_MS 가 지났으면 CANCELLED 로 만료(CAS) + 사용 적립금 복원.
 *                  쿠폰은 PAID 때만 소비되므로 되돌릴 것이 없다. 결제하지 않은 주문이라 고객
 *                  알림은 보내지 않는다.
 *  - 그 외(WAITING_FOR_DEPOSIT·PARTIAL_CANCELED)·조회 실패 : 손대지 않고 로그만 남긴다.
 *
 * Toss 시크릿 키가 없으면 아무것도 하지 않는다 — 결제 상태를 확인하지 못한 채 주문을
 * 만료시키지 않는다.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { PaymentKey } from '@/types/common';
import { getEffectiveTossSecretKey } from '../env';
import {
  getOrder,
  listStaleCreatedOrders,
  transitionIfStatus,
  type StaleCreatedOrder,
} from '../db/order';
import { reversePointsForOrder } from '../db/points';
import { confirmPayment } from './confirm';
import { tossClient, TossApiError, type TossConfirmResponse } from './toss';

/** 라이브 성공 플로우·Toss 10분 승인 창과 겹치지 않도록 이보다 젊은 주문은 보지 않는다. */
export const SWEEP_MIN_AGE_MS = 15 * 60_000;
/** 결제 흔적이 없는 CREATED 주문을 방치로 보고 만료시키는 나이. */
export const SWEEP_ABANDON_AFTER_MS = 24 * 60 * 60_000;
/** 1회 처리 상한 — 주문당 Toss 호출이 최대 10초라 maxDuration(60초) 안에서 여유 있게. */
export const SWEEP_BATCH_LIMIT = 20;

/** 결제가 승인되지 않았고 앞으로도 승인될 수 없는 Toss 상태. */
const ABANDONED_TOSS_STATUSES: ReadonlySet<string> = new Set([
  'READY',
  'EXPIRED',
  'ABORTED',
  'CANCELED',
]);

export type SweepAction =
  | 'confirmed'
  | 'confirm_failed'
  | 'expired'
  | 'waiting'
  | 'manual'
  | 'lost_race'
  | 'error';

export type SweepOutcome = {
  orderNo: string;
  /** Toss 결제 상태, 결제가 없으면 'NOT_FOUND', 조회 실패면 'LOOKUP_FAILED'. */
  tossStatus: string;
  action: SweepAction;
  detail?: string;
};

export type SweepSummary = {
  skipped?: 'TOSS_NOT_CONFIGURED';
  scanned: number;
  outcomes: SweepOutcome[];
};

export async function sweepUnconfirmedOrders(
  now: Date = new Date(),
  limit: number = SWEEP_BATCH_LIMIT,
): Promise<SweepSummary> {
  try {
    await getEffectiveTossSecretKey();
  } catch {
    return { skipped: 'TOSS_NOT_CONFIGURED', scanned: 0, outcomes: [] };
  }

  const candidates = await listStaleCreatedOrders(
    new Date(now.getTime() - SWEEP_MIN_AGE_MS),
    limit,
  );

  const outcomes: SweepOutcome[] = [];
  for (const candidate of candidates) {
    const outcome = await sweepOne(candidate, now);
    console.log(JSON.stringify({ event: 'payment_sweep_order', ...outcome }));
    outcomes.push(outcome);
  }
  return { scanned: candidates.length, outcomes };
}

async function sweepOne(
  candidate: StaleCreatedOrder,
  now: Date,
): Promise<SweepOutcome> {
  const orderNo = candidate.orderNo as string;

  let payment: TossConfirmResponse | null;
  try {
    payment = await tossClient.getPaymentByOrderId(orderNo);
  } catch (err) {
    if (err instanceof TossApiError && err.code === 'NOT_FOUND_PAYMENT') {
      payment = null;
    } else {
      return {
        orderNo,
        tossStatus: 'LOOKUP_FAILED',
        action: 'error',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const tossStatus = payment?.status ?? 'NOT_FOUND';

  try {
    if (payment && (payment.status === 'DONE' || payment.status === 'IN_PROGRESS')) {
      // amount 는 DB 권위값 — confirmPayment 가 Toss 응답의 orderId·금액·DONE 을
      // 다시 대조하므로, 금액이 다른 결제는 PAID 로 정산되지 않는다.
      const result = await confirmPayment(
        {
          paymentKey: asBrand<PaymentKey>(payment.paymentKey),
          orderId: candidate.orderNo,
          amount: candidate.totalPrice,
        },
        { takeOverStaleLock: true },
      );
      return result.ok
        ? { orderNo, tossStatus, action: 'confirmed' }
        : {
            orderNo,
            tossStatus,
            action: 'confirm_failed',
            detail: `${result.code}: ${result.message}`,
          };
    }

    if (payment === null || ABANDONED_TOSS_STATUSES.has(payment.status)) {
      const ageMs = now.getTime() - Date.parse(candidate.createdAt);
      if (ageMs < SWEEP_ABANDON_AFTER_MS) {
        return { orderNo, tossStatus, action: 'waiting' };
      }
      return await expireAbandonedOrder(candidate, tossStatus);
    }

    return { orderNo, tossStatus, action: 'manual' };
  } catch (err) {
    return {
      orderNo,
      tossStatus,
      action: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function expireAbandonedOrder(
  candidate: StaleCreatedOrder,
  tossStatus: string,
): Promise<SweepOutcome> {
  const orderNo = candidate.orderNo as string;
  const won = await transitionIfStatus(candidate.id, 'CREATED', 'CANCELLED');
  if (!won) {
    // 조회와 만료 사이에 다른 경로(확정·고객 취소)가 먼저 상태를 바꿨다.
    return { orderNo, tossStatus, action: 'lost_race' };
  }

  // createOrder 가 체크아웃 시점에 차감한 적립금을 돌려준다(customerCancelOrder 미러).
  // reversePointsForOrder 는 멱등이고 throw 하지 않는다.
  const order = await getOrder(orderNo);
  if (
    order?.userId &&
    ((order.pointsRedeemed ?? 0) > 0 || (order.pointsAccrued ?? 0) > 0)
  ) {
    await reversePointsForOrder(order.id, order.userId, {
      redeemed: order.pointsRedeemed ?? 0,
      accrued: order.pointsAccrued ?? 0,
    });
  }
  return { orderNo, tossStatus, action: 'expired' };
}
