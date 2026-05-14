'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/db/admin';
import { bulkUpdateShippingMethods } from '@/lib/db/shipping';
import { shippingMethodInputSchema } from '@/types/shipping';
import type { ShippingMethod } from '@/types/shipping';

export type ShippingActionResult = { ok: true } | { ok: false; error: string };

export type ShippingMethodUpdate = {
  code: string;
  label: string;
  fee: number;
  freeThreshold: number | null;
  note: string | null;
  isActive: boolean;
  sortOrder: number;
};

export async function updateShippingMethodsAction(
  rows: ShippingMethodUpdate[],
): Promise<ShippingActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const parsed = rows.map((row) =>
    shippingMethodInputSchema.safeParse(row),
  );

  const firstError = parsed.find((r) => !r.success);
  if (firstError && !firstError.success) {
    return {
      ok: false,
      error: firstError.error.issues[0]?.message ?? '입력 검증 실패',
    };
  }

  const validated = parsed.map((r) => {
    if (!r.success) throw new Error('unreachable');
    return r.data;
  });

  // At least one must be active
  if (!validated.some((r) => r.isActive)) {
    return { ok: false, error: '최소 1개의 배송 방법은 활성화해야 합니다.' };
  }

  try {
    await bulkUpdateShippingMethods(
      validated.map((r) => ({
        code: r.code as ShippingMethod,
        label: r.label,
        fee: r.fee,
        freeThreshold: r.freeThreshold,
        note: r.note,
        isActive: r.isActive,
        sortOrder: r.sortOrder,
      })),
    );
    revalidatePath('/admin/shipping');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
