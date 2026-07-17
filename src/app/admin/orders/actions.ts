'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/db/admin';
import { transitionTo, getOrder, setOrderMemo } from '@/lib/db/order';
import { reversePointsForOrder } from '@/lib/db/points';
import { releaseCouponByOrder } from '@/lib/db/coupons';
import { isPartialRefundAvailable } from '@/lib/db/feature-probe';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { canTransition } from '@/lib/order/state';
import {
  notifyShipped,
  notifyDelivered,
  notifyCancelled,
  notifyRefunded,
} from '@/lib/notify';
import { tossClient } from '@/lib/payment/toss';
import { asBrand } from '@/types/common';
import type { OrderId } from '@/types/common';
import type { OrderStatus } from '@/types/order';

/** Orderer-level memo cap (app-enforced; mirrors setOrderMemo's slice). */
const ORDER_MEMO_MAX = 200;

type ActionResult = { ok: boolean; error?: string };

type RefundActionResult = ActionResult & {
  /** 부분환불 성공 시 누적 환불액(KRW). */
  refundedAmount?: number;
  /** 액션 이후 주문 상태 — 누적이 전액에 도달해 전이됐으면 REFUNDED. */
  status?: OrderStatus;
};

/** 부분환불 금액: 1원 이상 정수(KRW). 상한(잔여액)은 주문 조회 후 검증. */
const partialRefundAmountSchema = z.number().int().positive();

/** 결제가 존재하고 아직 종결되지 않아 부분환불이 가능한 상태. */
const PARTIAL_REFUNDABLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'PAID',
  'IN_PRODUCTION',
  'SHIPPED',
  'DELIVERED',
]);

/**
 * PAID → IN_PRODUCTION 전환.
 * requireAdmin() 가드 필수.
 */
export async function startProductionAction(
  orderId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  try {
    await transitionTo(asBrand<OrderId>(orderId), 'IN_PRODUCTION');
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '상태 전환 실패',
    };
  }
}

/**
 * IN_PRODUCTION → SHIPPED 전환 + 배송 알림 이메일 발송.
 * courier, trackingNumber 필수.
 */
export async function shipOrderAction(
  orderId: string,
  courier: string,
  trackingNumber: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  if (!courier.trim()) {
    return { ok: false, error: '택배사를 선택해주세요.' };
  }
  if (!trackingNumber.trim()) {
    return { ok: false, error: '운송장번호를 입력해주세요.' };
  }

  try {
    await transitionTo(asBrand<OrderId>(orderId), 'SHIPPED', {
      courier,
      trackingNumber,
    });

    // 상태 전환 성공 후 주문 정보 다시 조회해서 알림 발송
    const order = await getOrder(orderId);
    if (order) {
      // 실패해도 액션에 영향 없음 (.catch 내부 처리)
      void notifyShipped(order, courier, trackingNumber);
    }

    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '출하 처리 실패',
    };
  }
}

/**
 * SHIPPED → DELIVERED 전환.
 */
export async function markDeliveredAction(
  orderId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  try {
    await transitionTo(asBrand<OrderId>(orderId), 'DELIVERED');

    // Fire-and-forget customer notification (same pattern as shipOrderAction).
    const order = await getOrder(orderId);
    if (order) {
      void notifyDelivered(order);
    }

    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '배송완료 처리 실패',
    };
  }
}

/**
 * 주문 취소: CREATED / PAID / IN_PRODUCTION → CANCELLED.
 * 이미 결제된 주문(payment_id 존재)이면 Toss 결제 취소(환불)를 먼저 수행한 뒤
 * 상태를 전환한다. 환불에 실패하면 상태를 바꾸지 않는다(돈이 안 돌아갔는데
 * CANCELLED 로 마킹하는 것을 방지).
 */
export async function cancelOrderAction(
  orderId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    return { ok: false, error: '취소 사유를 입력해주세요.' };
  }

  try {
    const order = await getOrder(orderId);
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    // Refund first if the order carries a payment. CREATED orders have none.
    if (order.paymentId) {
      try {
        await tossClient.cancel({
          paymentKey: order.paymentId,
          cancelReason: trimmedReason,
        });
      } catch (err) {
        return {
          ok: false,
          error: `결제 취소(환불) 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
        };
      }
    }

    await transitionTo(asBrand<OrderId>(orderId), 'CANCELLED', {
      reason: trimmedReason,
    });

    // FS-EC P1-1(후속): CANCELLED 전이 성공 후 원장 정합 — 사용분 복원 +
    // 적립분 회수. customerCancelOrder 와 동일 시맨틱: fire-and-forget(실패해도
    // 취소 주 흐름을 되돌리지 않음, 함수 내부 멱등 + 구조화 로그, never throws),
    // 게스트 주문(userId null)·031 미적용은 skip.
    if (
      order.userId &&
      ((order.pointsRedeemed ?? 0) > 0 || (order.pointsAccrued ?? 0) > 0)
    ) {
      void reversePointsForOrder(order.id, order.userId, {
        redeemed: order.pointsRedeemed ?? 0,
        accrued: order.pointsAccrued ?? 0,
      });
    }

    // FS-X-FIX-A P1-1: restore the coupon usage slot only when the order had been
    // PAID — the coupon is consumed at the PAID transition, not at creation. A
    // CREATED→CANCELLED (unpaid) cancel never consumed it (snapshot only). Fire-and-
    // forget mirror of the points reversal above (releaseCouponByOrder never throws).
    if (order.status !== 'CREATED' && order.couponCode) {
      void releaseCouponByOrder(order.couponCode, order.userId);
    }

    // Fire-and-forget customer notification (same pattern as shipOrderAction).
    void notifyCancelled(order, trimmedReason);

    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '주문 취소 실패',
    };
  }
}

/**
 * 주문 환불.
 *
 * - `opts.cancelAmount` 미지정(기존 호출과 하위호환): 전액 환불 — Toss 전액
 *   취소 후 PAID / DELIVERED → REFUNDED 전환. 기존 동작 무변경.
 * - `opts.cancelAmount` 지정: 부분환불(FS-EC-03, migration 038). Toss 부분취소
 *   성공 후 orders.refunded_amount 에 누적 기록하며, 누적이 total_price 에
 *   도달하면 REFUNDED 로 전환한다(부분 상태에서는 상태 무변경).
 *
 * 두 경로 모두 Toss 취소를 먼저 수행하고, 실패하면 상태/누적액을 바꾸지 않는다.
 */
export async function refundOrderAction(
  orderId: string,
  opts?: { cancelAmount?: number; reason?: string },
): Promise<RefundActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const trimmedReason = (opts?.reason ?? '').trim();
  if (trimmedReason.length === 0) {
    return { ok: false, error: '환불 사유를 입력해주세요.' };
  }

  if (opts?.cancelAmount === undefined) {
    return fullRefund(orderId, trimmedReason);
  }
  return partialRefund(orderId, opts.cancelAmount, trimmedReason);
}

/** 전액 환불 — 기존 refundOrderAction 로직 그대로(무변경). */
async function fullRefund(
  orderId: string,
  trimmedReason: string,
): Promise<RefundActionResult> {
  try {
    const order = await getOrder(orderId);
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (!order.paymentId) {
      return { ok: false, error: '결제 정보가 없어 환불할 수 없습니다.' };
    }

    try {
      await tossClient.cancel({
        paymentKey: order.paymentId,
        cancelReason: trimmedReason,
      });
    } catch (err) {
      return {
        ok: false,
        error: `결제 취소(환불) 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
      };
    }

    await transitionTo(asBrand<OrderId>(orderId), 'REFUNDED', {
      reason: trimmedReason,
    });

    // FS-EC P1-1: 원장 정합 — REFUNDED 전이 성공 후 사용분 복원 + 적립분 회수.
    // fire-and-forget: 실패해도 환불 주 흐름을 되돌리지 않는다(함수 내부에서
    // 멱등 처리 + 구조화 로그, never throws). 게스트 주문(userId null)은 포인트
    // 개념이 없어 skip.
    if (
      order.userId &&
      ((order.pointsRedeemed ?? 0) > 0 || (order.pointsAccrued ?? 0) > 0)
    ) {
      void reversePointsForOrder(order.id, order.userId, {
        redeemed: order.pointsRedeemed ?? 0,
        accrued: order.pointsAccrued ?? 0,
      });
    }

    // FS-X-FIX-A P1-1: a full refund always follows a PAID order (requires
    // paymentId), so the coupon was consumed — restore its usage slot. Fire-and-
    // forget mirror of the points reversal above (releaseCouponByOrder never throws).
    if (order.couponCode) {
      void releaseCouponByOrder(order.couponCode, order.userId);
    }

    // Fire-and-forget customer notification (same pattern as shipOrderAction).
    void notifyRefunded(order, trimmedReason);

    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, status: 'REFUNDED' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '주문 환불 실패',
    };
  }
}

/**
 * 부분환불(FS-EC-03). 서버 권위 검증: 0 < cancelAmount ≤ totalPrice − 누적액.
 *
 * 순서(정합의 핵심): Toss 부분취소 성공 → refunded_amount 누적 UPDATE(이전
 * 값 일치 조건의 낙관적 잠금 — 동시 환불 경합에서 누적 소실 방지). UPDATE 가
 * 실패하면 Toss 환불은 이미 집행된 상태이므로 절대 은폐하지 않고 구조화
 * 로그 + 수동 보정 안내를 반환한다.
 */
async function partialRefund(
  orderId: string,
  cancelAmount: number,
  trimmedReason: string,
): Promise<RefundActionResult> {
  // 038 미적용이면 명시 에러 — refunded_amount 없이 부분환불하면 누적 추적이
  // 불가능해 과환불 위험이 생긴다.
  if (!(await isPartialRefundAvailable())) {
    return {
      ok: false,
      error:
        '부분환불 기능을 사용할 수 없습니다. 마이그레이션 038(orders.refunded_amount) 적용이 필요합니다.',
    };
  }

  const parsedAmount = partialRefundAmountSchema.safeParse(cancelAmount);
  if (!parsedAmount.success) {
    return { ok: false, error: '환불 금액은 1원 이상의 정수여야 합니다.' };
  }

  try {
    const order = await getOrder(orderId);
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (!order.paymentId) {
      return { ok: false, error: '결제 정보가 없어 환불할 수 없습니다.' };
    }
    if (!PARTIAL_REFUNDABLE_STATUSES.has(order.status)) {
      return {
        ok: false,
        error: `현재 상태(${order.status})에서는 부분환불할 수 없습니다.`,
      };
    }

    const prevRefunded = order.refundedAmount ?? 0;
    const remaining = order.totalPrice - prevRefunded;
    if (remaining <= 0) {
      return { ok: false, error: '이미 전액이 환불된 주문입니다.' };
    }
    if (cancelAmount > remaining) {
      return {
        ok: false,
        error: `환불 금액이 잔여 금액(${remaining.toLocaleString('ko-KR')}원)을 초과합니다.`,
      };
    }

    try {
      await tossClient.cancel({
        paymentKey: order.paymentId,
        cancelReason: trimmedReason,
        cancelAmount,
      });
    } catch (err) {
      return {
        ok: false,
        error: `결제 부분취소(환불) 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
      };
    }

    const cumulative = prevRefunded + cancelAmount;

    const supabase = getServiceRoleSupabase();
    const { data: updatedRows, error: updErr } = await supabase
      .from('orders')
      .update({ refunded_amount: cumulative })
      .eq('id', order.id as string)
      .eq('refunded_amount', prevRefunded)
      .select('id');

    if (updErr || !updatedRows || updatedRows.length === 0) {
      // Toss 환불은 이미 집행됨 — 기록 실패를 은폐하면 과환불로 이어진다.
      console.error(
        JSON.stringify({
          event: 'partial_refund_update_failed',
          ctx: {
            orderNo: order.orderNo,
            cancelAmount,
            prevRefunded,
            cumulative,
            message: updErr?.message ?? 'no rows matched (동시 갱신 경합 추정)',
          },
        }),
      );
      return {
        ok: false,
        error:
          `Toss 부분환불 ${cancelAmount.toLocaleString('ko-KR')}원은 완료되었으나 누적 환불액 기록에 실패했습니다. ` +
          `주문 ${order.orderNo as string}의 refunded_amount 를 ${cumulative.toLocaleString('ko-KR')}원으로 수동 보정해주세요.`,
      };
    }

    let status: OrderStatus = order.status;
    if (cumulative === order.totalPrice) {
      if (canTransition(order.status, 'REFUNDED')) {
        await transitionTo(order.id, 'REFUNDED', { reason: trimmedReason });
        status = 'REFUNDED';
        // FS-EC P1-1: 누적이 전액에 도달해 REFUNDED 전이가 성공한 경우에만 원장
        // 정합(사용분 복원 + 적립분 회수). 부분 상태(누적 < 전액)는 무조정.
        if (
          order.userId &&
          ((order.pointsRedeemed ?? 0) > 0 || (order.pointsAccrued ?? 0) > 0)
        ) {
          void reversePointsForOrder(order.id, order.userId, {
            redeemed: order.pointsRedeemed ?? 0,
            accrued: order.pointsAccrued ?? 0,
          });
        }
        // Fire-and-forget — 기존 전액환불 플로우와 동일 훅.
        void notifyRefunded(order, trimmedReason);
      } else {
        // 전액에 도달했지만 상태기계상 REFUNDED 전이가 불가한 상태(IN_PRODUCTION,
        // SHIPPED). 돈은 전부 환불됐으므로 기록만 남기고 상태는 유지한다.
        console.warn(
          JSON.stringify({
            event: 'partial_refund_full_no_transition',
            ctx: { orderNo: order.orderNo, status: order.status, cumulative },
          }),
        );
      }
    }

    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, refundedAmount: cumulative, status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '부분환불 실패',
    };
  }
}

/**
 * 주문자 메모 저장(또는 삭제). shipping.memo(배송 요청)와 별개로 주문자
 * 레벨의 자유 메모(사이즈 변경 / 입금 요청 등)를 다룬다.
 *
 * 빈 문자열은 메모 삭제(null 저장)로 처리한다. 최대 200자.
 * setOrderMemo 는 migration 029 미적용 시에만 에러를 던지므로 try/catch 로 감싼다.
 */
export async function saveOrderMemoAction(
  orderId: string,
  memo: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const trimmed = memo.trim();
  if (trimmed.length > ORDER_MEMO_MAX) {
    return {
      ok: false,
      error: `메모는 최대 ${ORDER_MEMO_MAX}자까지 입력할 수 있습니다.`,
    };
  }

  // Empty string clears the memo (store null).
  const value = trimmed.length === 0 ? null : trimmed;

  try {
    await setOrderMemo(asBrand<OrderId>(orderId), value);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '메모 저장 실패',
    };
  }
}

type BulkTrackingRow = {
  orderNo: string;
  courier: string;
  trackingNumber: string;
};

/** Cap per batch — each row is a sequential getOrder + transition; an oversized
 *  paste would otherwise risk a function timeout. */
const BULK_TRACKING_MAX = 500;

type BulkTrackingResult = {
  ok: boolean;
  results: { orderNo: string; ok: boolean; error?: string }[];
};

/**
 * 운송장 일괄 등록: 각 행을 orderNo 로 해석해 SHIPPED 로 전환하고 배송 알림을
 * 발송한다. shipOrderAction 과 동일한 경로(transitionTo + notifyShipped)를 재사용.
 *
 * 한 행이 실패해도 배치 전체를 중단하지 않는다(per-row ok/error 수집). 전체
 * ok 는 모든 행이 성공했을 때만 true.
 */
export async function bulkUpdateTrackingAction(
  rows: BulkTrackingRow[],
): Promise<BulkTrackingResult> {
  try {
    await requireAdmin();
  } catch {
    return {
      ok: false,
      results: rows.map((r) => ({
        orderNo: r.orderNo,
        ok: false,
        error: '관리자 권한이 필요합니다.',
      })),
    };
  }

  if (rows.length > BULK_TRACKING_MAX) {
    return {
      ok: false,
      results: [
        {
          orderNo: '',
          ok: false,
          error: `한 번에 최대 ${BULK_TRACKING_MAX}건까지 등록할 수 있습니다. (요청 ${rows.length}건)`,
        },
      ],
    };
  }

  const results: BulkTrackingResult['results'] = [];

  for (const row of rows) {
    const orderNo = row.orderNo.trim();
    const courier = row.courier.trim();
    const trackingNumber = row.trackingNumber.trim();

    if (!orderNo) {
      results.push({ orderNo: row.orderNo, ok: false, error: '주문번호가 비어 있습니다.' });
      continue;
    }
    if (!courier) {
      results.push({ orderNo, ok: false, error: '택배사를 입력해주세요.' });
      continue;
    }
    if (!trackingNumber) {
      results.push({ orderNo, ok: false, error: '운송장번호를 입력해주세요.' });
      continue;
    }

    try {
      // getOrder accepts orderNo (YYYYMMDD-NNNN) or id; we resolve by orderNo.
      const order = await getOrder(orderNo);
      if (!order) {
        results.push({ orderNo, ok: false, error: '주문을 찾을 수 없습니다.' });
        continue;
      }

      // Same path shipOrderAction uses: state-machine transition (idempotent /
      // guarded by canTransition) then fire-and-forget customer notification.
      await transitionTo(order.id, 'SHIPPED', { courier, trackingNumber });
      void notifyShipped(order, courier, trackingNumber);

      results.push({ orderNo, ok: true });
    } catch (err) {
      results.push({
        orderNo,
        ok: false,
        error: err instanceof Error ? err.message : '출하 처리 실패',
      });
    }
  }

  // Revalidate the list once after the whole batch (not per row).
  revalidatePath('/admin/orders');

  return { ok: results.every((r) => r.ok), results };
}
