'use server';

/**
 * admin/inquiries 서버 액션 (FS-X-02, ADR-026).
 *
 * 목록 로드는 액션이 아니라 페이지 서버 컴포넌트가 `getAllInquiries` 를 직접
 * 호출한다(X-05). 여기는 답변 등록만 — requireAdmin 이중 게이트 후 상태 전이
 * (OPEN → ANSWERED)와 고객 알림(fire-and-forget)을 수행한다.
 */

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/db/admin';
import { replyToInquiry } from '@/lib/db/inquiries';
import { notifyInquiryReplied } from '@/lib/notify';
import { inquiryReplyInputSchema } from '@/types/inquiry';
import { asBrand } from '@/types/common';
import type { InquiryId } from '@/types/common';

export async function replyInquiryAction(
  id: string,
  replyText: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  const parsed = inquiryReplyInputSchema.safeParse({ reply: replyText });
  if (!parsed.success) {
    return { ok: false, error: '답변 내용을 확인해주세요. (1~2000자)' };
  }

  const { data, error } = await replyToInquiry(
    asBrand<InquiryId>(id),
    parsed.data.reply,
  );
  if (error || !data) {
    return { ok: false, error: error ?? '답변 저장에 실패했습니다.' };
  }

  revalidatePath('/admin/inquiries');

  // Fire-and-forget: 알림 실패가 답변 저장을 되돌리면 안 된다(내부 warn only).
  void notifyInquiryReplied(data.contactEmail, {
    subject: data.subject,
    replyText: parsed.data.reply,
  });

  return { ok: true };
}
