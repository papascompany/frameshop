'use server';

import { requireAdmin } from '@/lib/db/admin';
import { upsertStockPhoto, deleteStockPhoto } from '@/lib/db/stock-photos';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';

type ActionResult = { ok: boolean; error?: string };

/**
 * 명화 이미지 업로드 + DB 등록.
 * FormData: file (File), thumbFile? (File), title, artist?, era?, sortOrder?
 */
export async function upsertArtworkAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const id = (formData.get('id') as string) || undefined;
  const title = formData.get('title') as string;
  const artist = (formData.get('artist') as string) || null;
  const era = (formData.get('era') as string) || null;
  const sortOrder = parseInt((formData.get('sortOrder') as string) ?? '0', 10);
  const imageFile = formData.get('file') as File | null;

  if (!title) return { ok: false, error: '제목은 필수입니다.' };

  const supabase = getServiceRoleSupabase();

  let imageUrl = (formData.get('existingImageUrl') as string) || '';
  let thumbUrl = (formData.get('existingThumbUrl') as string) || '';
  let widthPx = parseInt((formData.get('existingWidthPx') as string) ?? '0', 10);
  let heightPx = parseInt((formData.get('existingHeightPx') as string) ?? '0', 10);

  if (imageFile && imageFile.size > 0) {
    // HIGH-003 FIX: validate file with sharp (magic-byte check) before upload.
    // Never trust the browser-supplied MIME type or filename extension.
    const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp']);
    const MIME_TO_EXT: Record<string, string> = {
      jpeg: 'jpg',
      png:  'png',
      webp: 'webp',
    };
    const MAX_ARTWORK_BYTES = 20 * 1024 * 1024; // 20 MB

    if (imageFile.size > MAX_ARTWORK_BYTES) {
      return { ok: false, error: '이미지 파일 크기는 20MB를 초과할 수 없습니다.' };
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    let detectedFormat: string | undefined;
    let detectedWidth: number | undefined;
    let detectedHeight: number | undefined;
    try {
      const meta = await sharp(buf).metadata();
      detectedFormat = meta.format;
      detectedWidth  = meta.width;
      detectedHeight = meta.height;
    } catch {
      return { ok: false, error: '유효하지 않은 이미지 파일입니다.' };
    }

    if (!detectedFormat || !ALLOWED_SHARP_FORMATS.has(detectedFormat)) {
      return {
        ok: false,
        error: `지원하지 않는 이미지 형식입니다 (jpg, png, webp 만 가능). 감지된 형식: ${detectedFormat ?? 'unknown'}`,
      };
    }

    const ext  = MIME_TO_EXT[detectedFormat] ?? 'jpg';
    const contentType =
      detectedFormat === 'png'  ? 'image/png'  :
      detectedFormat === 'webp' ? 'image/webp' : 'image/jpeg';
    const path = `artworks/${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('marketing')
      .upload(path, buf, { contentType, upsert: false });

    if (uploadErr) {
      return { ok: false, error: `이미지 업로드 실패: ${uploadErr.message}` };
    }

    const { data: urlData } = supabase.storage
      .from('marketing')
      .getPublicUrl(path);
    imageUrl = urlData.publicUrl;
    thumbUrl = urlData.publicUrl; // TODO: generate a resized thumbnail (Phase 2)
    widthPx  = detectedWidth  ?? 1200;
    heightPx = detectedHeight ?? 900;
  }

  if (!imageUrl) return { ok: false, error: '이미지를 업로드해주세요.' };

  try {
    await upsertStockPhoto({
      id,
      title,
      artist,
      era,
      imageUrl,
      thumbUrl,
      widthPx: widthPx || 1200,
      heightPx: heightPx || 900,
      sortOrder: isNaN(sortOrder) ? 0 : sortOrder,
    });
    revalidatePath('/admin/artworks');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '등록 실패' };
  }
}

/**
 * 명화 삭제.
 */
export async function deleteArtworkAction(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  try {
    await deleteStockPhoto(id);
    revalidatePath('/admin/artworks');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '삭제 실패' };
  }
}
