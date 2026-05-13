/**
 * Curation queries (M-Landing + M-Admin, ADR-007).
 */

import 'server-only';
import type { CurationDevice, Curation, CurationType } from '@/types/curation';
import { payloadSchemaFor, type PayloadValidation } from '@/types/curation';
import type { ProductListItem } from '@/types/product';
import { mapCuration, mapProductListItem } from './mappers';
import { getServerSupabase } from '../supabase/server';
import { getAnonSupabase } from '../supabase/anon';

export async function getActiveCurations(
  device: CurationDevice,
  now: Date = new Date(),
): Promise<Curation[]> {
  const supabase = await getServerSupabase();
  const isoNow = now.toISOString();

  // device filter: row.device === device || row.device === 'all'.
  // When `device === 'all'`, we return ALL devices (admin / preview path).
  let query = supabase
    .from('curations')
    .select('*')
    .eq('is_active', true)
    .or(`start_at.is.null,start_at.lte.${isoNow}`)
    .or(`end_at.is.null,end_at.gt.${isoNow}`);

  if (device !== 'all') {
    query = query.in('device', [device, 'all']);
  }

  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getActiveCurations: ${error.message}`);
  return (data ?? []).map(mapCuration);
}

// ---------- getCurationProducts ----------

/**
 * ID 배열로 상품 목록을 조회한다 (큐레이션 collection 타입용).
 * 순서는 ids 배열 순서를 따른다.
 */
export async function getCurationProducts(
  ids: string[],
): Promise<ProductListItem[]> {
  if (ids.length === 0) return [];

  const supabase = getAnonSupabase();
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, category_id, name, tagline, description, base_price, has_frame, is_active, sort_order, created_at, product_images(image_url, type, sort_order)',
    )
    .in('id', ids)
    .eq('is_active', true);

  if (error) throw new Error(`getCurationProducts: ${error.message}`);

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

  const rowsById = new Map<string, ProductRow>();
  for (const row of (data ?? []) as ProductRow[]) {
    rowsById.set(row.id, row);
  }

  // ids 순서 유지
  const result: ProductListItem[] = [];
  for (const id of ids) {
    const row = rowsById.get(id);
    if (!row) continue;
    const thumb = (row.product_images ?? [])
      .filter((img) => img.type === 'thumbnail')
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    result.push(
      mapProductListItem({
        ...row,
        thumbnail: thumb?.image_url ?? null,
      }),
    );
  }
  return result;
}

export function validateCurationPayload<T>(
  type: CurationType,
  payload: unknown,
): PayloadValidation<T> {
  const schema = payloadSchemaFor(type);
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, payload: result.data as T };
}
