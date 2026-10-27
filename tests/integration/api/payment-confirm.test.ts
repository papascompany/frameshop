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
import { asBrand } from '@/types/common';
import type { OrderNo, PaymentKey } from '@/types/common';

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
  /** Toss confirm rejects with this TossApiError code (e.g. ALREADY_PROCESSED_PAYMENT). */
  tossConfirmErrorCode: string | null;
  /** What GET /payments/{paymentKey} returns (recovered path). */
  tossGetPaymentResponse: {
    paymentKey: string;
    orderId: string;
    status: string;
    totalAmount: number;
  };
  tossCancelCalls: string[];
  paymentEventsInsertError: { message: string; code: string } | null;
  /** FS-X-FIX-A P1-2: records every consumeCouponByCode call the route makes. */
  couponConsumeCalls: Array<{ code: string; userId: string | null; orderNo: string }>;
  couponConsumeResult: CouponConsumeResult;
  /** Sweep stale-lock takeover CAS (transitionIfStatus). */
  casCalls: Array<{ orderId: string; from: string; to: string; paymentKey?: string }>;
  casResult: boolean;
} = {
  order: null,
  transitionCalls: [],
  tossConfirmCalls: [],
  tossShouldThrow: false,
  tossConfirmErrorCode: null,
  tossGetPaymentResponse: { paymentKey: '', orderId: '', status: 'DONE', totalAmount: 0 },
  tossCancelCalls: [],
  // null → insert succeeds (P1-03 lock acquired); non-null → UNIQUE conflict
  paymentEventsInsertError: null,
  couponConsumeCalls: [],
  couponConsumeResult: { ok: true },
  casCalls: [],
  casResult: true,
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
  transitionIfStatus: async (
    orderId: string,
    from: string,
    to: string,
    meta: { paymentKey?: string } = {},
  ) => {
    mockState.casCalls.push({ orderId, from, to, paymentKey: meta.paymentKey });
    return mockState.casResult;
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
        if (mockState.tossConfirmErrorCode) {
          throw new actual.TossApiError(
            400,
            mockState.tossConfirmErrorCode,
            '이미 처리된 결제 입니다.',
          );
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
      cancel: async (input: { paymentKey: string }) => {
        mockState.tossCancelCalls.push(input.paymentKey);
        return {
          paymentKey: '',
          orderId: '',
          status: 'CANCELED',
          totalAmount: 0,
        };
      },
      getPayment: async () => mockState.tossGetPaymentResponse,
    },
  };
});

beforeEach(() => {
  mockState.order = null;
  mockState.transitionCalls = [];
  mockState.tossConfirmCalls = [];
  mockState.tossShouldThrow = false;
  mockState.tossConfirmErrorCode = null;
  mockState.tossGetPaymentResponse = {
    paymentKey: '',
    orderId: '',
    status: 'DONE',
    totalAmount: 0,
  };
  mockState.tossCancelCalls = [];
  mockState.paymentEventsInsertError = null;
  mockState.couponConsumeCalls = [];
  mockState.couponConsumeResult = { ok: true };
  mockState.casCalls = [];
  mockState.casResult = true;
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

describe('confirmPayment — 결제 confirm 백스톱 (이중 승인 수렴·끊긴 락 인수)', () => {
  const PAID_TARGET = {
    id: 'order-uuid-1',
    orderNo: '20260512-0001',
    totalPrice: 12000,
    status: 'CREATED' as const,
    paymentId: null,
    couponCode: 'WELCOME5',
    userId: 'user-1',
  };

  function confirmReq(paymentKey = 'pk-race'): Request {
    return new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId: '20260512-0001', amount: 12000 }),
    });
  }

  it('ALREADY_PROCESSED_PAYMENT 면 승인된 결제를 조회해 같은 검증으로 PAID 에 수렴한다', async () => {
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.order = { ...PAID_TARGET };
    // 서버측 확정(성공 페이지)이 먼저 Toss 승인을 끝냈고, 재시도 버튼이 늦게 들어온 경우.
    mockState.tossConfirmErrorCode = 'ALREADY_PROCESSED_PAYMENT';
    mockState.tossGetPaymentResponse = {
      paymentKey: 'pk-race',
      orderId: '20260512-0001',
      status: 'DONE',
      totalAmount: 12000,
    };
    const res = await POST(confirmReq());
    const body = (await res.json()) as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockState.transitionCalls).toEqual([
      { orderId: 'order-uuid-1', target: 'PAID', paymentKey: 'pk-race' },
    ]);
    expect(mockState.couponConsumeCalls).toHaveLength(1);
    expect(mockState.tossCancelCalls).toHaveLength(0);
  });

  it('ALREADY_PROCESSED 결제가 다른 주문 것이면 거부하되 절대 취소(환불)하지 않는다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('@/app/api/payment/confirm/route');
    mockState.order = { ...PAID_TARGET };
    // 다른(정상 결제된) 주문의 paymentKey 를 이 주문에 재사용하는 시도.
    mockState.tossConfirmErrorCode = 'ALREADY_PROCESSED_PAYMENT';
    mockState.tossGetPaymentResponse = {
      paymentKey: 'pk-other-order',
      orderId: '20260512-0002',
      status: 'DONE',
      totalAmount: 12000,
    };
    const res = await POST(confirmReq('pk-other-order'));
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('TOSS_REJECTED');
    expect(mockState.transitionCalls).toHaveLength(0);
    expect(mockState.couponConsumeCalls).toHaveLength(0);
    // 남의 PAID 주문 결제를 환불시키면 안 된다.
    expect(mockState.tossCancelCalls).toHaveLength(0);
    errSpy.mockRestore();
  });

  it('신규 승인 응답이 불일치하면 기존대로 best-effort 취소한다 (대조군)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { confirmPayment } = await import('@/lib/payment/confirm');
    mockState.order = { ...PAID_TARGET, totalPrice: 12000 };
    // 클라이언트 금액 == DB 금액이지만 Toss 가 다른 orderId 로 승인했다고 응답.
    const toss = await import('@/lib/payment/toss');
    const spy = vi.spyOn(toss.tossClient, 'confirm').mockResolvedValueOnce({
      paymentKey: 'pk-x',
      orderId: '20260512-0009',
      status: 'DONE',
      totalAmount: 12000,
    });
    const result = await confirmPayment({
      paymentKey: asBrand<PaymentKey>('pk-x'),
      orderId: asBrand<OrderNo>('20260512-0001'),
      amount: 12000,
    });
    expect(result.ok).toBe(false);
    expect(mockState.tossCancelCalls).toEqual(['pk-x']);
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('takeOverStaleLock: 락은 있는데 주문이 CREATED 면 CAS 로 PAID 정산 + 쿠폰 소비', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { confirmPayment } = await import('@/lib/payment/confirm');
    mockState.order = { ...PAID_TARGET };
    mockState.paymentEventsInsertError = { message: 'duplicate', code: '23505' };
    const result = await confirmPayment(
      { paymentKey: asBrand<PaymentKey>('pk-stale'), orderId: asBrand<OrderNo>('20260512-0001'), amount: 12000 },
      { takeOverStaleLock: true },
    );
    expect(result.ok).toBe(true);
    expect(mockState.casCalls).toEqual([
      { orderId: 'order-uuid-1', from: 'CREATED', to: 'PAID', paymentKey: 'pk-stale' },
    ]);
    expect(mockState.couponConsumeCalls).toHaveLength(1);
    // 일반 전이 경로는 타지 않는다.
    expect(mockState.transitionCalls).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('takeOverStaleLock 이어도 CAS 에서 지면(다른 스윕이 선점) 쿠폰을 소비하지 않는다', async () => {
    const { confirmPayment } = await import('@/lib/payment/confirm');
    mockState.order = { ...PAID_TARGET };
    mockState.paymentEventsInsertError = { message: 'duplicate', code: '23505' };
    mockState.casResult = false;
    const result = await confirmPayment(
      { paymentKey: asBrand<PaymentKey>('pk-stale'), orderId: asBrand<OrderNo>('20260512-0001'), amount: 12000 },
      { takeOverStaleLock: true },
    );
    expect(result.ok).toBe(true);
    expect(mockState.casCalls).toHaveLength(1);
    expect(mockState.couponConsumeCalls).toHaveLength(0);
  });

  it('라이브 경로(옵션 없음)는 락 충돌 시 CAS 인수를 시도하지 않는다', async () => {
    const { confirmPayment } = await import('@/lib/payment/confirm');
    mockState.order = { ...PAID_TARGET };
    mockState.paymentEventsInsertError = { message: 'duplicate', code: '23505' };
    const result = await confirmPayment({
      paymentKey: asBrand<PaymentKey>('pk-live'),
      orderId: asBrand<OrderNo>('20260512-0001'),
      amount: 12000,
    });
    expect(result.ok).toBe(true);
    expect(mockState.casCalls).toHaveLength(0);
    expect(mockState.couponConsumeCalls).toHaveLength(0);
  });
});
