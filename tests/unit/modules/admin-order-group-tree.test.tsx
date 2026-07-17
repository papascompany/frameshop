/**
 * AdminOrderDetailClient — 묶음(세트) 그룹 트리 + 할인 분해 (FS-X-05).
 *
 * 고정하는 계약:
 *  1. 묶음 라인은 그룹 헤더(groupLabel + 구성 수 + 그룹 소계) 아래 구성 행
 *     트리로, 단품은 현행 평면 행으로 렌더된다.
 *  2. 행별 인쇄파일 링크와 ZIP 다운로드 버튼은 무변경(015 불변식).
 *  3. couponDiscount/pointsRedeemed > 0 이면 금액 분해(상품합계/배송비/쿠폰/
 *     적립금/결제 금액) 라인이 노출되고, 둘 다 0 이면 노출되지 않는다.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type {
  OrderId,
  OrderItemId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import type {
  Order,
  OrderItem,
  OrderItemSnapshot,
  OrderWithItems,
} from '@/types/order';

vi.mock('@/app/admin/orders/actions', () => ({
  startProductionAction: vi.fn(),
  shipOrderAction: vi.fn(),
  markDeliveredAction: vi.fn(),
  cancelOrderAction: vi.fn(),
  refundOrderAction: vi.fn(),
  saveOrderMemoAction: vi.fn(),
}));

import { AdminOrderDetailClient } from '@/app/admin/orders/[id]/AdminOrderDetailClient';

let seq = 0;

function makeItem(
  productName: string,
  price: number,
  quantity: number,
  snapshotOverrides: Partial<OrderItemSnapshot> = {},
  itemOverrides: Partial<Omit<OrderItem, 'snapshot' | 'quantity' | 'price'>> = {},
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
      unitPrice: price,
      ...snapshotOverrides,
    },
    photoUrl: 'https://example.com/baked.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    printFileUrl: null,
    quantity,
    price,
    ...itemOverrides,
  };
}

function makeOrder(
  items: OrderItem[],
  overrides: Partial<Order> = {},
): OrderWithItems {
  return {
    id: asBrand<OrderId>('order-1'),
    orderNo: asBrand<import('@/types/common').OrderNo>('FS-20260717-0001'),
    userId: null,
    status: 'PAID',
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
    ...overrides,
  };
}

function renderDetail(order: OrderWithItems) {
  return render(
    <AdminOrderDetailClient order={order} partialRefundAvailable={false} />,
  );
}

describe('AdminOrderDetailClient — 그룹 트리', () => {
  it('묶음 헤더(라벨/구성 수/소계) + 구성 행 + 단품 평면 행을 렌더한다', () => {
    const order = makeOrder([
      makeItem('갤러리 세트', 5000, 1, { groupLabel: '묶음 1', projectSeq: 0 }),
      makeItem('갤러리 세트', 9000, 2, { groupLabel: '묶음 1', projectSeq: 1 }),
      makeItem('단품 액자', 12000, 1),
    ]);
    renderDetail(order);

    const group = screen.getByTestId('admin-order-group');
    expect(group).toHaveTextContent('묶음 1');
    expect(group).toHaveTextContent('구성 2개');
    // 소계 = 5000×1 + 9000×2 = 23,000원.
    expect(group).toHaveTextContent('23,000원');
    // 구성 행 2개가 트리(내부 ul) 안에 렌더된다.
    expect(group.querySelectorAll('li')).toHaveLength(2);

    // 단품은 그룹 밖 평면 행.
    expect(screen.getByText('단품 액자')).toBeInTheDocument();
  });

  it('행별 인쇄파일 링크와 ZIP 버튼은 무변경(015 불변식)', () => {
    const order = makeOrder([
      makeItem('갤러리 세트', 5000, 1, { groupLabel: '묶음 1' }, {
        printFileUrl: 'https://example.com/print-1.png',
      }),
      makeItem('단품 액자', 12000, 1, {}, {
        printFileUrl: 'https://example.com/print-2.png',
      }),
    ]);
    renderDetail(order);

    const rowLinks = screen.getAllByRole('link', { name: '인쇄 파일 다운로드' });
    expect(rowLinks).toHaveLength(2);
    expect(rowLinks[0]).toHaveAttribute('href', 'https://example.com/print-1.png');

    expect(
      screen.getByRole('link', { name: '인쇄 파일 ZIP 다운로드' }),
    ).toHaveAttribute('href', '/api/admin/orders/order-1/zip');
  });
});

describe('AdminOrderDetailClient — 쿠폰/적립 할인 분해', () => {
  it('couponDiscount/pointsRedeemed > 0 이면 금액 분해가 노출된다', () => {
    const order = makeOrder([makeItem('단품 액자', 20000, 1)], {
      couponCode: 'WELCOME',
      couponDiscount: 3000,
      pointsRedeemed: 1000,
      totalPrice: 19000, // 20000 + 3000(배송) - 3000(쿠폰) - 1000(적립)
    });
    renderDetail(order);

    const breakdown = screen.getByTestId('order-discount-breakdown');
    expect(breakdown).toHaveTextContent('상품합계');
    expect(breakdown).toHaveTextContent('20,000원');
    expect(breakdown).toHaveTextContent('쿠폰 할인 (WELCOME)');
    expect(breakdown).toHaveTextContent('-3,000원');
    expect(breakdown).toHaveTextContent('적립금 사용');
    expect(breakdown).toHaveTextContent('-1,000원');
    expect(breakdown).toHaveTextContent('결제 금액');
    expect(breakdown).toHaveTextContent('19,000원');
  });

  it('쿠폰만 사용 시 적립금 라인은 없다', () => {
    const order = makeOrder([makeItem('단품 액자', 20000, 1)], {
      couponCode: 'WELCOME',
      couponDiscount: 3000,
      totalPrice: 20000,
    });
    renderDetail(order);

    const breakdown = screen.getByTestId('order-discount-breakdown');
    expect(breakdown).toHaveTextContent('쿠폰 할인');
    expect(breakdown).not.toHaveTextContent('적립금 사용');
  });

  it('할인이 없으면(둘 다 0/미적용 폴백) 분해 라인이 노출되지 않는다', () => {
    renderDetail(makeOrder([makeItem('단품 액자', 20000, 1)]));
    expect(
      screen.queryByTestId('order-discount-breakdown'),
    ).not.toBeInTheDocument();
  });
});
