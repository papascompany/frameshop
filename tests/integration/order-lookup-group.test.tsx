/**
 * <OrderLookupClient> 묶음 그룹 렌더 + 할인 분해 표시 (FS-X-04).
 *
 * 고정하는 계약:
 *  1. groupLabel 이 있는 항목은 groupOrderByGroupId 로 그룹 카드(헤더: 라벨·
 *     구성 칩·그룹 소계 + 라인 행) 렌더, 없는 항목은 기존 평면 행 그대로.
 *  2. couponDiscount/pointsRedeemed > 0 이면 합계 분해 행 표시, 0/부재면 비표시.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import koMessages from '@/messages/ko.json';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

import { OrderLookupClient } from '@/app/(shop)/order/lookup/OrderLookupClient';

type LookupResponseBody = Record<string, unknown>;

function baseResult(): LookupResponseBody {
  return {
    orderNo: '20260717-0001',
    status: 'PAID',
    createdAt: '2026-07-17T00:00:00.000Z',
    orderer: { name: '홍길동' },
    shipping: { name: '홍길동', zip: '06236', addr1: '서울 강남구', addr2: '' },
    totalPrice: 20_000,
    shippingFee: 3_000,
    trackingNumber: null,
    courier: null,
    items: [],
  };
}

let responseBody: LookupResponseBody = baseResult();

beforeEach(() => {
  responseBody = baseResult();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function lookupViaUi(): Promise<void> {
  render(
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      <OrderLookupClient />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('주문번호'), {
    target: { value: '20260717-0001' },
  });
  fireEvent.change(screen.getByLabelText('전화번호'), {
    target: { value: '01012345678' },
  });
  fireEvent.click(screen.getByRole('button', { name: '조회' }));
  await screen.findByText(/주문번호: 20260717-0001/);
}

describe('<OrderLookupClient> 묶음 그룹 + 할인 분해 (FS-X-04)', () => {
  it('groupLabel 항목은 그룹 카드로, 단품은 평면 행으로 렌더된다', async () => {
    responseBody = {
      ...baseResult(),
      items: [
        {
          id: 'oi-1',
          productName: '클래식 프레임',
          sizeLabel: '4×6',
          colorLabel: '블랙',
          quantity: 1,
          price: 10_000,
          groupLabel: '묶음 1',
          orientation: 'landscape',
        },
        {
          id: 'oi-2',
          productName: '클래식 프레임',
          sizeLabel: '5×7',
          colorLabel: '블랙',
          quantity: 1,
          price: 12_000,
          groupLabel: '묶음 1',
          orientation: 'portrait',
        },
        {
          id: 'oi-3',
          productName: '클래식 프레임',
          sizeLabel: '4×6',
          colorLabel: '화이트',
          quantity: 2,
          price: 5_000,
          groupLabel: null,
          orientation: null,
        },
      ],
    };
    await lookupViaUi();

    const group = screen.getByTestId('lookup-group');
    expect(within(group).getByText(/묶음 1/)).toBeInTheDocument();
    expect(within(group).getByText('가로 1 · 세로 1')).toBeInTheDocument();
    expect(within(group).getByText('22,000원')).toBeInTheDocument(); // 그룹 소계
    expect(within(group).getByText(/가로형/)).toBeInTheDocument();
    expect(
      within(group).getByText('세트는 주문 단위로만 취소할 수 있습니다'),
    ).toBeInTheDocument();
    // 단품은 그룹 밖 평면 행
    expect(screen.getByText(/화이트\) × 2/)).toBeInTheDocument();
  });

  it('couponDiscount/pointsRedeemed > 0 이면 합계 분해 행을 표시한다', async () => {
    responseBody = {
      ...baseResult(),
      couponCode: 'WELCOME5',
      couponDiscount: 5_000,
      pointsRedeemed: 1_000,
      items: [
        {
          id: 'oi-1',
          productName: '클래식 프레임',
          sizeLabel: '4×6',
          colorLabel: '블랙',
          quantity: 1,
          price: 10_000,
          groupLabel: null,
          orientation: null,
        },
      ],
    };
    await lookupViaUi();

    expect(screen.getByTestId('lookup-coupon-row')).toHaveTextContent(
      '쿠폰 할인 (WELCOME5)',
    );
    expect(screen.getByTestId('lookup-coupon-row')).toHaveTextContent('-5,000원');
    expect(screen.getByTestId('lookup-redeem-row')).toHaveTextContent('-1,000원');
  });

  it('그룹/할인 필드가 없는 응답(구 프로젝션)은 기존 평면 화면 그대로', async () => {
    responseBody = {
      ...baseResult(),
      items: [
        {
          id: 'oi-1',
          productName: '클래식 프레임',
          sizeLabel: '4×6',
          colorLabel: '블랙',
          quantity: 1,
          price: 10_000,
        },
      ],
    };
    await lookupViaUi();

    expect(screen.queryByTestId('lookup-group')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lookup-coupon-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lookup-redeem-row')).not.toBeInTheDocument();
    expect(screen.getByText(/블랙\) × 1/)).toBeInTheDocument();
  });
});
