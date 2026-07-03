/**
 * Wall simulator catalog query (FS-EC-04) — READ ONLY.
 *
 * Returns every active framed product with:
 *  - sizes: one representative variant per sizeCode (같은 sizeCode 중 최저가 1개)
 *  - colors: the product's frame_assets (PNG overlays for the wall canvas)
 *
 * Explicit columns only (no select('*')); rows flow through the shared
 * mappers so branded-ID casting stays at the single chokepoint.
 * Cached like the other catalog reads (300 s, 'products' tag).
 */

import 'server-only';
import { unstable_cache } from 'next/cache';
import type {
  WallCatalogColor,
  WallCatalogProduct,
  WallCatalogSize,
} from '@/lib/wall/catalog';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';
import { mapFrameAsset, mapVariant } from './mappers';
import { getAnonSupabase } from '../supabase/anon';

async function _getWallCatalog(): Promise<WallCatalogProduct[]> {
  const supabase = getAnonSupabase();

  // Active framed products in an active category (P2-06 consistency: the
  // inner join + filter hides products whose parent category is inactive,
  // matching getProductDetail / getProductsByCategory).
  const { data: productRows, error: productError } = await supabase
    .from('products')
    .select('id, name, sort_order, categories!inner(is_active)')
    .eq('is_active', true)
    .eq('has_frame', true)
    .eq('categories.is_active', true)
    .order('sort_order', { ascending: true });

  if (productError) {
    throw new Error(`getWallCatalog products failed: ${productError.message}`);
  }
  const products = (productRows ?? []) as Array<{
    id: string;
    name: string;
    sort_order: number;
  }>;
  if (products.length === 0) return [];

  const ids = products.map((p) => p.id);

  const [variantsRes, framesRes] = await Promise.all([
    supabase
      .from('product_variants')
      .select(
        'id, product_id, size_code, size_label, width_mm, height_mm, color_code, matte_code, paper_code, price, stock, is_active',
      )
      .in('product_id', ids)
      .eq('is_active', true)
      .order('price', { ascending: true }),
    supabase
      .from('frame_assets')
      .select('id, product_id, color_code, color_label, png_url, inner_rect, preview_url')
      .in('product_id', ids),
  ]);

  if (variantsRes.error) {
    throw new Error(`getWallCatalog variants failed: ${variantsRes.error.message}`);
  }
  if (framesRes.error) {
    throw new Error(`getWallCatalog frames failed: ${framesRes.error.message}`);
  }

  const variants = (variantsRes.data ?? []).map(mapVariant);
  const frames = (framesRes.data ?? []).map(mapFrameAsset);

  const catalog: WallCatalogProduct[] = [];
  for (const p of products) {
    const productId = asBrand<ProductId>(p.id);

    // Rows arrive price ASC → first-seen per sizeCode is the cheapest (대표).
    const sizeMap = new Map<string, WallCatalogSize>();
    for (const v of variants) {
      if ((v.productId as string) !== p.id) continue;
      if (sizeMap.has(v.sizeCode)) continue;
      sizeMap.set(v.sizeCode, {
        variantId: v.id,
        sizeCode: v.sizeCode,
        sizeLabel: v.sizeLabel,
        widthMm: v.widthMm,
        heightMm: v.heightMm,
        price: v.price,
      });
    }

    const colorMap = new Map<string, WallCatalogColor>();
    for (const f of frames) {
      if ((f.productId as string) !== p.id) continue;
      if (colorMap.has(f.colorCode)) continue;
      colorMap.set(f.colorCode, {
        code: f.colorCode,
        label: f.colorLabel,
        pngUrl: f.pngUrl,
        previewUrl: f.previewUrl,
      });
    }

    const sizes = [...sizeMap.values()];
    const colors = [...colorMap.values()];
    if (sizes.length === 0 || colors.length === 0) continue; // not placeable

    catalog.push({ productId, name: p.name, sizes, colors });
  }
  return catalog;
}

export const getWallCatalog = unstable_cache(_getWallCatalog, ['wall-catalog'], {
  revalidate: 300,
  tags: ['products'],
});
