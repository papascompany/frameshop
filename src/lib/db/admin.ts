/**
 * Admin server actions (M-Admin). Middleware `requireAdmin()` runs first.
 */

import 'server-only';
import { cache } from 'react';
import { asBrand } from '@/types/common';
import type {
  BundleRuleId,
  CategoryId,
  CurationId,
  FrameAssetId,
  ProductId,
  SetTemplateId,
  UserId,
} from '@/types/common';
import type {
  AdminUser,
  CategoryFormInput,
  CurationInput,
  FrameAssetInput,
  ImportReport,
  ProductFormInput,
  VariantInput,
} from '@/types/admin';
import type {
  Category,
  CategoryTreeNode,
  FrameAsset,
  Product,
  ProductType,
  ProductVariant,
} from '@/types/product';
import type { Orientation } from '@/types/project';
import type {
  BundleRule,
  BundleRuleInput,
  PricingStrategy,
  SetTemplate,
  SetTemplateInput,
  SetTemplateSlot,
} from '@/types/set';
import type { Curation } from '@/types/curation';
import {
  mapCategory,
  mapCuration,
  mapFrameAsset,
  mapProduct,
  mapVariant,
} from './mappers';
import { getCategories } from './catalog';
import {
  isBundleRulesAvailable,
  isSetTemplatesAvailable,
} from './feature-probe';
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
    // ADR-026 (FS-X-03): 미지정 시 컬럼 자체를 보내지 않는다 — INSERT 는 DB
    // DEFAULT('single'), UPDATE 는 기존값 유지. 명시 지정 시에만 승격/전환 update.
    ...(input.productType != null ? { product_type: input.productType } : {}),
  };
  const result = input.id
    ? await supabase.from('products').update(row).eq('id', input.id as string).select().single()
    : await supabase.from('products').insert(row).select().single();
  if (result.error || !result.data) {
    throw new Error(`upsertProduct: ${result.error?.message}`);
  }
  return mapProduct(result.data);
}

/**
 * product_type 전환(single ↔ extended) — `toggleProductActive` 패턴의 표적 update.
 * 비파괴: 다른 컬럼은 건드리지 않는다. extended→single 다운그레이드의 사전 조건
 * (세트/규칙 부재)은 액션 계층(promoteProductTypeAction)이 검증한다.
 */
export async function setProductType(
  id: ProductId,
  productType: ProductType,
): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('products')
    .update({ product_type: productType })
    .eq('id', id as string);
  if (error) throw new Error(`setProductType: ${error.message}`);
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

// ---------- Categories (상품 라인) ----------

/** Admin-only: ALL categories (incl. inactive), flat, ordered by sort_order. */
export async function getAllCategoriesAdmin(): Promise<Category[]> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name, parent_id, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getAllCategoriesAdmin: ${error.message}`);
  return (data ?? []).map(mapCategory);
}

export async function upsertCategory(
  input: CategoryFormInput & { id?: CategoryId },
): Promise<Category> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const row = {
    slug: input.slug,
    name: input.name,
    parent_id: (input.parentId ?? null) as string | null,
    sort_order: input.sortOrder,
    is_active: input.isActive,
  };
  const result = input.id
    ? await supabase.from('categories').update(row).eq('id', input.id as string).select().single()
    : await supabase.from('categories').insert(row).select().single();
  if (result.error || !result.data) {
    throw new Error(`upsertCategory: ${result.error?.message ?? 'no row'}`);
  }
  return mapCategory(result.data);
}

export async function toggleCategoryActive(
  id: CategoryId,
  active: boolean,
): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('categories')
    .update({ is_active: active })
    .eq('id', id as string);
  if (error) throw new Error(`toggleCategoryActive: ${error.message}`);
}

export async function deleteCategory(id: CategoryId): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id as string);
  if (error) {
    // products.category_id REFERENCES categories ON DELETE RESTRICT — a category
    // that still has products cannot be deleted. Surface a friendly message.
    if (/foreign key|violates|23503/i.test(error.message)) {
      throw new Error('이 카테고리에 속한 상품이 있어 삭제할 수 없습니다. 비활성화를 사용하세요.');
    }
    throw new Error(`deleteCategory: ${error.message}`);
  }
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

// ---------- Set templates / Bundle rules (ADR-026, FS-X-03) ----------
//
// migrations 036/037. 쓰기는 RLS 상 service-role 전용이며, 호출 경로는 전부
// requireAdmin 을 통과한 어드민 서버 액션/페이지다(액션 계층에서도 재검증 —
// 이 함수들도 방어적으로 requireAdmin 을 먼저 호출한다, 파일 공통 패턴).
// 테이블 미적용(probe false) 시 호출부가 게이트하므로 42P01 이 UI 로 새지 않는다.

const SET_TEMPLATE_COLUMNS =
  'id, product_id, name, slots, wall_w_mm, wall_h_mm, set_price, set_discount_bps, is_active, created_at';

type SetTemplateRow = {
  id: string;
  product_id: string;
  /** jsonb — 쓰기가 전부 setTemplateInputSchema 를 통과하므로 형태를 신뢰한다. */
  slots: SetTemplateSlot[];
  name: string;
  wall_w_mm: number | null;
  wall_h_mm: number | null;
  set_price: number | null;
  set_discount_bps: number | null;
  is_active: boolean;
  created_at: string;
};

const mapSetTemplate = (row: SetTemplateRow): SetTemplate => ({
  id: asBrand<SetTemplateId>(row.id),
  productId: asBrand<ProductId>(row.product_id),
  name: row.name,
  slots: Array.isArray(row.slots) ? row.slots : [],
  wallWMm: row.wall_w_mm,
  wallHMm: row.wall_h_mm,
  setPrice: row.set_price,
  setDiscountBps: row.set_discount_bps,
  isActive: row.is_active,
  createdAt: row.created_at,
});

/** Admin-only: 상품의 모든 세트 템플릿(비활성 포함), 생성순. */
export async function listSetTemplates(productId: ProductId): Promise<SetTemplate[]> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('set_templates')
    .select(SET_TEMPLATE_COLUMNS)
    .eq('product_id', productId as string)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listSetTemplates: ${error.message}`);
  return ((data ?? []) as SetTemplateRow[]).map(mapSetTemplate);
}

/** id 없음 = 생성(insert), 있음 = 수정(update) — upsertProduct 패턴. */
export async function upsertSetTemplate(
  input: SetTemplateInput & { id?: SetTemplateId },
): Promise<SetTemplate> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const row = {
    product_id: input.productId,
    name: input.name,
    slots: input.slots,
    wall_w_mm: input.wallWMm ?? null,
    wall_h_mm: input.wallHMm ?? null,
    set_price: input.setPrice ?? null,
    set_discount_bps: input.setDiscountBps ?? null,
    is_active: input.isActive ?? true,
  };
  const result = input.id
    ? await supabase
        .from('set_templates')
        .update(row)
        .eq('id', input.id as string)
        .select(SET_TEMPLATE_COLUMNS)
        .single()
    : await supabase
        .from('set_templates')
        .insert(row)
        .select(SET_TEMPLATE_COLUMNS)
        .single();
  if (result.error || !result.data) {
    throw new Error(`upsertSetTemplate: ${result.error?.message ?? 'no row'}`);
  }
  return mapSetTemplate(result.data as SetTemplateRow);
}

export async function deleteSetTemplate(id: SetTemplateId): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('set_templates')
    .delete()
    .eq('id', id as string);
  if (error) throw new Error(`deleteSetTemplate: ${error.message}`);
}

export async function toggleSetTemplateActive(
  id: SetTemplateId,
  active: boolean,
): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('set_templates')
    .update({ is_active: active })
    .eq('id', id as string);
  if (error) throw new Error(`toggleSetTemplateActive: ${error.message}`);
}

const BUNDLE_RULE_COLUMNS =
  'id, product_id, min_slots, max_slots, allowed_size_codes, allowed_orientations, allow_size_mix, allow_orientation_mix, allow_photo_reuse, pricing_strategy, discount_bps, flat_price, is_active, created_at';

type BundleRuleRow = {
  id: string;
  product_id: string;
  min_slots: number;
  max_slots: number;
  allowed_size_codes: string[] | null;
  allowed_orientations: string[] | null;
  allow_size_mix: boolean;
  allow_orientation_mix: boolean;
  allow_photo_reuse: boolean;
  pricing_strategy: string;
  discount_bps: number | null;
  flat_price: number | null;
  is_active: boolean;
  created_at: string;
};

const mapBundleRule = (row: BundleRuleRow): BundleRule => ({
  id: asBrand<BundleRuleId>(row.id),
  productId: asBrand<ProductId>(row.product_id),
  minSlots: row.min_slots,
  maxSlots: row.max_slots,
  allowedSizeCodes: row.allowed_size_codes ?? [],
  // text[] 컬럼 — 예상 외 값은 버린다(DB CHECK 는 없고 앱 zod 가 쓰기를 막지만 방어적).
  allowedOrientations: (row.allowed_orientations ?? []).filter(
    (o): o is Orientation => o === 'landscape' || o === 'portrait',
  ),
  allowSizeMix: row.allow_size_mix,
  allowOrientationMix: row.allow_orientation_mix,
  allowPhotoReuse: row.allow_photo_reuse,
  pricingStrategy: row.pricing_strategy as PricingStrategy,
  discountBps: row.discount_bps,
  flatPrice: row.flat_price,
  isActive: row.is_active,
  createdAt: row.created_at,
});

/** 상품 1:1 규칙 조회 — 없으면 null. */
export async function getBundleRule(productId: ProductId): Promise<BundleRule | null> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('bundle_rules')
    .select(BUNDLE_RULE_COLUMNS)
    .eq('product_id', productId as string)
    .maybeSingle();
  if (error) throw new Error(`getBundleRule: ${error.message}`);
  return data ? mapBundleRule(data as BundleRuleRow) : null;
}

/**
 * 상품 1:1 규칙 upsert — product_id UNIQUE 를 충돌 키로 쓰는
 * `upsertFrameAsset` 패턴(onConflict). id 를 몰라도 항상 안전하다.
 */
export async function upsertBundleRule(input: BundleRuleInput): Promise<BundleRule> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();
  const row = {
    product_id: input.productId,
    min_slots: input.minSlots,
    max_slots: input.maxSlots,
    allowed_size_codes: input.allowedSizeCodes,
    allowed_orientations: input.allowedOrientations,
    allow_size_mix: input.allowSizeMix,
    allow_orientation_mix: input.allowOrientationMix,
    allow_photo_reuse: input.allowPhotoReuse,
    pricing_strategy: input.pricingStrategy,
    discount_bps: input.discountBps ?? null,
    flat_price: input.flatPrice ?? null,
    is_active: input.isActive ?? true,
  };
  const result = await supabase
    .from('bundle_rules')
    .upsert(row, { onConflict: 'product_id' })
    .select(BUNDLE_RULE_COLUMNS)
    .single();
  if (result.error || !result.data) {
    throw new Error(`upsertBundleRule: ${result.error?.message ?? 'no row'}`);
  }
  return mapBundleRule(result.data as BundleRuleRow);
}

// ---------- Product workspace loader (FS-X-03, page 로더 이동) ----------
//
// /admin/products/[id] 페이지에 인라인돼 있던 raw getServiceRoleSupabase 로더를
// server-only DB 계층으로 이동한다 — page 서버 컴포넌트는 이 함수만 호출한다.
// probe 게이트(036/037 미적용 시 42P01 방지)와 requireAdmin 방어를 함께 캡슐화.

async function loadWorkspaceProduct(id: string): Promise<Product | null> {
  const supabase = getServiceRoleSupabase();
  // products 는 select('*') 기존 예외 유지 — product_type(034) 미적용 DB 에서도
  // 명시 컬럼 42703 없이 동작하고, mapProduct 가 'single' 로 폴백한다.
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`loadWorkspaceProduct: ${error.message}`);
  return data ? mapProduct(data) : null;
}

async function loadWorkspaceFrames(productId: string): Promise<FrameAsset[]> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('frame_assets')
    .select('id, product_id, color_code, color_label, png_url, inner_rect, preview_url')
    .eq('product_id', productId)
    .order('color_code', { ascending: true });
  if (error) throw new Error(`loadWorkspaceFrames: ${error.message}`);
  return (data ?? []).map(mapFrameAsset);
}

async function loadWorkspaceVariants(productId: string): Promise<ProductVariant[]> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('product_variants')
    .select(
      'id, product_id, size_code, size_label, width_mm, height_mm, color_code, matte_code, paper_code, price, stock, is_active',
    )
    .eq('product_id', productId)
    .order('size_code', { ascending: true })
    .order('color_code', { ascending: true })
    .order('matte_code', { ascending: true })
    .order('paper_code', { ascending: true });
  if (error) throw new Error(`loadWorkspaceVariants: ${error.message}`);
  return (data ?? []).map(mapVariant);
}

export type ProductWorkspaceData = {
  product: Product;
  categories: CategoryTreeNode[];
  frames: FrameAsset[];
  variants: ProductVariant[];
  setTemplates: SetTemplate[];
  bundleRule: BundleRule | null;
  setTemplatesAvailable: boolean;
  bundleRulesAvailable: boolean;
};

/**
 * 상품 워크스페이스 전체 로드. 상품/카테고리/프레임/변형 + probe 를 병렬로 읽고,
 * 상품 부재면 null(page 는 notFound). probe 통과 시에만 세트/규칙을 이어서
 * 병렬 로드한다(미적용 42P01 방지 — 기존 page 게이트와 동일 계약).
 */
export async function getProductWorkspaceData(
  productId: ProductId,
): Promise<ProductWorkspaceData | null> {
  await requireAdmin();

  const id = productId as string;
  const [
    product,
    categories,
    frames,
    variants,
    setTemplatesAvailable,
    bundleRulesAvailable,
  ] = await Promise.all([
    loadWorkspaceProduct(id),
    getCategories(),
    loadWorkspaceFrames(id),
    loadWorkspaceVariants(id),
    isSetTemplatesAvailable(),
    isBundleRulesAvailable(),
  ]);

  if (!product) return null;

  const [setTemplates, bundleRule] = await Promise.all([
    setTemplatesAvailable ? listSetTemplates(product.id) : Promise.resolve([]),
    bundleRulesAvailable ? getBundleRule(product.id) : Promise.resolve(null),
  ]);

  return {
    product,
    categories,
    frames,
    variants,
    setTemplates,
    bundleRule,
    setTemplatesAvailable,
    bundleRulesAvailable,
  };
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
