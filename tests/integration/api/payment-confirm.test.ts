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
};

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
} = {
  order: null,
  transitionCalls: [],
  tossConfirmCalls: [],
  tossShouldThrow: false,
};

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
      userId: null,
      status: mockState.order.status,
      totalPrice: mockState.order.totalPrice,
      shippingFee: 0,
      shippingMethod: 'STANDARD',
      paymentId: mockState.order.paymentId,
      trackingNumber: null,
      courier: null,
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
