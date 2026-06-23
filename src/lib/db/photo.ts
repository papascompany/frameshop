/**
 * Photo persistence (M-Photo).
 *
 * Anonymous photos (user_id NULL) require service-role insert because RLS
 * blocks anon writes to `photos`.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { PhotoId, SessionId, UserId } from '@/types/common';
import type { ExifMeta, Photo } from '@/types/photo';
import { mapPhoto } from './mappers';
import { getServiceRoleSupabase } from '../supabase/service';

export type CreatePhotoInput = {
  userId: UserId | null;
  sessionId: SessionId | null;
  originalUrl: string;
  thumbUrl: string;
  /** Object key inside the private `photos` bucket — used to regenerate signed URLs. */
  storagePath?: string;
  /** Object key for the thumbnail inside the private `photos` bucket. */
  thumbPath?: string;
  widthPx?: number;
  heightPx?: number;
  exif?: ExifMeta;
};

export async function createPhoto(input: CreatePhotoInput): Promise<Photo> {
  if (!input.userId && !input.sessionId) {
    throw new Error('createPhoto: userId or sessionId required');
  }
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('photos')
    .insert({
      user_id: input.userId as string | null,
      session_id: input.sessionId as string | null,
      original_url: input.originalUrl,
      thumb_url: input.thumbUrl,
      storage_path: input.storagePath ?? null,
      thumb_path: input.thumbPath ?? null,
      width_px: input.widthPx ?? null,
      height_px: input.heightPx ?? null,
      exif: input.exif ?? null,
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(`createPhoto: ${error?.message ?? 'no row'}`);
  }
  return mapPhoto(data);
}

/**
 * Resolve photo ids by their `original_url` (exact match). Used by reorder to
 * recover a valid `photoId` for legacy order items whose snapshot predates
 * `sourcePhotoId` (선결과제 1) — the baked-crop URL stored on the order row IS a
 * `photos.original_url`, so it maps back to that photo's id. Returns a Map keyed
 * by url; urls with no surviving photo row are simply absent.
 */
export async function getPhotoIdsByOriginalUrl(
  urls: string[],
): Promise<Map<string, PhotoId>> {
  const out = new Map<string, PhotoId>();
  const unique = Array.from(new Set(urls.filter((u) => typeof u === 'string' && u.length > 0)));
  if (unique.length === 0) return out;
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('photos')
    .select('id, original_url')
    .in('original_url', unique);
  if (error) throw new Error(`getPhotoIdsByOriginalUrl: ${error.message}`);
  for (const row of (data ?? []) as Array<{ id: string; original_url: string }>) {
    if (!out.has(row.original_url)) out.set(row.original_url, asBrand<PhotoId>(row.id));
  }
  return out;
}
