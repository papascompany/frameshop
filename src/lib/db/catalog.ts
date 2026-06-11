/**
 * Catalog queries (M-Catalog).
 *
 * Read-only. Uses the SSR Supabase client so anon RLS applies.
 * Public `categories` / `products` / `product_images` are world-readable
 * per migration 012.
 *
 * All public read functions are wrapped with `unstable_cache` (300 s /
 * 5 min revalidate) so that repeated navigations within the same deploy
 * hit the Next.js data cache instead of Supabase. Admin mutations call
 * `revalidateTag` to flush relevant entries.
 */

import 'server-only';
import { unstable_cache } from 'next/cache';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@/types/common';
import type { CategoryId } from '@/types/common';
import type {
  CategoryTreeNode,
  ProductListItem,
  ProductListQuery,
  ProductListResult,
} from '@/types/product';
import { mapCategory, mapProductListItem } from './mappers';
import { getAnonSupabase } from '../supabase/anon';

// ---------- Categories ----------

async function _getCategories(): Promise<CategoryTreeNode[]> {
  const supabase = getAnonSupabase();
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name, parent_id, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`getCategories failed: ${error.message}`);
  }

  const flat = (data ?? []).map(mapCategory);
  return buildCategoryTree(flat);
}

export const getCategories = unstable_cache(
  _getCategories,
  ['categories'],
  { revalidate: 300, tags: ['categories'] },
);

function buildCategoryTree(flat: ReturnType<typeof mapCategory>[]): CategoryTreeNode[] {
  const byId = new Map<string, CategoryTreeNode>();
  flat.forEach((c) => byId.set(c.id, { ...c, children: [] }));

  const roots: CategoryTreeNode[] = [];
  for (const node of byId.values()) {
    if (!node.parentId) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(node.parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      // Parent inactive or missing — hide the orphan rather than promoting.
    }
  }
  return roots;
}

// ---------- Products by category ----------

async function _getProductsByCategory(
  slug: string,
  options: ProductListQuery = {},
): Promise<ProductListResult> {
  const page = clamp(options.page ?? 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clamp(
    options.pageSize ?? DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  );

  const supabase = getAnonSupabase();

  const { data: cat } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (!cat) {
    return { items: [], total: 0, hasMore: false, page, pageSize };
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // PERF: `count: 'planned'` uses the Postgres planner's row estimate instead
  // of an exact COUNT(*) full scan on every catalog/landing call. `total`/
  // `hasMore` are pagination hints, so an estimate is acceptable and avoids the
  // count scan dominating the query (esp. the landing call with pageSize=3).
  let query = supabase
    .from('products')
    .select(
      'id, category_id, name, tagline, description, base_price, has_frame, is_active, sort_order, created_at, product_images!left(image_url, type, sort_order)',
      { count: 'planned' },
    )
    .eq('category_id', cat.id as string)
    .eq('is_active', true);

  if (typeof options.hasFrame === 'boolean') {
    query = query.eq('has_frame', options.hasFrame);
  }

  switch (options.sort) {
    case 'priceAsc':
      query = query.order('base_price', { ascending: true });
      break;
    case 'priceDesc':
      query = query.order('base_price', { ascending: false });
      break;
    case 'newest':
      query = query.order('created_at', { ascending: false });
      break;
    default:
      query = query
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
  }

  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) {
    throw new Error(`getProductsByCategory failed: ${error.message}`);
  }

  type ProductRow = {
    id: string;
    category_id: string;
    name: string;
    tagline: string;
    description: string;
    base_price: number;
    has_frame: boolean;
    is_active: boolean;
    sort_order: number;
    created_at: string;
    product_images?: Array<{ image_url: string; type: string; sort_order: number }>;
  };

  const items: ProductListItem[] = ((data ?? []) as ProductRow[]).map((row) => {
    const thumb = (row.product_images ?? [])
      .filter((img) => img.type === 'thumbnail')
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    return mapProductListItem({
      ...row,
      thumbnail: thumb?.image_url ?? null,
    });
  });

  const total = count ?? items.length;
  return {
    items,
    total,
    hasMore: from + items.length < total,
    page,
    pageSize,
  };
}

export const getProductsByCategory = unstable_cache(
  _getProductsByCategory,
  ['products-by-category'],
  { revalidate: 300, tags: ['products', 'categories'] },
);

// ---------- Search ----------

export async function searchProducts(query: string): Promise<ProductListItem[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const escaped = trimmed.replace(/([%_])/g, '\\$1');
  const supabase = getAnonSupabase();

  const { data, error } = await supabase
    .from('products')
    .select(
      'id, category_id, name, tagline, description, base_price, has_frame, is_active, sort_order, created_at, product_images!left(image_url, type, sort_order)',
    )
    .eq('is_active', true)
    .ilike('name', `%${escaped}%`)
    .order('sort_order', { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(`searchProducts failed: ${error.message}`);
  }

  type ProductRow = {
    id: string;
    category_id: string;
    name: string;
    tagline: string;
    description: string;
    base_price: number;
    has_frame: boolean;
    is_active: boolean;
    sort_order: number;
    created_at: string;
    product_images?: Array<{ image_url: string; type: string; sort_order: number }>;
  };

  return ((data ?? []) as ProductRow[]).map((row) => {
    const thumb = (row.product_images ?? [])
      .filter((img) => img.type === 'thumbnail')
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    return mapProductListItem({
      ...row,
      thumbnail: thumb?.image_url ?? null,
    });
  });
}

// ---------- Representative product per category (Landing) ----------

async function _getRepresentativeProducts(
  categoryIds: readonly CategoryId[],
): Promise<Record<string, ProductListItem | null>> {
  if (categoryIds.length === 0) return {};
  const supabase = getAnonSupabase();

  const { data, error } = await supabase
    .from('products')
    .select(
      'id, category_id, name, tagline, description, base_price, has_frame, is_active, sort_order, created_at, product_images!left(image_url, type, sort_order)',
    )
    .eq('is_active', true)
    .in('category_id', categoryIds as unknown as string[])
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`getRepresentativeProducts failed: ${error.message}`);
  }

  type ProductRow = {
    id: string;
    category_id: string;
    name: string;
    tagline: string;
    description: string;
    base_price: number;
    has_frame: boolean;
    is_active: boolean;
    sort_order: number;
    created_at: string;
    product_images?: Array<{ image_url: string; type: string; sort_order: number }>;
  };

  const map: Record<string, ProductListItem | null> = {};
  for (const id of categoryIds) map[id as string] = null;

  for (const row of (data ?? []) as ProductRow[]) {
    const key = row.category_id;
    if (map[key]) continue; // first wins (sort_order ASC)
    const thumb = (row.product_images ?? [])
      .filter((img) => img.type === 'thumbnail')
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    map[key] = mapProductListItem({
      ...row,
      thumbnail: thumb?.image_url ?? null,
    });
  }
  return map;
}

export const getRepresentativeProducts = unstable_cache(
  _getRepresentativeProducts,
  ['representative-products'],
  { revalidate: 300, tags: ['products', 'categories'] },
);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
