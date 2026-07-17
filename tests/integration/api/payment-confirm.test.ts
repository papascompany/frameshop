/**
 * /api/payment/confirm contract test — IT.
 *
 * Spec: docs/specs/payment.md AC-3/AC-4.
 * The route handler is the integration unit under test. The schema/origin
 * guards run early without DB calls; the DB-backed cases below use
 * vi.mock on @/lib/db/order and @/lib/payment/toss to exercise the
 * confirmPayment branches (AMOUNT_MISMATCH, ORDER_NOT_FOUND, ALREADY_PAID,
 * Toss success).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Shared mock state (mutated per test) ----------

type MockOrder = {
  id: string;
  orderNo: string;
  totalPrice: number;
  status: 'CREATED' | 'PAID' | 'CANCELLED';
  paymentId: string | null;
  /** FS-X-FIX-A P1-2: coupon snapshot frozen at order creation (or null). */
  couponCode?: string | null;
  userId?: string | null;
};

type CouponConsumeResult =
  | { ok: true }
  | { ok: false; errorCode: string; error: string };

const mockState: {
  order: MockOrder | null;
  transitionCalls: Array<{
    orderId: string;
    target: string;
    paymentKey?: string;
  }>;
  tossConfirmCalls: Array<{
    paymentKey: string;
    orderId: string;
    amount: number;
  }>;
  tossShouldThrow: boolean;
  paymentEventsInsertError: { message: string; code: string } | null;
  /** FS-X-FIX-A P1-2: records every consumeCouponByCode call the route makes. */
  couponConsumeCalls: Array<{ code: string; userId: string | null; orderNo: string }>;
  couponConsumeResult: CouponConsumeResult;
} = {
  order: null,
  transitionCalls: [],
  tossConfirmCalls: [],
  tossShouldThrow: false,
  // null → insert succeeds (P1-03 lock acquired); non-null → UNIQUE conflict
  paymentEventsInsertError: null,
  couponConsumeCalls: [],
  couponConsumeResult: { ok: true },
};

// FS-X-FIX-A P1-2: the coupon is consumed at PAID (here), not at order creation.
vi.mock('@/lib/db/coupons', () => ({
  consumeCouponByCode: async (
    code: string,
    userId: string | null,
    orderNo: string,
  ): Promise<CouponConsumeResult> => {
    mockState.couponConsumeCalls.push({ code, userId, orderNo });
    return mockState.couponConsumeResult;
  },
}));

// Mock service-role Supabase used by confirmPayment for P1-03 atomic lock.
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      if (table === 'payment_events') {
        return {
          insert: () =>
            Promise.resolve({ error: mockState.paymentEventsInsertError }),
        };
      }
      throw new Error(`Unmocked service-role table: ${table}`);
    },
  }),
}));

vi.mock('@/lib/db/order', () => ({
  getOrder: async (orderNoOrId: string) => {
    if (!mockState.order) return null;
    if (
      mockState.order.orderNo !== orderNoOrId &&
      mockState.order.id !== orderNoOrId
    ) {
      return null;
    }
    return {
      id: mockState.order.id,
      orderNo: mockState.order.orderNo,
      userId: mockState.order.userId ?? null,
      status: mockState.order.status,
      totalPrice: mockState.order.totalPrice,
      shippingFee: 0,
      shippingMethod: 'STANDARD',
      paymentId: mockState.order.paymentId,
      trackingNumber: null,
      courier: null,
      // FS-X-FIX-A P1-2: coupon snapshot the confirm route reads to consume at PAID.
      couponCode: mockState.order.couponCode ?? null,
      couponDiscount: mockState.order.couponCode ? 5000 : 0,
      orderer: { name: '홍길동', phone: '010-0000-0000', email: 'a@b.com' },
      shipping: { name: '', phone: '', zip: '', addr1: '', addr2: '', memo: '' },
      createdAt: new Date().toISOString(),
      paidAt: null,
      shippedAt: null,
      items: [],
    };
  },
  transitionTo: async (
    orderId: string,
    target: string,
    meta: { paymentKey?: string } = {},
  ) => {
    mockState.transitionCalls.push({
      orderId,
      target,
      paymentKey: meta.paymentKey,
    });
    return {};
  },
  // Unused by the confirm route, but exported for completeness.
  createOrder: async () => ({}),
  generateOrderNo: async () => '20260512-0001',
  findOrderByGuest: async () => null,
  attachPaymentKey: async () => {},
}));

vi.mock('@/lib/payment/toss', async () => {
  // Reuse the real TossApiError class for `instanceof` checks in confirm.ts.
  const actual =
    await vi.importActual<typeof import('@/lib/payment/toss')>(
      '@/lib/payment/toss',
    );
  return {
    ...actual,
    tossClient: {
      confirm: async (input: {
        paymentKey: string;
        orderId: string;
        amount: number;
      }) => {
        mockState.tossConfirmCalls.push(input);
        if (mockState.tossShouldThrow) {
          throw new actual.TossApiError(400, 'TOSS_REJECTED', 'rejected');
        }
        return {
          paymentKey: input.paymentKey,
          orderId: input.orderId,
          status: 'DONE',
          totalAmount: input.amount,
          method: 'CARD',
          approvedAt: new Date().toISOString(),
        };
      },
      cancel: async () => ({
        paymentKey: '',
        orderId: '',
        status: 'CANCELED',
        totalAmount: 0,
      }),
      getPayment: async () => ({
        paymentKey: '',
        orderId: '',
        status: 'DONE',
        totalAmount: 0,
      }),
    },
  };
});

beforeEach(() => {
  mockState.order = null;
  mockState.transitionCalls = [];
  mockState.tossConfirmCalls = [];
  mockState.tossShouldThrow = false;
  mockState.paymentEventsInsertError = null;
  mockState.couponConsumeCalls = [];
  mockState.couponConsumeResult = { ok: true };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/payment/confirm', () => {
  it('returns 400 BAD_JSON when body is not valid JSON', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_JSON');
  });

  it('returns 403 BAD_ORIGIN when Origin is cross-site (P2-05)', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Production-style origin from an attacker domain. NODE_ENV=test so
        // the helper only allows same-origin or localhost — `evil.example`
        // matches neither.
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({
        paymentKey: 'pk-test',
        orderId: '20260512-0001',
        amount: 12000,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_ORIGIN');
  });

  it('returns 400 BAD_INPUT when schema rejects the payload', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentKey: 'pk',
        orderId: 'not-our-format',
        amount: -1,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_INPUT');
  });

  it('returns 400 AMOUNT_MISMATCH when DB total_price != amount (never calls Toss)', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.order = {
      id: 'order-uuid-1',
      orderNo: '20260512-0001',
      totalPrice: 12000,
      status: 'CREATED',
      paymentId: null,
    };
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentKey: 'pk-test-mismatch',
        orderId: '20260512-0001',
        // Client claims 1 won; DB says 12000.
        amount: 1,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('AMOUNT_MISMATCH');
    // Critical: Toss confirm MUST NOT be called when the client lied about amount.
    expect(mockState.tossConfirmCalls).toHaveLength(0);
    // And no state transition occurred either.
    expect(mockState.transitionCalls).toHaveLength(0);
  });

  it('returns 404 ORDER_NOT_FOUND when orderNo is missing', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    // mockState.order stays null → getOrder returns null.
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentKey: 'pk-test-missing',
        orderId: '20260512-9999',
        amount: 12000,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('ORDER_NOT_FOUND');
    expect(mockState.tossConfirmCalls).toHaveLength(0);
    expect(mockState.transitionCalls).toHaveLength(0);
  });

  it('returns 200 ok and is idempotent when order is already PAID', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.order = {
      id: 'order-uuid-1',
      orderNo: '20260512-0001',
      totalPrice: 12000,
      status: 'PAID',
      paymentId: 'pk-test-original',
    };
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentKey: 'pk-test-retry',
        orderId: '20260512-0001',
        amount: 12000,
      }),
    });
    const res = await POST(req);
    // Idempotent success path (no re-charge): returns ok with the existing key.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      orderNo: string;
      paymentKey: string;
    };
    expect(body.ok).toBe(true);
    expect(body.orderNo).toBe('20260512-0001');
    // The DB paymentKey wins — protects against retry with a different key.
    expect(body.paymentKey).toBe('pk-test-original');
    // Critical: re-confirm MUST NOT call Toss or transition again.
    expect(mockState.tossConfirmCalls).toHaveLength(0);
    expect(mockState.transitionCalls).toHaveLength(0);
  });

  it('calls Toss confirm and transitions CREATED → PAID on success', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.order = {
      id: 'order-uuid-1',
      orderNo: '20260512-0001',
      totalPrice: 12000,
      status: 'CREATED',
      paymentId: null,
    };
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentKey: 'pk-test-success',
        orderId: '20260512-0001',
        amount: 12000,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      orderNo: string;
      paymentKey: string;
    };
    expect(body.ok).toBe(true);
    expect(body.orderNo).toBe('20260512-0001');
    expect(body.paymentKey).toBe('pk-test-success');

    // Toss confirm was called exactly once with server-validated values.
    expect(mockState.tossConfirmCalls).toHaveLength(1);
    expect(mockState.tossConfirmCalls[0]).toEqual({
      paymentKey: 'pk-test-success',
      orderId: '20260512-0001',
      amount: 12000,
    });

    // Order transitioned to PAID with the paymentKey attached.
    expect(mockState.transitionCalls).toHaveLength(1);
    expect(mockState.transitionCalls[0]).toEqual({
      orderId: 'order-uuid-1',
      target: 'PAID',
      paymentKey: 'pk-test-success',
    });
  });
});

describe('POST /api/payment/confirm — 쿠폰 소비 시점 이동 (FS-X-FIX-A P1-2)', () => {
  function paidBody(paymentKey = 'pk-coupon'): Request {
    return new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId: '20260512-0001', amount: 12000 }),
    });
  }

  it('couponCode 스냅샷이 있으면 PAID 전이 성공 후 consumeCouponByCode 를 1회 호출한다', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.order = {
      id: 'order-uuid-1',
      orderNo: '20260512-0001',
      totalPrice: 12000,
      status: 'CREATED',
      paymentId: null,
      couponCode: 'WELCOME5',
      userId: 'user-1',
    };
    const res = await POST(paidBody());
    expect(res.status).toBe(200);
    // 전이가 먼저, 소비가 그 뒤 — 소비는 PAID 를 소유한 브랜치에서만 일어난다.
    expect(mockState.transitionCalls).toHaveLength(1);
    expect(mockState.couponConsumeCalls).toEqual([
      { code: 'WELCOME5', userId: 'user-1', orderNo: '20260512-0001' },
    ]);
  });

  it('couponCode 가 없으면 consumeCouponByCode 를 호출하지 않는다', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.order = {
      id: 'order-uuid-1',
      orderNo: '20260512-0001',
      totalPrice: 12000,
      status: 'CREATED',
      paymentId: null,
      couponCode: null,
    };
    const res = await POST(paidBody());
    expect(res.status).toBe(200);
    expect(mockState.couponConsumeCalls).toHaveLength(0);
  });

  it('이미 PAID 인 재확정(멱등)은 다시 소비하지 않는다', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.order = {
      id: 'order-uuid-1',
      orderNo: '20260512-0001',
      totalPrice: 12000,
      status: 'PAID',
      paymentId: 'pk-original',
      couponCode: 'WELCOME5',
      userId: 'user-1',
    };
    const res = await POST(paidBody('pk-retry'));
    expect(res.status).toBe(200);
    // 멱등 재확정 — Toss 도 전이도 소비도 없다.
    expect(mockState.tossConfirmCalls).toHaveLength(0);
    expect(mockState.transitionCalls).toHaveLength(0);
    expect(mockState.couponConsumeCalls).toHaveLength(0);
  });

  it('payment_events dedup(웹훅 선점) 경로에서는 소비하지 않는다 (비회원 이중 차감 방지)', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    // 웹훅이 먼저 payment_events 를 선점 → confirm insert 는 UNIQUE 충돌.
    mockState.paymentEventsInsertError = { message: 'duplicate', code: '23505' };
    mockState.order = {
      id: 'order-uuid-1',
      orderNo: '20260512-0001',
      totalPrice: 12000,
      status: 'CREATED',
      paymentId: null,
      couponCode: 'WELCOME5',
      userId: null, // 비회원 — used_count 이중 증가가 위험한 케이스.
    };
    const res = await POST(paidBody());
    expect(res.status).toBe(200);
    // 잠금을 얻지 못한 브랜치 → 전이도 소비도 하지 않는다(락 소유자가 담당).
    expect(mockState.transitionCalls).toHaveLength(0);
    expect(mockState.couponConsumeCalls).toHaveLength(0);
  });

  it('소비 실패(EXHAUSTED)여도 결제는 성사 유지 — fail-open', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.couponConsumeResult = {
      ok: false,
      errorCode: 'COUPON_EXHAUSTED',
      error: 'usage limit reached',
    };
    mockState.order = {
      id: 'order-uuid-1',
      orderNo: '20260512-0001',
      totalPrice: 12000,
      status: 'CREATED',
      paymentId: null,
      couponCode: 'WELCOME5',
      userId: 'user-1',
    };
    const res = await POST(paidBody());
    const body = (await res.json()) as { ok: boolean };
    // 결제는 이미 성사 — 주문은 PAID 로 유지되고 성공을 돌려준다.
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockState.transitionCalls).toHaveLength(1);
    expect(mockState.couponConsumeCalls).toHaveLength(1);
    errSpy.mockRestore();
  });
});
