'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/db/admin';
import { transitionTo, getOrder, setOrderMemo } from '@/lib/db/order';
import {
  notifyShipped,
  notifyDelivered,
  notifyCancelled,
  notifyRefunded,
} from '@/lib/notify';
import { tossClient } from '@/lib/payment/toss';
import { asBrand } from '@/types/common';
import type { OrderId } from '@/types/common';

/** Orderer-level memo cap (app-enforced; mirrors setOrderMemo's slice). */
const ORDER_MEMO_MAX = 200;

type ActionResult = { ok: boolean; error?: string };

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
 * 주문 환불: PAID / DELIVERED → REFUNDED.
 * Toss 결제 취소(환불)를 먼저 수행한 뒤 상태를 전환한다. 환불에 실패하면
 * 상태를 바꾸지 않는다.
 */
export async function refundOrderAction(
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
    return { ok: false, error: '환불 사유를 입력해주세요.' };
  }

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

    // Fire-and-forget customer notification (same pattern as shipOrderAction).
    void notifyRefunded(order, trimmedReason);

    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '주문 환불 실패',
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
