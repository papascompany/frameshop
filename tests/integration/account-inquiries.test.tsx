/**
 * <InquiriesClient> + <InquiryFormClient> — FS-X-06 1:1 문의 마이페이지.
 *
 * 고정하는 계약:
 *  1. 목록: 상태 배지(OPEN=답변 대기/ANSWERED=답변 완료/CLOSED=종료),
 *     답변(adminReply)이 있으면 본문 아래 표시.
 *  2. available=false 면 안내만(probe 게이트).
 *  3. 폼: 클라 검증(제목/본문/이메일) — 실패 시 fetch 미호출.
 *  4. 폼: 세션 이메일 기본값 + productId 프리필이 POST payload 에 포함,
 *     성공 시 목록으로 이동.
 *  5. 429(5건/시간) → 레이트리밋 안내 노출.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InquiriesClient } from '@/app/(shop)/account/inquiries/InquiriesClient';
import { InquiryFormClient } from '@/app/(shop)/account/inquiries/new/InquiryFormClient';
import koMessages from '@/messages/ko.json';
import { asBrand } from '@/types/common';
import type { InquiryId } from '@/types/common';
import type { Inquiry, InquiryStatus } from '@/types/inquiry';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/account/inquiries/new',
}));

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function inquiry(
  id: string,
  status: InquiryStatus,
  adminReply: string | null = null,
): Inquiry {
  return {
    id: asBrand<InquiryId>(id),
    userId: null,
    orderId: null,
    productId: null,
    contactEmail: 'me@example.com',
    category: '배송',
    subject: `문의 ${id}`,
    body: '본문입니다.',
    status,
    adminReply,
    answeredAt: adminReply ? '2026-07-17T02:00:00Z' : null,
    createdAt: '2026-07-16T09:00:00Z',
  };
}

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockReset();
});

describe('<InquiriesClient>', () => {
  it('상태 배지와 답변 본문을 렌더한다', () => {
    render(
      withIntl(
        <InquiriesClient
          available
          inquiries={[
            inquiry('q1', 'OPEN'),
            inquiry('q2', 'ANSWERED', '확인 후 교환 처리해 드리겠습니다.'),
            inquiry('q3', 'CLOSED'),
          ]}
        />,
      ),
    );

    expect(screen.getByText('답변 대기')).toBeInTheDocument();
    expect(screen.getByText('답변 완료')).toBeInTheDocument();
    expect(screen.getByText('종료')).toBeInTheDocument();

    // 답변은 ANSWERED 건에만 표시된다.
    const replies = screen.getAllByTestId('inquiry-reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toHaveTextContent('확인 후 교환 처리해 드리겠습니다.');

    // 작성 진입 링크.
    expect(screen.getByTestId('inquiry-new-link')).toHaveAttribute(
      'href',
      '/account/inquiries/new',
    );
  });

  it('available=false 면 안내만 렌더한다(probe 게이트)', () => {
    render(withIntl(<InquiriesClient available={false} inquiries={[]} />));
    expect(
      screen.getByText(/1:1 문의 기능이 아직 활성화되지 않았습니다/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('inquiry-new-link')).not.toBeInTheDocument();
  });
});

describe('<InquiryFormClient>', () => {
  it('제목/본문 미입력이면 검증 에러를 보이고 fetch 를 호출하지 않는다', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      withIntl(
        <InquiryFormClient
          defaultEmail="me@example.com"
          productId={null}
          orderId={null}
        />,
      ),
    );

    fireEvent.click(screen.getByTestId('inquiry-submit'));
    expect(screen.getByText('제목을 입력해 주세요.')).toBeInTheDocument();
    expect(screen.getByText('문의 내용을 입력해 주세요.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('세션 이메일 기본값 + productId 프리필로 POST 하고 성공 시 목록으로 이동한다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, inquiry: {} }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      withIntl(
        <InquiryFormClient
          defaultEmail="me@example.com"
          productId={PRODUCT_ID}
          orderId={null}
        />,
      ),
    );

    // 프리필 안내 + 이메일 기본값.
    expect(screen.getByTestId('inquiry-product-ref')).toBeInTheDocument();
    expect(screen.getByTestId('inquiry-email')).toHaveValue('me@example.com');

    fireEvent.change(screen.getByTestId('inquiry-subject'), {
      target: { value: '배송 문의' },
    });
    fireEvent.change(screen.getByTestId('inquiry-body'), {
      target: { value: '언제 도착하나요?' },
    });
    fireEvent.click(screen.getByTestId('inquiry-submit'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/account/inquiries');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      subject: '배송 문의',
      body: '언제 도착하나요?',
      contactEmail: 'me@example.com',
      productId: PRODUCT_ID,
    });

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith('/account/inquiries'),
    );
  });

  it('429(레이트리밋)면 5건/시간 안내를 노출하고 이동하지 않는다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, code: 'RATE_LIMITED' }, 429),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      withIntl(
        <InquiryFormClient
          defaultEmail="me@example.com"
          productId={null}
          orderId={null}
        />,
      ),
    );

    fireEvent.change(screen.getByTestId('inquiry-subject'), {
      target: { value: '제목' },
    });
    fireEvent.change(screen.getByTestId('inquiry-body'), {
      target: { value: '본문' },
    });
    fireEvent.click(screen.getByTestId('inquiry-submit'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        '문의는 1시간에 5건까지 등록할 수 있습니다',
      ),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('이메일 형식이 틀리면 검증 에러를 보인다', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      withIntl(
        <InquiryFormClient defaultEmail="" productId={null} orderId={null} />,
      ),
    );

    fireEvent.change(screen.getByTestId('inquiry-subject'), {
      target: { value: '제목' },
    });
    fireEvent.change(screen.getByTestId('inquiry-body'), {
      target: { value: '본문' },
    });
    fireEvent.change(screen.getByTestId('inquiry-email'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByTestId('inquiry-submit'));

    expect(
      screen.getByText('올바른 이메일 주소를 입력해 주세요.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
