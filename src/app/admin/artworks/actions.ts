'use server';

import { requireAdmin } from '@/lib/db/admin';
import { upsertStockPhoto, deleteStockPhoto } from '@/lib/db/stock-photos';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

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
    const ext = imageFile.name.split('.').pop() ?? 'jpg';
    const path = `artworks/${crypto.randomUUID()}.${ext}`;

    const arrayBuffer = await imageFile.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from('marketing')
      .upload(path, Buffer.from(arrayBuffer), {
        contentType: imageFile.type || 'image/jpeg',
        upsert: false,
      });

    if (uploadErr) {
      return { ok: false, error: `이미지 업로드 실패: ${uploadErr.message}` };
    }

    const { data: urlData } = supabase.storage
      .from('marketing')
      .getPublicUrl(path);
    imageUrl = urlData.publicUrl;
    thumbUrl = urlData.publicUrl; // 실제로는 썸네일 리사이즈 필요, 여기선 동일 URL 사용
    widthPx = 1200;  // 클라이언트에서 전달받거나 sharp로 감지
    heightPx = 900;
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
