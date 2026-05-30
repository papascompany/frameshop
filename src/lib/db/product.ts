/**
 * Product detail + option matrix (M-ProductDetail).
 *
 * RLS allows anon SELECT on product / image / frame / variant tables.
 * getProductDetail and getProductOptions are wrapped with unstable_cache
 * (300 s) to avoid Supabase RTT on repeat visits.
 */

import 'server-only';
import { unstable_cache } from 'next/cache';
import type { ProductId } from '@/types/common';
import {
  variantKey,
  type FrameAsset,
  type MatteCode,
  type OptionMatrix,
  type PaperCode,
  type ProductDetail,
  type ProductImage,
  type ProductVariant,
} from '@/types/product';
import {
  mapFrameAsset,
  mapProduct,
  mapProductImage,
  mapVariant,
} from './mappers';
import { getAnonSupabase } from '../supabase/anon';

async function _getProductDetail(
  id: ProductId,
): Promise<ProductDetail | null> {
  const supabase = getAnonSupabase();

  // P2-06 fix: join `categories.is_active` so direct-URL access to a product
  // whose parent category was deactivated returns null (404). Without this,
  // `getProductsByCategory` would hide the product from listings but the
  // detail page would still render. Keeps consistency across all read paths.
  const { data: productRow, error } = await supabase
    .from('products')
    .select('*, categories!inner(is_active)')
    .eq('id', id as string)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`getProductDetail failed: ${error.message}`);
  }
  if (!productRow) return null;

  // The embedded join is typed as `unknown` on the row; narrow before reading.
  const joinedCategory = (productRow as { categories?: { is_active?: boolean } | null })
    .categories;
  if (!joinedCategory || joinedCategory.is_active !== true) {
    return null;
  }

  const [{ data: imageRows }, { data: frameRows }, { data: variantRows }] =
    await Promise.all([
      supabase
        .from('product_images')
        .select('*')
        .eq('product_id', id as string)
        .order('sort_order', { ascending: true }),
      supabase
        .from('frame_assets')
        .select('*')
        .eq('product_id', id as string),
      supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', id as string)
        .eq('is_active', true)
        .order('price', { ascending: true }),
    ]);

  const product = mapProduct(productRow);

  const images = (imageRows ?? []).map(mapProductImage);
  const frames: FrameAsset[] = (frameRows ?? []).map(mapFrameAsset);
  const variants: ProductVariant[] = (variantRows ?? []).map(mapVariant);

  const grouped = {
    thumbnail: [] as ProductImage[],
    gallery: [] as ProductImage[],
    guide: [] as ProductImage[],
  };
  for (const img of images) grouped[img.type].push(img);

  const startingPrice = variants[0]?.price ?? product.basePrice;
  const defaultVariantId = variants[0]?.id ?? null;

  return {
    product,
    images: grouped,
    frames,
    defaultVariantId,
    startingPrice,
  };
}

export const getProductDetail = unstable_cache(
  _getProductDetail,
  ['product-detail'],
  { revalidate: 300, tags: ['products'] },
);

/**
 * Return every active product id — used by `generateStaticParams` to
 * pre-render product detail pages at build time so cold-start latency is
 * paid by CI, not the user. Cached for 5 minutes (matches detail revalidate).
 */
async function _getActiveProductIds(): Promise<string[]> {
  const supabase = getAnonSupabase();
  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('is_active', true);
  if (error) throw new Error(`getActiveProductIds failed: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}

export const getActiveProductIds = unstable_cache(
  _getActiveProductIds,
  ['active-product-ids'],
  { revalidate: 300, tags: ['products'] },
);

async function _getProductOptions(id: ProductId): Promise<OptionMatrix> {
  const supabase = getAnonSupabase();

  const [{ data: variantRows }, { data: frameRows }] = await Promise.all([
    supabase
      .from('product_variants')
      .select('*')
      .eq('product_id', id as string)
      .eq('is_active', true),
    supabase
      .from('frame_assets')
      .select('color_code, color_label, preview_url')
      .eq('product_id', id as string),
  ]);

  const variants = (variantRows ?? []).map(mapVariant);

  const sizeMap = new Map<string, OptionMatrix['sizes'][number]>();
  const colorMap = new Map<string, OptionMatrix['colors'][number]>();
  const matteMap = new Map<MatteCode, OptionMatrix['mattes'][number]>();
  const paperMap = new Map<PaperCode, OptionMatrix['papers'][number]>();

  const variantsByKey: Record<string, ProductVariant> = {};

  for (const v of variants) {
    if (!sizeMap.has(v.sizeCode)) {
      sizeMap.set(v.sizeCode, {
        code: v.sizeCode,
        label: v.sizeLabel,
        widthMm: v.widthMm,
        heightMm: v.heightMm,
      });
    }
    if (!colorMap.has(v.colorCode)) {
      const frame = (frameRows ?? []).find((f) => f.color_code === v.colorCode);
      colorMap.set(v.colorCode, {
        code: v.colorCode,
        label: frame?.color_label ?? v.colorCode,
        previewUrl: frame?.preview_url ?? null,
      });
    }
    if (!matteMap.has(v.matteCode)) {
      matteMap.set(v.matteCode, {
        code: v.matteCode,
        label: v.matteCode === 'none' ? '없음' : '있음',
      });
    }
    if (!paperMap.has(v.paperCode)) {
      paperMap.set(v.paperCode, {
        code: v.paperCode,
        label:
          v.paperCode === 'glossy'
            ? '유광'
            : v.paperCode === 'matte'
              ? '무광'
              : '파인아트',
      });
    }
    variantsByKey[
      variantKey({
        sizeCode: v.sizeCode,
        colorCode: v.colorCode,
        matteCode: v.matteCode,
        paperCode: v.paperCode,
      })
    ] = v;
  }

  return {
    sizes: [...sizeMap.values()],
    colors: [...colorMap.values()],
    mattes: [...matteMap.values()],
    papers: [...paperMap.values()],
    variantsByKey,
  };
}

export const getProductOptions = unstable_cache(
  _getProductOptions,
  ['product-options'],
  { revalidate: 300, tags: ['products'] },
);
