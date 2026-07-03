/**
 * POST /api/orders 라우트 브리지 계약 테스트 (FS-EC P0-001 재발 방지).
 *
 * 이번 사고의 근원: 유닛 테스트가 createOrder 를 직접 호출해 라우트의 input
 * 조립 계층(seam)이 무검증이었고, redeemPoints/receipt 가 라우트에서 조용히
 * 드롭됐다(표시≠청구). 이 테스트는 라우트 → createOrder 로 필드가 그대로
 * 전달되는지와 신규 에러코드의 4xx 매핑을 고정한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateOrderError, type CreateOrderInput } from '@/types/order';
import type { Order } from '@/types/order';

const mockState: {
  user: { id: string } | null;
  cookies: Record<string, string>;
} = {
  user: null,
  cookies: {},
};

vi.mock('@/lib/db/order', () => ({
  createOrder: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockState.user } }),
    },
  }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      mockState.cookies[name] !== undefined
        ? { name, value: mockState.cookies[name] }
        : undefined,
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRate: vi.fn(async () => ({ ok: true, remaining: 9 })),
}));

import { POST } from '@/app/api/orders/route';
import { createOrder } from '@/lib/db/order';

const createOrderMock = vi.mocked(createOrder);

const FAKE_ORDER = {
  id: 'order-uuid-1',
  orderNo: '20260703-0001',
  status: 'CREATED',
  totalPrice: 28_000,
} as unknown as Order;

function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cartItems: [
      {
        localId: '44444444-4444-4444-8444-444444444444',
        userId: null,
        productId: '22222222-2222-2222-2222-222222222222',
        variantId: '11111111-1111-1111-1111-111111111111',
        photoId: '33333333-3333-3333-3333-333333333333',
        options: {
          sizeCode: 'A4',
          colorCode: 'BLACK',
          matteCode: 'none',
          paperCode: 'glossy',
        },
        photoUrl: 'https://example.supabase.co/photo.jpg',
        cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
        previewUrl: 'https://example.supabase.co/preview.jpg',
        price: 30_000,
        quantity: 1,
        createdAt: new Date().toISOString(),
      },
    ],
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'a@b.com' },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '12345',
      addr1: '서울시 강남구',
      addr2: '',
      memo: '',
    },
    shippingMethod: 'STANDARD',
    clientShippingFee: 3000,
    ...overrides,
  };
}

async function call(body: Record<string, unknown>): Promise<{
  status: number;
  body: { ok: boolean; code?: string; order?: unknown };
}> {
  // 테스트 환경(NODE_ENV !== 'production')에서는 Origin/Sec-Fetch-Site 부재가
  // same-origin 으로 통과한다(isSameOrigin 계약).
  const req = new Request('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return {
    status: res.status,
    body: (await res.json()) as { ok: boolean; code?: string; order?: unknown },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.user = { id: 'user-1' };
  mockState.cookies = {};
  createOrderMock.mockResolvedValue(FAKE_ORDER);
});

describe('POST /api/orders — redeemPoints/receipt 브리지 (P0-001)', () => {
  it('redeemPoints 와 receipt 를 createOrder input 까지 그대로 전달한다', async () => {
    const { status, body } = await call(
      makeBody({
        redeemPoints: 5000,
        receipt: { type: 'income', info: '010-1234-5678' },
      }),
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(createOrderMock).toHaveBeenCalledTimes(1);
    const input = createOrderMock.mock.calls[0][0] as CreateOrderInput;
    expect(input.redeemPoints).toBe(5000);
    expect(input.receipt).toEqual({ type: 'income', info: '010-1234-5678' });
    // 기존 필드 회귀 0: userId/배송비도 함께 전달된다.
    expect(input.userId).toBe('user-1');
    expect(input.clientShippingFee).toBe(3000);
  });

  it('미지정이면 redeemPoints=undefined, receipt=null 로 전달한다(레거시 무파손)', async () => {
    const { status } = await call(makeBody());

    expect(status).toBe(200);
    const input = createOrderMock.mock.calls[0][0] as CreateOrderInput;
    expect(input.redeemPoints).toBeUndefined();
    expect(input.receipt).toBeNull();
  });
});

describe('POST /api/orders — 신규 에러코드 status 매핑 (P2-003)', () => {
  it.each([
    ['POINTS_UNAVAILABLE'],
    ['POINTS_INSUFFICIENT'],
    ['RECEIPT_UNAVAILABLE'],
  ] as const)('%s → 422 (500 으로 새지 않는다)', async (code) => {
    createOrderMock.mockRejectedValue(new CreateOrderError(code));

    const { status, body } = await call(makeBody({ redeemPoints: 5000 }));

    expect(status).toBe(422);
    expect(body).toMatchObject({ ok: false, code });
  });

  it('기존 매핑 회귀 0: PHOTO_OWNERSHIP 은 여전히 403', async () => {
    createOrderMock.mockRejectedValue(new CreateOrderError('PHOTO_OWNERSHIP'));

    const { status, body } = await call(makeBody());

    expect(status).toBe(403);
    expect(body).toMatchObject({ ok: false, code: 'PHOTO_OWNERSHIP' });
  });
});
