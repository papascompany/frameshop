'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/db/admin';
import { transitionTo, getOrder } from '@/lib/db/order';
import { notifyShipped } from '@/lib/notify';
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
