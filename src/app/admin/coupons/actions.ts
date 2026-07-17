'use server';

/**
 * admin/coupons 서버 액션 (FS-X-05, ADR-026).
 *
 * requireAdmin 이중 게이트(미들웨어와 별개) + zod 검증 후 X-01 DB 함수
 * (upsertCoupon/toggleCouponActive/deleteCoupon)에 위임한다. 목록 로드는
 * 페이지 서버 컴포넌트가 listCoupons 를 직접 호출한다.
 *
 * 성공 시 갱신된 Coupon 을 돌려줘 클라이언트가 로컬 목록을 즉시 동기화한다
 * (revalidatePath 는 서버 캐시용 — ReviewsClient 로컬 상태 패턴 미러).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/db/admin';
import {
  deleteCoupon,
  toggleCouponActive,
  upsertCoupon,
} from '@/lib/db/coupons';
import { isCouponsAvailable } from '@/lib/db/feature-probe';
import { couponInputSchema } from '@/types/coupon';
import { asBrand } from '@/types/common';
import type { CouponId } from '@/types/common';
import type { Coupon } from '@/types/coupon';

export type CouponActionResult =
  | { ok: true; coupon: Coupon }
  | { ok: false; error: string };

export type CouponDeleteResult = { ok: true } | { ok: false; error: string };

const couponIdSchema = z.string().uuid();

// 쿠폰 스키마(042) 미적용 창의 명시적 안내 — raw 42P01 이 UI 로 새지 않게
// 각 액션이 선제 probe 게이트한다(워크스페이스 액션 X-03 패턴 미러).
const COUPONS_PENDING =
  '쿠폰 기능이 아직 활성화되지 않았습니다(스키마 042 미적용). 적용 후 다시 시도하세요.';

export async function saveCouponAction(
  payload: unknown,
): Promise<CouponActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  if (!(await isCouponsAvailable())) {
    return { ok: false, error: COUPONS_PENDING };
  }

  const { id: rawId, ...rest } =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {};

  let id: CouponId | undefined;
  if (rawId !== undefined) {
    const parsedId = couponIdSchema.safeParse(rawId);
    if (!parsedId.success) {
      return { ok: false, error: '잘못된 쿠폰 id 입니다.' };
    }
    id = asBrand<CouponId>(parsedId.data);
  }

  const parsed = couponInputSchema.safeParse(rest);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? '입력 검증에 실패했습니다.',
    };
  }

  const { data, error } = await upsertCoupon({
    ...parsed.data,
    ...(id != null ? { id } : {}),
  });
  if (error || !data) {
    return { ok: false, error: error ?? '쿠폰 저장에 실패했습니다.' };
  }

  revalidatePath('/admin/coupons');
  return { ok: true, coupon: data };
}

export async function toggleCouponActiveAction(
  id: string,
  isActive: boolean,
): Promise<CouponActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  if (!(await isCouponsAvailable())) {
    return { ok: false, error: COUPONS_PENDING };
  }

  const parsedId = couponIdSchema.safeParse(id);
  if (!parsedId.success || typeof isActive !== 'boolean') {
    return { ok: false, error: '잘못된 요청입니다.' };
  }

  const { data, error } = await toggleCouponActive(
    asBrand<CouponId>(parsedId.data),
    isActive,
  );
  if (error || !data) {
    return { ok: false, error: error ?? '쿠폰 상태 변경에 실패했습니다.' };
  }

  revalidatePath('/admin/coupons');
  return { ok: true, coupon: data };
}

export async function deleteCouponAction(
  id: string,
): Promise<CouponDeleteResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  if (!(await isCouponsAvailable())) {
    return { ok: false, error: COUPONS_PENDING };
  }

  const parsedId = couponIdSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: '잘못된 요청입니다.' };
  }

  // 사용 이력이 있으면 X-01 deleteCoupon 이 안내 메시지와 함께 거부한다
  // (1인 1회 원장 보존 — 비활성화 권장).
  const { error } = await deleteCoupon(asBrand<CouponId>(parsedId.data));
  if (error) {
    return { ok: false, error };
  }

  revalidatePath('/admin/coupons');
  return { ok: true };
}
