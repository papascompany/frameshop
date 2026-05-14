'use server';

import { requireAdmin } from '@/lib/db/admin';
import { toggleReviewPublic } from '@/lib/db/reviews';
import { revalidatePath } from 'next/cache';

export async function toggleReviewPublicAction(
  id: string,
  isPublic: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  try {
    await toggleReviewPublic(id, isPublic);
    revalidatePath('/admin/reviews');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '처리 실패' };
  }
}
