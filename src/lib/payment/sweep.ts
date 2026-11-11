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
 *
 * 기아 방지(보안 검토 P1-8): 예전에는 오래된 순 20건만 봐서, 끝내 CREATED 로 남는
 * waiting·manual·조회 실패 주문이 상위 슬롯을 매일 다시 차지하고 그 뒤의 "Toss 승인
 * 됐는데 DB 는 CREATED" 주문이 정산되지 않았다. 이제는
 *  - 시간 예산(SWEEP_TIME_BUDGET_MS) 안에서 페이지(SWEEP_PAGE_SIZE)를 계속 넘기고,
 *  - (created_at, id) 키셋 커서로 이미 판정한 주문을 다음 페이지에서 건너뛰며,
 *  - 최신 순으로 훑는다. 정산 대상 DONE 은 성공 리다이렉트가 실패한 최근 주문에
 *    몰리고, 매일 다시 조회돼도 상태가 바뀌지 않는 오래된 manual·조회 실패 행은
 *    맨 뒤로 밀려 남는 예산만 쓴다(행별 조회 이력 컬럼 없이 반복 조회 비용을 줄이는 방식).
 * 예산이 바닥나 다 못 본 경우 hasMore=true 로 보고한다(크론 로그 모니터링 대상).
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { PaymentKey } from '@/types/common';
import { getEffectiveTossSecretKey } from '../env';
import {
  getOrder,
  listStaleCreatedOrders,
  transitionIfStatus,
  type StaleCreatedCursor,
  type StaleCreatedOrder,
} from '../db/order';
import { reversePointsForOrder } from '../db/points';
import { confirmPayment } from './confirm';
import { tossClient, TossApiError, type TossConfirmResponse } from './toss';

/** 라이브 성공 플로우·Toss 10분 승인 창과 겹치지 않도록 이보다 젊은 주문은 보지 않는다. */
export const SWEEP_MIN_AGE_MS = 15 * 60_000;
/** 결제 흔적이 없는 CREATED 주문을 방치로 보고 만료시키는 나이. */
export const SWEEP_ABANDON_AFTER_MS = 24 * 60 * 60_000;
/** 한 번에 읽는 후보 수(키셋 페이지 크기). 실행당 상한이 아니다 — 시간 예산이 상한. */
export const SWEEP_PAGE_SIZE = 20;
/**
 * 새 주문 판정을 시작하는 마감(스윕 시작 기준 경과 시간). 주문 1건의 최악은 Toss 조회
 * 10초 + 승인 10초 + 승인 후 재조회 10초 ≈ 30초라, 이 시각 직전에 시작한 주문도
 * 라우트 maxDuration(60초) 안에 끝난다. 평소 Toss 호출은 1초 미만이라 실행당 수십 건.
 */
export const SWEEP_TIME_BUDGET_MS = 25_000;

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
  /** 판정한 주문 수(= outcomes.length). */
  scanned: number;
  /** 읽은 후보 페이지 수. */
  pages: number;
  /** 시간 예산이 바닥나 아직 보지 못한 후보가 남았을 수 있음 — 다음 실행으로 넘어간다. */
  hasMore: boolean;
  outcomes: SweepOutcome[];
};

export type SweepOptions = {
  pageSize?: number;
  timeBudgetMs?: number;
  /** 경과 시간 측정용 시계(ms). 테스트 주입용 — 판정 기준 시각 `now` 와 별개다. */
  clock?: () => number;
};

export async function sweepUnconfirmedOrders(
  now: Date = new Date(),
  {
    pageSize = SWEEP_PAGE_SIZE,
    timeBudgetMs = SWEEP_TIME_BUDGET_MS,
    clock = Date.now,
  }: SweepOptions = {},
): Promise<SweepSummary> {
  try {
    await getEffectiveTossSecretKey();
  } catch {
    return {
      skipped: 'TOSS_NOT_CONFIGURED',
      scanned: 0,
      pages: 0,
      hasMore: false,
      outcomes: [],
    };
  }

  const startedAt = clock();
  const outOfTime = () => clock() - startedAt >= timeBudgetMs;
  const createdBefore = new Date(now.getTime() - SWEEP_MIN_AGE_MS);

  const outcomes: SweepOutcome[] = [];
  let cursor: StaleCreatedCursor | undefined;
  let pages = 0;
  let hasMore = false;

  for (;;) {
    if (outOfTime()) {
      // 마지막 페이지를 다 처리한 직후 예산이 끝났으면 남은 행이 없을 수도 있다
      // (보수적으로 true — 다음 실행이 확인한다).
      hasMore = true;
      break;
    }
    const page = await listStaleCreatedOrders(createdBefore, pageSize, cursor);
    pages += 1;

    const last = page[page.length - 1];
    if (cursor && last && last.id === cursor.id && last.createdAt === cursor.createdAt) {
      // 커서가 전진하지 않음(쿼리 이상) — 이미 판정한 페이지를 다시 돌지 않는다.
      console.error(
        JSON.stringify({ event: 'payment_sweep_cursor_stalled', cursor, pages }),
      );
      hasMore = true;
      break;
    }

    for (const candidate of page) {
      if (outOfTime()) {
        hasMore = true;
        break;
      }
      const outcome = await sweepOne(candidate, now);
      console.info(JSON.stringify({ event: 'payment_sweep_order', ...outcome }));
      outcomes.push(outcome);
    }
    if (hasMore || !last || page.length < pageSize) break;
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  return { scanned: outcomes.length, pages, hasMore, outcomes };
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
