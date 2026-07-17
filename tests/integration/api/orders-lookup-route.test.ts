/**
 * POST /api/orders/lookup — FS-X-04 프로젝션 확장 계약.
 *
 * 고정하는 계약:
 *  1. items[] 에 snapshot 의 groupLabel/orientation 이 포함된다(묶음 그룹 렌더).
 *  2. 합계 분해 필드(surchargeFee/pointsRedeemed/couponCode/couponDiscount)가
 *     top-level 로 내려간다 — 마이그레이션 미적용/레거시 주문은 0/null 폴백.
 *  3. 주문 없음(전화 불일치 포함) → 404 단일 표현(기존 계약 무파손).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { asBrand } from '@/types/common';
import type {
  OrderId,
  OrderItemId,
  OrderNo,
  PhotoId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import type { OrderItem, OrderWithItems } from '@/types/order';

const mockState: { order: OrderWithItems | null } = { order: null };

vi.mock('@/lib/db/order', () => ({
  findOrderByGuest: vi.fn(async () => mockState.order),
}));

vi.mock('@/lib/lookup-ratelimit', () => ({
  checkLookupRate: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRate: vi.fn(async () => ({ ok: true, remaining: 9 })),
}));

import { POST } from '@/app/api/orders/lookup/route';

function makeOrderItem(overrides: {
  id: string;
  price: number;
  groupLabel?: string;
  orientation?: 'landscape' | 'portrait';
}): OrderItem {
  return {
    id: asBrand<OrderItemId>(overrides.id),
    orderId: asBrand<OrderId>('order-1'),
    snapshot: {
      productId: asBrand<ProductId>('22222222-2222-4222-8222-222222222222'),
      variantId: asBrand<ProductVariantId>('v-1'),
      productName: '클래식 프레임',
      options: {
        sizeCode: '4x6',
        colorCode: 'black',
        matteCode: 'none',
        paperCode: 'glossy',
      },
      sizeLabel: '4×6',
      colorLabel: '블랙',
      unitPrice: overrides.price,
      sourcePhotoId: asBrand<PhotoId>('ph-1'),
      ...(overrides.groupLabel ? { groupLabel: overrides.groupLabel } : {}),
      ...(overrides.orientation ? { orientation: overrides.orientation } : {}),
    },
    photoUrl: 'https://example.com/photo.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    printFileUrl: null,
    quantity: 1,
    price: overrides.price,
  };
}

function makeOrder(overrides: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    id: asBrand<OrderId>('order-1'),
    orderNo: asBrand<OrderNo>('20260717-0001'),
    userId: null,
    status: 'PAID',
    totalPrice: 20_000,
    shippingFee: 3_000,
    shippingMethod: 'STANDARD',
    paymentId: null,
    trackingNumber: null,
    courier: null,
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'hong@example.com' },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '06236',
      addr1: '서울 강남구',
      addr2: '',
      memo: '',
    },
    createdAt: '2026-07-17T00:00:00.000Z',
    paidAt: null,
    shippedAt: null,
    items: [],
    ...overrides,
  };
}

async function call(): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new NextRequest('http://localhost/api/orders/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNo: '20260717-0001', phone: '010-1234-5678' }),
  });
  const res = await POST(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.order = null;
});

describe('POST /api/orders/lookup — FS-X-04 프로젝션', () => {
  it('items 에 groupLabel/orientation, top-level 에 쿠폰/적립/추가배송비를 내린다', async () => {
    mockState.order = makeOrder({
      surchargeFee: 3_000,
      pointsRedeemed: 1_000,
      couponCode: 'WELCOME5',
      couponDiscount: 5_000,
      items: [
        makeOrderItem({ id: 'oi-1', price: 10_000, groupLabel: '묶음 1', orientation: 'landscape' }),
        makeOrderItem({ id: 'oi-2', price: 12_000, groupLabel: '묶음 1', orientation: 'portrait' }),
        makeOrderItem({ id: 'oi-3', price: 5_000 }),
      ],
    });

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      surchargeFee: 3_000,
      pointsRedeemed: 1_000,
      couponCode: 'WELCOME5',
      couponDiscount: 5_000,
    });
    const items = body.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ groupLabel: '묶음 1', orientation: 'landscape' });
    expect(items[1]).toMatchObject({ groupLabel: '묶음 1', orientation: 'portrait' });
    expect(items[2]).toMatchObject({ groupLabel: null, orientation: null });
  });

  it('레거시 주문(스냅샷/컬럼 부재) — null/0 폴백으로 안전하게 내린다', async () => {
    mockState.order = makeOrder({
      items: [makeOrderItem({ id: 'oi-1', price: 10_000 })],
    });

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      surchargeFee: 0,
      pointsRedeemed: 0,
      couponCode: null,
      couponDiscount: 0,
    });
    const items = body.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      productName: '클래식 프레임',
      groupLabel: null,
      orientation: null,
    });
  });

  it('주문 없음/전화 불일치 → 404 단일 표현(기존 계약 유지)', async () => {
    mockState.order = null;
    const { status } = await call();
    expect(status).toBe(404);
  });
});
