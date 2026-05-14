/**
 * stock_photos — 명화 이미지 CRUD
 *
 * SELECT: anon 클라이언트 (is_active=true RLS 정책)
 * INSERT/UPDATE/DELETE: 서비스롤 (어드민 전용)
 */

import 'server-only';
import { getAnonSupabase } from '@/lib/supabase/anon';
import { getServiceRoleSupabase } from '@/lib/supabase/service';

export type StockPhoto = {
  id: string;
  title: string;
  artist: string | null;
  era: string | null;
  imageUrl: string;
  thumbUrl: string;
  widthPx: number;
  heightPx: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

type StockPhotoInput = {
  id?: string;
  title: string;
  artist?: string | null;
  era?: string | null;
  imageUrl: string;
  thumbUrl: string;
  widthPx: number;
  heightPx: number;
  isActive?: boolean;
  sortOrder?: number;
};

// ─── 맵퍼 ────────────────────────────────────────────────────────────────────

function mapRow(row: Record<string, unknown>): StockPhoto {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    artist: row['artist'] as string | null,
    era: row['era'] as string | null,
    imageUrl: row['image_url'] as string,
    thumbUrl: row['thumb_url'] as string,
    widthPx: row['width_px'] as number,
    heightPx: row['height_px'] as number,
    isActive: row['is_active'] as boolean,
    sortOrder: row['sort_order'] as number,
    createdAt: row['created_at'] as string,
  };
}

// ─── 공개 조회 ───────────────────────────────────────────────────────────────

export async function getActiveStockPhotos(): Promise<StockPhoto[]> {
  const supabase = getAnonSupabase();
  const { data, error } = await supabase
    .from('stock_photos')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[stock-photos] getActiveStockPhotos error:', error.message);
    return [];
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

// ─── 어드민 전용 ─────────────────────────────────────────────────────────────

export async function getAllStockPhotos(): Promise<StockPhoto[]> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('stock_photos')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[stock-photos] getAllStockPhotos error:', error.message);
    return [];
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function upsertStockPhoto(input: StockPhotoInput): Promise<StockPhoto> {
  const supabase = getServiceRoleSupabase();
  const payload: Record<string, unknown> = {
    title: input.title,
    artist: input.artist ?? null,
    era: input.era ?? null,
    image_url: input.imageUrl,
    thumb_url: input.thumbUrl,
    width_px: input.widthPx,
    height_px: input.heightPx,
    is_active: input.isActive ?? true,
    sort_order: input.sortOrder ?? 0,
  };
  if (input.id) {
    payload['id'] = input.id;
  }

  const { data, error } = await supabase
    .from('stock_photos')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`[stock-photos] upsertStockPhoto failed: ${error?.message ?? 'no data'}`);
  }
  return mapRow(data as Record<string, unknown>);
}

export async function deleteStockPhoto(id: string): Promise<void> {
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from('stock_photos').delete().eq('id', id);
  if (error) {
    throw new Error(`[stock-photos] deleteStockPhoto failed: ${error.message}`);
  }
}
