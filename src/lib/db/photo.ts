/**
 * Photo persistence (M-Photo).
 *
 * Anonymous photos (user_id NULL) require service-role insert because RLS
 * blocks anon writes to `photos`.
 */

import 'server-only';
import type { SessionId, UserId } from '@/types/common';
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
