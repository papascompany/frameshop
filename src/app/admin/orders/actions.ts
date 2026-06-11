'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/db/admin';
import { transitionTo, getOrder } from '@/lib/db/order';
import { notifyShipped } from '@/lib/notify';
import { tossClient } from '@/lib/payment/toss';
import { asBrand } from '@/types/common';
import type { OrderId } from '@/types/common';

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
