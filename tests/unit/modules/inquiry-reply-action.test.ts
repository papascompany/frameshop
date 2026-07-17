/**
 * replyInquiryAction (admin/inquiries) — FS-X-02.
 *
 * requireAdmin 이중 게이트(미들웨어와 별개), zod 검증, 상태 전이 위임,
 * 알림 fire-and-forget(실패해도 답변 저장 유지)을 검증한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { InquiryId, UserId } from '@/types/common';
import type { Inquiry } from '@/types/inquiry';

vi.mock('@/lib/db/admin', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/db/inquiries', () => ({
  INQUIRIES_UNAVAILABLE: 'INQUIRIES_UNAVAILABLE',
  replyToInquiry: vi.fn(),
}));

vi.mock('@/lib/notify', () => ({
  notifyInquiryReplied: vi.fn(async () => undefined),
}));

import { replyInquiryAction } from '@/app/admin/inquiries/actions';
import { requireAdmin } from '@/lib/db/admin';
import { replyToInquiry } from '@/lib/db/inquiries';
import { notifyInquiryReplied } from '@/lib/notify';

const requireAdminMock = vi.mocked(requireAdmin);
const replyToInquiryMock = vi.mocked(replyToInquiry);
const notifyMock = vi.mocked(notifyInquiryReplied);

function makeAnswered(): Inquiry {
  return {
    id: asBrand<InquiryId>('inq-1'),
    userId: asBrand<UserId>('user-1'),
    orderId: null,
    productId: null,
    contactEmail: 'customer@example.com',
    category: null,
    subject: '배송 문의',
    body: '언제 오나요?',
    status: 'ANSWERED',
    adminReply: '내일 출고됩니다.',
    answeredAt: '2026-07-17T09:00:00Z',
    createdAt: '2026-07-17T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    id: asBrand<UserId>('admin-1'),
    email: 'admin@example.com',
    role: 'admin',
  });
  replyToInquiryMock.mockResolvedValue({ data: makeAnswered(), error: null });
});

describe('replyInquiryAction', () => {
  it('비관리자(requireAdmin throw)는 DB 접근 전에 거부한다', async () => {
    requireAdminMock.mockRejectedValue(new Error('FORBIDDEN'));

    const result = await replyInquiryAction('inq-1', '답변');
    expect(result.ok).toBe(false);
    expect(replyToInquiryMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('빈 답변은 zod 에서 거부한다(DB 미접근)', async () => {
    const result = await replyInquiryAction('inq-1', '');
    expect(result.ok).toBe(false);
    expect(replyToInquiryMock).not.toHaveBeenCalled();
  });

  it('성공 시 답변 저장 + contact_email 로 알림을 fire-and-forget 한다', async () => {
    const result = await replyInquiryAction('inq-1', '내일 출고됩니다.');
    expect(result).toEqual({ ok: true });

    expect(replyToInquiryMock).toHaveBeenCalledWith('inq-1', '내일 출고됩니다.');
    expect(notifyMock).toHaveBeenCalledWith('customer@example.com', {
      subject: '배송 문의',
      replyText: '내일 출고됩니다.',
    });
  });

  it('DB 실패 시 에러를 반환하고 알림은 보내지 않는다', async () => {
    replyToInquiryMock.mockResolvedValue({ data: null, error: 'replyToInquiry: not found' });

    const result = await replyInquiryAction('inq-404', '답변');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
