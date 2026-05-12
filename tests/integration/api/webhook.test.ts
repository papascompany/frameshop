/**
 * /api/webhook/payment contract test.
 *
 * Spec: docs/specs/payment.md AC-7~8.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const SECRET = process.env.TOSS_WEBHOOK_SECRET ?? 'whsec-test';

function makeEvent(totalAmount: number) {
  return {
    eventType: 'PAYMENT_STATUS_CHANGED',
    createdAt: '2026-05-12T03:00:00.000Z',
    data: {
      paymentKey: 'pk-test-amount-mismatch',
      orderId: '20260512-0001',
      status: 'DONE',
      totalAmount,
    },
  };
}

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
}

// Shared mock state — tests mutate per-case.
type MockState = {
  existingEvent: { id: string } | null;
  order: {
    id: string;
    totalPrice: number;
    status: string;
  } | null;
  insertedEvents: Array<Record<string, unknown>>;
  transitionCalls: number;
};

const mockState: MockState = {
  existingEvent: null,
  order: null,
  insertedEvents: [],
  transitionCalls: 0,
};

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      if (table === 'payment_events') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: mockState.existingEvent, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            mockState.insertedEvents.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unmocked service-role table: ${table}`);
    },
  }),
}));

vi.mock('@/lib/db/order', async () => {
  return {
    getOrder: async () => {
      if (!mockState.order) return null;
      return {
        id: mockState.order.id,
        orderNo: '20260512-0001',
        totalPrice: mockState.order.totalPrice,
        status: mockState.order.status,
        items: [],
      };
    },
    transitionTo: async () => {
      mockState.transitionCalls += 1;
      return {};
    },
    createOrder: async () => ({}),
    generateOrderNo: async () => '20260512-0001',
    findOrderByGuest: async () => null,
    attachPaymentKey: async () => {},
  };
});

beforeEach(() => {
  mockState.existingEvent = null;
  mockState.order = {
    id: 'order-uuid-1',
    totalPrice: 12000,
    status: 'CREATED',
  };
  mockState.insertedEvents = [];
  mockState.transitionCalls = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/webhook/payment', () => {
  it('returns 401 INVALID_SIGNATURE when header is missing or wrong', async () => {
    const { POST } = await import('@/app/api/webhook/payment/route');
    const body = JSON.stringify(makeEvent(12000));
    const req = new Request('http://localhost/api/webhook/payment', {
      method: 'POST',
      headers: {
        'tosspayments-signature': 'wrong',
        'Content-Type': 'application/json',
      },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('logs event but skips state transition when totalAmount mismatches', async () => {
    const { POST } = await import('@/app/api/webhook/payment/route');

    // Webhook claims 1 won; order is actually 12000.
    const body = JSON.stringify(makeEvent(1));
    const req = new Request('http://localhost/api/webhook/payment', {
      method: 'POST',
      headers: {
        'tosspayments-signature': sign(body),
        'Content-Type': 'application/json',
      },
      body,
    });
    const res = await POST(req);
    // Still 200 so Toss doesn't retry — but we must NOT transition.
    expect(res.status).toBe(200);
    expect(mockState.transitionCalls).toBe(0);
    // Event was recorded with a mismatch marker for forensics.
    expect(mockState.insertedEvents).toHaveLength(1);
    const inserted = mockState.insertedEvents[0]!;
    const raw = inserted.raw_payload as { _frameshop?: { amountMismatch?: boolean } };
    expect(raw._frameshop?.amountMismatch).toBe(true);
  });

  it('accepts valid signature + matching amount (200) and records event', async () => {
    const { POST } = await import('@/app/api/webhook/payment/route');

    // Webhook claims 12000; order is exactly 12000 → should transition + insert.
    const body = JSON.stringify(makeEvent(12000));
    const req = new Request('http://localhost/api/webhook/payment', {
      method: 'POST',
      headers: {
        'tosspayments-signature': sign(body),
        'Content-Type': 'application/json',
      },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // State machine transition was attempted (CREATED → PAID).
    expect(mockState.transitionCalls).toBe(1);
    // Event recorded WITHOUT the mismatch marker.
    expect(mockState.insertedEvents).toHaveLength(1);
    const inserted = mockState.insertedEvents[0]!;
    expect(inserted.payment_key).toBe('pk-test-amount-mismatch');
    expect(inserted.status).toBe('DONE');
    const raw = inserted.raw_payload as { _frameshop?: { amountMismatch?: boolean } };
    expect(raw._frameshop).toBeUndefined();
  });

  it('is idempotent: skips processing when payment_key already recorded', async () => {
    const { POST } = await import('@/app/api/webhook/payment/route');

    // Existing event already present in payment_events for this payment_key.
    mockState.existingEvent = { id: 'pe-existing' };

    const body = JSON.stringify(makeEvent(12000));
    const req = new Request('http://localhost/api/webhook/payment', {
      method: 'POST',
      headers: {
        'tosspayments-signature': sign(body),
        'Content-Type': 'application/json',
      },
      body,
    });
    const res = await POST(req);
    // Still returns 200 (idempotent), but no new event nor transition.
    expect(res.status).toBe(200);
    expect(mockState.insertedEvents).toHaveLength(0);
    expect(mockState.transitionCalls).toBe(0);
  });
});
