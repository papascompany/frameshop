'use server';

import { requireAdmin } from '@/lib/db/admin';
import { upsertLandingSection } from '@/lib/db/landing-sections';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';

type ActionResult = { ok: boolean; error?: string };

const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MIME_TO_EXT: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * 랜딩 섹션 이미지 업로드 + 텍스트 저장.
 *
 * FormData 필드:
 *  - sectionKey   (필수)
 *  - sectionType  (필수)
 *  - sortOrder    (숫자, 기본 0)
 *  - file         (File, 선택 — 없으면 기존 이미지 유지)
 *  - existingImageUrl (이미지 없을 때 현재 URL 보존용)
 *  - payload_*    (payload 하위 필드, 예: payload_eyebrow, payload_headline 등)
 */
export async function upsertLandingSectionAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const sectionKey = formData.get('sectionKey') as string | null;
  const sectionType = formData.get('sectionType') as string | null;
  const sortOrderStr = (formData.get('sortOrder') as string) ?? '0';
  const sortOrder = parseInt(sortOrderStr, 10);

  if (!sectionKey) return { ok: false, error: 'sectionKey는 필수입니다.' };
  if (!sectionType) return { ok: false, error: 'sectionType은 필수입니다.' };

  // payload_* 필드 수집
  const payload: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('payload_')) {
      const fieldName = key.slice('payload_'.length);
      payload[fieldName] = value as string;
    }
  }

  // 이미지 처리
  const supabase = getServiceRoleSupabase();
  let imageUrl: string | null | undefined = undefined; // undefined = 변경 없음

  const imageFile = formData.get('file') as File | null;
  if (imageFile && imageFile.size > 0) {
    if (imageFile.size > MAX_BYTES) {
      return { ok: false, error: '이미지 파일 크기는 20MB를 초과할 수 없습니다.' };
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    let detectedFormat: string | undefined;
    try {
      const meta = await sharp(buf).metadata();
      detectedFormat = meta.format;
    } catch {
      return { ok: false, error: '유효하지 않은 이미지 파일입니다.' };
    }

    if (!detectedFormat || !ALLOWED_SHARP_FORMATS.has(detectedFormat)) {
      return {
        ok: false,
        error: `지원하지 않는 이미지 형식입니다 (jpg, png, webp 만 가능). 감지된 형식: ${detectedFormat ?? 'unknown'}`,
      };
    }

    const ext = MIME_TO_EXT[detectedFormat] ?? 'jpg';
    const contentType =
      detectedFormat === 'png'
        ? 'image/png'
        : detectedFormat === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
    const path = `landing/${sectionKey}/${crypto.randomUUID()}.${ext}`;

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
  } else {
    // 이미지 파일이 없으면 기존 URL 유지 (undefined → DB 업데이트 시 image_url 필드 생략)
    const existingUrl = formData.get('existingImageUrl') as string | null;
    if (existingUrl) {
      imageUrl = existingUrl;
    }
    // existingUrl도 없으면 imageUrl = undefined → upsert에서 image_url 필드 생략
  }

  try {
    await upsertLandingSection({
      sectionKey,
      sectionType,
      sortOrder: isNaN(sortOrder) ? 0 : sortOrder,
      imageUrl,
      payload,
    });

    revalidatePath('/admin/landing');
    revalidatePath('/');

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '저장 실패',
    };
  }
}
