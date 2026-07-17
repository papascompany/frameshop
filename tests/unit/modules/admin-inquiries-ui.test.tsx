/**
 * InquiriesClient — 1:1 문의 관리 UI (FS-X-05).
 *
 * 고정하는 계약:
 *  1. 목록 행: 제목/카테고리/상태 배지/작성일. 행 클릭으로 펼침(본문·연락
 *     이메일·주문/상품 링크·답변 폼).
 *  2. 답변 제출 성공 → 낙관 업데이트: 새로고침 없이 상태 배지가 '답변완료'로
 *     바뀌고 답변 본문이 표시된다(X-02 replyInquiryAction 소비).
 *  3. 실패 → 에러 인라인 노출 + 상태 유지.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { InquiryId, OrderId, ProductId, UserId } from '@/types/common';
import type { Inquiry } from '@/types/inquiry';

vi.mock('@/app/admin/inquiries/actions', () => ({
  replyInquiryAction: vi.fn(),
}));

import {
  InquiriesClient,
  inquiryStatusBadge,
} from '@/app/admin/inquiries/InquiriesClient';
import { replyInquiryAction } from '@/app/admin/inquiries/actions';

const replyMock = vi.mocked(replyInquiryAction);

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: asBrand<InquiryId>('inq-1'),
    userId: asBrand<UserId>('user-1'),
    orderId: null,
    productId: null,
    contactEmail: 'customer@example.com',
    category: '배송',
    subject: '배송이 언제 되나요?',
    body: '지난주에 주문했는데 아직 안 왔어요.',
    status: 'OPEN',
    adminReply: null,
    answeredAt: null,
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inquiryStatusBadge (순수)', () => {
  it('상태별 라벨/변형 매핑', () => {
    expect(inquiryStatusBadge('OPEN')).toEqual({
      label: '답변대기',
      variant: 'warning',
    });
    expect(inquiryStatusBadge('ANSWERED')).toEqual({
      label: '답변완료',
      variant: 'success',
    });
    expect(inquiryStatusBadge('CLOSED')).toEqual({
      label: '종료',
      variant: 'default',
    });
  });
});

describe('InquiriesClient', () => {
  it('목록 행(제목/카테고리/상태) + 펼침(본문/이메일/링크)을 렌더한다', () => {
    render(
      <InquiriesClient
        inquiries={[
          makeInquiry({
            orderId: asBrand<OrderId>('order-9'),
            productId: asBrand<ProductId>('prod-3'),
          }),
        ]}
      />,
    );

    expect(screen.getByText('배송이 언제 되나요?')).toBeInTheDocument();
    expect(screen.getByText('답변대기')).toBeInTheDocument();

    // 펼침 전에는 본문 비노출.
    expect(
      screen.queryByText('지난주에 주문했는데 아직 안 왔어요.'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inquiry-row-toggle'));

    expect(
      screen.getByText('지난주에 주문했는데 아직 안 왔어요.'),
    ).toBeInTheDocument();
    expect(screen.getByText('customer@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '관련 주문 보기' })).toHaveAttribute(
      'href',
      '/admin/orders/order-9',
    );
    expect(screen.getByRole('link', { name: '관련 상품 보기' })).toHaveAttribute(
      'href',
      '/admin/products/prod-3',
    );
  });

  it('답변 제출 성공 → 낙관 업데이트(배지 답변완료 + 답변 본문 표시)', async () => {
    replyMock.mockResolvedValue({ ok: true });
    render(<InquiriesClient inquiries={[makeInquiry()]} />);

    fireEvent.click(screen.getByTestId('inquiry-row-toggle'));
    fireEvent.change(screen.getByLabelText('답변 작성'), {
      target: { value: '내일 출고 예정입니다.' },
    });
    fireEvent.click(screen.getByRole('button', { name: '답변 등록' }));

    await waitFor(() => {
      expect(screen.getByText('답변완료')).toBeInTheDocument();
    });
    expect(replyMock).toHaveBeenCalledWith('inq-1', '내일 출고 예정입니다.');
    expect(screen.getByText('내일 출고 예정입니다.')).toBeInTheDocument();
    expect(screen.queryByText('답변대기')).not.toBeInTheDocument();
  });

  it('답변 제출 실패 → 에러 인라인 노출 + 상태 유지', async () => {
    replyMock.mockResolvedValue({ ok: false, error: '답변 저장에 실패했습니다.' });
    render(<InquiriesClient inquiries={[makeInquiry()]} />);

    fireEvent.click(screen.getByTestId('inquiry-row-toggle'));
    fireEvent.change(screen.getByLabelText('답변 작성'), {
      target: { value: '답변입니다.' },
    });
    fireEvent.click(screen.getByRole('button', { name: '답변 등록' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '답변 저장에 실패했습니다.',
      );
    });
    expect(screen.getByText('답변대기')).toBeInTheDocument();
  });

  it('빈 답변은 제출하지 않는다(액션 미호출)', async () => {
    render(<InquiriesClient inquiries={[makeInquiry()]} />);

    fireEvent.click(screen.getByTestId('inquiry-row-toggle'));
    fireEvent.click(screen.getByRole('button', { name: '답변 등록' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '답변 내용을 입력해주세요.',
      );
    });
    expect(replyMock).not.toHaveBeenCalled();
  });
});
