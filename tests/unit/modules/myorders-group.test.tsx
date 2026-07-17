/**
 * MyOrders 묶음(세트) 요약 — FS-X-05 (ADR-021/025).
 *
 * 고정하는 계약:
 *  1. groupSummaryLabel: "[묶음 N] 상품명 외 N건" (구성 1건이면 상품명만).
 *  2. 묶음은 그룹 요약 + 구성 펼침(details)로, 단품은 현행 형태로 렌더된다.
 *  3. 취소 가능한(CREATED/PAID) 세트 포함 주문에만 "세트는 주문 단위로만
 *     취소됩니다" 안내가 노출된다 — 단품 전용/취소 불가 주문에는 없음.
 */

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import koMessages from '@/messages/ko.json';
import { asBrand } from '@/types/common';
import type {
  OrderId,
  OrderItemId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import type {
  OrderItem,
  OrderItemSnapshot,
  OrderStatus,
  OrderWithItems,
} from '@/types/order';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/cart/client', () => ({
  addToCart: vi.fn(async (input: unknown) => input),
}));

import {
  MyOrdersClient,
  groupSummaryLabel,
} from '@/app/(shop)/account/orders/MyOrdersClient';

let seq = 0;

function makeItem(
  productName: string,
  snapshotOverrides: Partial<OrderItemSnapshot> = {},
  itemOverrides: Partial<Omit<OrderItem, 'snapshot'>> = {},
): OrderItem {
  seq += 1;
  return {
    id: asBrand<OrderItemId>(`oi-${seq}`),
    orderId: asBrand<OrderId>('order-1'),
    snapshot: {
      productId: asBrand<ProductId>('22222222-2222-4222-8222-222222222222'),
      variantId: asBrand<ProductVariantId>('v-1'),
      productName,
      options: {
        sizeCode: '4x6',
        colorCode: 'black',
        matteCode: 'none',
        paperCode: 'glossy',
      },
      sizeLabel: '4x6',
      colorLabel: '블랙',
      unitPrice: 5000,
      ...snapshotOverrides,
    },
    photoUrl: 'https://example.com/baked.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    printFileUrl: null,
    quantity: 1,
    price: 5000,
    ...itemOverrides,
  };
}

function makeOrder(
  items: OrderItem[],
  status: OrderStatus = 'PAID',
): OrderWithItems {
  return {
    id: asBrand<OrderId>('order-1'),
    orderNo: asBrand<import('@/types/common').OrderNo>('FS-20260717-0001'),
    userId: null,
    status,
    totalPrice: items.reduce((s, i) => s + i.price * i.quantity, 0),
    shippingFee: 3000,
    shippingMethod: 'STANDARD',
    paymentId: null,
    trackingNumber: null,
    courier: null,
    orderer: { name: '김테스트', phone: '010-1234-5678', email: 't@example.com' },
    shipping: {
      name: '김테스트',
      phone: '010-1234-5678',
      zip: '06236',
      addr1: '서울시',
      addr2: '',
      memo: '',
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    paidAt: null,
    shippedAt: null,
    items,
  };
}

function renderOrders(orders: OrderWithItems[]) {
  return render(
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      <MyOrdersClient orders={orders} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  seq = 0;
});

describe('groupSummaryLabel (순수)', () => {
  it('구성 여러 건 → "[묶음 1] 상품명 외 N건"', () => {
    const lines = [makeItem('갤러리 세트'), makeItem('갤러리 세트'), makeItem('갤러리 세트')];
    expect(groupSummaryLabel({ key: '묶음 1', lines })).toBe(
      '[묶음 1] 갤러리 세트 외 2건',
    );
  });

  it('구성 1건 → "외 N건" 없이 상품명만', () => {
    expect(groupSummaryLabel({ key: '묶음 2', lines: [makeItem('원목 액자')] })).toBe(
      '[묶음 2] 원목 액자',
    );
  });
});

describe('MyOrdersClient 묶음 렌더', () => {
  it('묶음은 그룹 요약 + 구성 펼침, 단품은 현행 형태로 렌더된다', () => {
    const order = makeOrder([
      makeItem('갤러리 세트', { groupLabel: '묶음 1', projectSeq: 0 }),
      makeItem('갤러리 세트', { groupLabel: '묶음 1', projectSeq: 1 }),
      makeItem('단품 액자'),
    ]);
    renderOrders([order]);

    // 그룹 요약(details/summary) — 라벨 + 소계.
    const group = screen.getByTestId('order-group-summary');
    expect(group).toHaveTextContent('[묶음 1] 갤러리 세트 외 1건');
    expect(group).toHaveTextContent('10,000원');
    // 구성 라인이 펼침 내부에 렌더된다.
    expect(group.querySelectorAll('li')).toHaveLength(2);

    // 단품은 그룹 밖에서 현행 형태로.
    expect(screen.getByText('단품 액자')).toBeInTheDocument();
  });

  it('취소 가능한 세트 포함 주문에 "세트는 주문 단위로만 취소됩니다" 안내가 노출된다', () => {
    const order = makeOrder(
      [
        makeItem('갤러리 세트', { groupLabel: '묶음 1' }),
        makeItem('갤러리 세트', { groupLabel: '묶음 1' }),
      ],
      'PAID',
    );
    renderOrders([order]);
    expect(
      screen.getByText('세트는 주문 단위로만 취소됩니다'),
    ).toBeInTheDocument();
  });

  it('단품 전용 주문에는 세트 취소 안내가 없다', () => {
    renderOrders([makeOrder([makeItem('단품 액자')], 'PAID')]);
    expect(
      screen.queryByText('세트는 주문 단위로만 취소됩니다'),
    ).not.toBeInTheDocument();
  });

  it('취소 불가 상태(SHIPPED)의 세트 주문에도 안내가 없다', () => {
    const order = makeOrder(
      [makeItem('갤러리 세트', { groupLabel: '묶음 1' })],
      'SHIPPED',
    );
    renderOrders([order]);
    expect(
      screen.queryByText('세트는 주문 단위로만 취소됩니다'),
    ).not.toBeInTheDocument();
  });
});
