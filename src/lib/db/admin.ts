/**
 * Admin server actions (M-Admin). Middleware `requireAdmin()` runs first.
 */

import 'server-only';
import { cache } from 'react';
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

/**
 * Verify the caller is an admin via the Supabase session (JWT app_metadata.role).
 *
 * SECURITY: we intentionally do NOT trust any request header (e.g. a
 * middleware-forwarded `x-fs-admin-*`) as an auth source. Next.js Server
 * Actions are dispatched by action id and can be POSTed to ANY route path,
 * so a request header is attacker-controllable on paths the admin-route
 * middleware branch never processes. Always re-verifying the session here is
 * the only sound model. The check is wrapped in React `cache()` so multiple
 * `requireAdmin()` calls within the same Server request share a single RTT.
 */
export const requireAdmin = cache(async (): Promise<AdminUser> => {
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
});

// ---------- Products ----------

/** Admin-only: all products regardless of is_active, with thumbnail join. */
export async function getAllProductsAdmin(): Promise<(Product & { thumbnail: string | null })[]> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, category_id, name, tagline, description, base_price, has_frame, is_active, sort_order, bleed_mm, created_at, product_images!left(image_url, type, sort_order)',
    )
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getAllProductsAdmin: ${error.message}`);

  type ProductWithImages = {
    id: string;
    category_id: string;
    name: string;
    tagline: string;
    description: string;
    base_price: number;
    has_frame: boolean;
    is_active: boolean;
    sort_order: number;
    bleed_mm?: number | string | null;
    created_at: string;
    product_images?: Array<{ image_url: string; type: string; sort_order: number }>;
  };

  return ((data ?? []) as ProductWithImages[]).map((row) => {
    const thumb = (row.product_images ?? [])
      .filter((img) => img.type === 'thumbnail')
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    return {
      ...mapProduct(row),
      thumbnail: thumb?.image_url ?? null,
    };
  });
}

export async function deleteProduct(id: ProductId): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id as string);
  if (error) throw new Error(`deleteProduct: ${error.message}`);
}

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
    bleed_mm: input.bleedMm,
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
  const updated = 0; // Supabase upsert doesn't distinguish insert vs update; always 0.
  const errors: ImportReport['errors'] = [];

  if (rows.length === 0) {
    return { inserted: 0, updated, skipped: 0, errors };
  }

  const ONCONFLICT = 'product_id,size_code,color_code,matte_code,paper_code';
  const toRow = (row: VariantInput) => ({
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
  });

  // Fast path: a single batched upsert (1 round-trip instead of N).
  const batch = await supabase
    .from('product_variants')
    .upsert(rows.map(toRow), { onConflict: ONCONFLICT });

  if (!batch.error) {
    return { inserted: rows.length, updated, skipped: 0, errors };
  }

  // Slow path: the batch failed (e.g. one bad row aborts the statement).
  // Fall back to per-row upserts so we can attribute the error and still
  // import the valid rows. Only runs on the rare failure case.
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const { error } = await supabase
      .from('product_variants')
      .upsert(toRow(rows[i]!), { onConflict: ONCONFLICT });
    if (error) {
      skipped++;
      errors.push({ row: i + 1, field: 'upsert', message: error.message });
    } else {
      inserted++;
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
