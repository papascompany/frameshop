/**
 * Admin server actions (M-Admin). Middleware `requireAdmin()` runs first.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type {
  CurationId,
  FrameAssetId,
  ProductId,
  UserId,
} from '@/types/common';
import type {
  AdminUser,
  CurationInput,
  FrameAssetInput,
  ImportReport,
  ProductFormInput,
  VariantInput,
} from '@/types/admin';
import type { FrameAsset, Product } from '@/types/product';
import type { Curation } from '@/types/curation';
import {
  mapCuration,
  mapFrameAsset,
  mapProduct,
} from './mappers';
import { getServerSupabase } from '../supabase/server';
import { getServiceRoleSupabase } from '../supabase/service';

export async function requireAdmin(): Promise<AdminUser> {
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('UNAUTHENTICATED');
  const role = (user.app_metadata as { role?: string } | null)?.role;
  if (role !== 'admin') throw new Error('FORBIDDEN');
  return {
    id: asBrand<UserId>(user.id),
    email: user.email ?? '',
    role: 'admin',
  };
}

// ---------- Products ----------

export async function upsertProduct(input: ProductFormInput & { id?: ProductId }): Promise<Product> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const row = {
    category_id: input.categoryId as string,
    name: input.name,
    tagline: input.tagline,
    description: input.description,
    base_price: input.basePrice,
    has_frame: input.hasFrame,
    is_active: input.isActive,
    sort_order: input.sortOrder,
  };
  const result = input.id
    ? await supabase.from('products').update(row).eq('id', input.id as string).select().single()
    : await supabase.from('products').insert(row).select().single();
  if (result.error || !result.data) {
    throw new Error(`upsertProduct: ${result.error?.message}`);
  }
  return mapProduct(result.data);
}

export async function toggleProductActive(
  id: ProductId,
  active: boolean,
): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('products')
    .update({ is_active: active })
    .eq('id', id as string);
  if (error) throw new Error(`toggleProductActive: ${error.message}`);
}

// ---------- Frame assets ----------

export async function upsertFrameAsset(
  input: FrameAssetInput & { id?: FrameAssetId },
): Promise<FrameAsset> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const row = {
    product_id: input.productId as string,
    color_code: input.colorCode,
    color_label: input.colorLabel,
    png_url: input.pngUrl,
    inner_rect: input.innerRect,
    preview_url: input.previewUrl,
  };
  const result = input.id
    ? await supabase.from('frame_assets').update(row).eq('id', input.id as string).select().single()
    : await supabase.from('frame_assets').upsert(row, { onConflict: 'product_id,color_code' }).select().single();
  if (result.error || !result.data) {
    throw new Error(`upsertFrameAsset: ${result.error?.message}`);
  }
  return mapFrameAsset(result.data);
}

// ---------- Variants (CSV import) ----------

export async function importVariants(
  productId: ProductId,
  rows: VariantInput[],
): Promise<ImportReport> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: ImportReport['errors'] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const { error } = await supabase
      .from('product_variants')
      .upsert(
        {
          product_id: productId as string,
          size_code: row.sizeCode,
          size_label: row.sizeLabel,
          width_mm: row.widthMm,
          height_mm: row.heightMm,
          color_code: row.colorCode,
          matte_code: row.matteCode,
          paper_code: row.paperCode,
          price: row.price,
          stock: row.stock,
          is_active: row.isActive,
        },
        { onConflict: 'product_id,size_code,color_code,matte_code,paper_code' },
      );
    if (error) {
      skipped++;
      errors.push({ row: i + 1, field: 'upsert', message: error.message });
    } else {
      inserted++; // Supabase doesn't distinguish insert vs update on upsert in JS client; count as inserted.
    }
  }
  return { inserted, updated, skipped, errors };
}

// ---------- Curations ----------

export async function upsertCuration(
  input: CurationInput & { id?: CurationId },
): Promise<Curation> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const row = {
    type: input.type,
    title: input.title,
    payload: input.payload,
    device: input.device,
    start_at: input.startAt,
    end_at: input.endAt,
    is_active: input.isActive,
    sort_order: input.sortOrder,
  };
  const result = input.id
    ? await supabase.from('curations').update(row).eq('id', input.id as string).select().single()
    : await supabase.from('curations').insert(row).select().single();
  if (result.error || !result.data) {
    throw new Error(`upsertCuration: ${result.error?.message}`);
  }
  return mapCuration(result.data);
}

export async function deleteCuration(id: CurationId): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('curations')
    .delete()
    .eq('id', id as string);
  if (error) throw new Error(`deleteCuration: ${error.message}`);
}
