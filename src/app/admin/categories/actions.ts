'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { asBrand } from '@/types/common';
import type { CategoryId } from '@/types/common';
import { categoryFormSchema } from '@/types/admin';
import {
  requireAdmin,
  upsertCategory,
  toggleCategoryActive,
  deleteCategory,
} from '@/lib/db/admin';

export type CategoryActionResult = { ok: true } | { ok: false; error: string };

/** Flush the catalog/landing caches that key off categories. */
function flushCategoryCaches() {
  // getCategories + getProductsByCategory are tagged 'categories'.
  revalidateTag('categories', 'max');
  revalidatePath('/admin/categories');
}

export async function upsertCategoryAction(
  formData: FormData,
): Promise<CategoryActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const parentRaw = formData.get('parentId');
  const raw = {
    slug: String(formData.get('slug') ?? '').trim(),
    name: String(formData.get('name') ?? '').trim(),
    parentId: parentRaw && String(parentRaw).length > 0 ? String(parentRaw) : null,
    sortOrder: Number(formData.get('sortOrder') ?? 0),
    isActive: formData.get('isActive') === 'true',
  };

  const parsed = categoryFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력 검증 실패' };
  }

  try {
    const idRaw = formData.get('id');
    await upsertCategory({
      slug: parsed.data.slug,
      name: parsed.data.name,
      parentId: parsed.data.parentId ? asBrand<CategoryId>(parsed.data.parentId) : null,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive,
      ...(idRaw ? { id: asBrand<CategoryId>(idRaw as string) } : {}),
    });
    flushCategoryCaches();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    // Unique slug collision → friendly message.
    if (/duplicate|unique|23505/i.test(msg)) {
      return { ok: false, error: '이미 사용 중인 슬러그입니다. 다른 값을 입력하세요.' };
    }
    return { ok: false, error: msg };
  }
}

export async function toggleCategoryActiveAction(
  id: string,
  active: boolean,
): Promise<CategoryActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  try {
    await toggleCategoryActive(asBrand<CategoryId>(id), active);
    flushCategoryCaches();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function deleteCategoryAction(
  id: string,
): Promise<CategoryActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  try {
    await deleteCategory(asBrand<CategoryId>(id));
    flushCategoryCaches();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
