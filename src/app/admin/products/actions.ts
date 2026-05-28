'use server';

import { revalidatePath } from 'next/cache';
import { asBrand } from '@/types/common';
import type { CategoryId, ProductId } from '@/types/common';
import { productFormSchema } from '@/types/admin';
import {
  requireAdmin,
  upsertProduct,
  toggleProductActive,
  deleteProduct,
} from '@/lib/db/admin';

export type ProductActionResult = { ok: true } | { ok: false; error: string };

export async function upsertProductAction(
  formData: FormData,
): Promise<ProductActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const raw = {
    name: formData.get('name'),
    categoryId: formData.get('categoryId'),
    tagline: formData.get('tagline') ?? '',
    description: formData.get('description') ?? '',
    basePrice: Number(formData.get('basePrice') ?? 0),
    hasFrame: formData.get('hasFrame') === 'true',
    isActive: formData.get('isActive') === 'true',
    sortOrder: Number(formData.get('sortOrder') ?? 0),
    bleedMm: Number(formData.get('bleedMm') ?? 0),
  };

  const parsed = productFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? '입력 검증 실패',
    };
  }

  try {
    const idRaw = formData.get('id');
    await upsertProduct({
      ...parsed.data,
      categoryId: asBrand<CategoryId>(parsed.data.categoryId),
      ...(idRaw ? { id: asBrand<ProductId>(idRaw as string) } : {}),
    });
    revalidatePath('/admin/products');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function toggleProductActiveAction(
  id: string,
  active: boolean,
): Promise<void> {
  await requireAdmin();
  await toggleProductActive(asBrand<ProductId>(id), active);
  revalidatePath('/admin/products');
}

export async function deleteProductAction(
  id: string,
): Promise<ProductActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  try {
    await deleteProduct(asBrand<ProductId>(id));
    revalidatePath('/admin/products');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
