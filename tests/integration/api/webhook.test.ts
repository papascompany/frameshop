/**
 * /api/webhook/payment — 결제 웹훅 정합성 계약 (IT).
 *
 * - 상태 반영의 근거는 웹훅 본문이 아니라 Toss 결제 재조회(getPayment) 결과다.
 * - 서명(tosspayments-webhook-signature)은 오면 문서 방식으로 검증, 없으면 재조회로 대신.
 * - (결함 1) payment_events 에 DONE 락이 이미 있어도 후속 CANCELED 가 반영된다.
 * - (결함 2) 웹훅이 DONE 을 먼저 정산해도 쿠폰이 confirm 경로와 똑같이 소비된다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

type OrderStatus =
  | 'CREATED'
  | 'PAID'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  balanceAmount?: number;
  cancels?: Array<{ cancelAmount: number; canceledAt: string }> | null;
};

const ORDER_NO = '20261028-0001';
const SECURITY_KEY = 'security-key-test';
const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

type State = {
  order: {
    status: OrderStatus;
    totalPrice: number;
    userId: string | null;
    couponCode: string | null;
    pointsRedeemed: number;
    pointsAccrued: number;
    refundedAmount: number;
  } | null;
  /** getPayment 결과. Error 면 throw. */
  toss: TossPayment | Error;
  getPaymentCalls: string[];
  webhookSecret: string | null;
  /** payment_events DONE 락이 이미 있는가(confirm 이 선점). */
  doneLockTaken: boolean;
  paymentEventsInserts: Array<Record<string, unknown>>;
  auditAvailable: boolean;
  auditInserts: Array<Record<string, unknown>>;
  transitionCalls: Array<{ target: string; paymentKey?: string }>;
  casCalls: Array<{ from: string; to: string }>;
  casResult: boolean;
  couponConsumeCalls: string[];
  couponReleaseCalls: string[];
  pointsReverseCalls: Array<{ redeemed: number; accrued: number }>;
};
const state = {} as State;

function reset() {
  state.order = {
    status: 'CREATED',
    totalPrice: 12000,
    userId: 'user-1',
    couponCode: null,
    pointsRedeemed: 0,
    pointsAccrued: 0,
    refundedAmount: 0,
  };
  state.toss = { paymentKey: 'pk-1', orderId: ORDER_NO, status: 'DONE', totalAmount: 12000 };
  state.getPaymentCalls = [];
  state.webhookSecret = null;
  state.doneLockTaken = false;
  state.paymentEventsInserts = [];
  state.auditAvailable = true;
  state.auditInserts = [];
  state.transitionCalls = [];
  state.casCalls = [];
  state.casResult = true;
  state.couponConsumeCalls = [];
  state.couponReleaseCalls = [];
  state.pointsReverseCalls = [];
}
reset();

function mockOrder() {
  if (!state.order) return null;
  return {
    id: 'order-uuid-1',
    orderNo: ORDER_NO,
    items: [],
    receiptType: null,
    receiptInfo: null,
    ...state.order,
  };
}

vi.mock('@/lib/payment/toss', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment/toss')>('@/lib/payment/toss');
  return {
    ...actual,
    tossClient: {
      getPayment: async (paymentKey: string) => {
        state.getPaymentCalls.push(paymentKey);
        if (state.toss instanceof Error) throw state.toss;
        return state.toss;
      },
    },
  };
});

vi.mock('@/lib/env', () => ({
  getEffectiveTossWebhookSecret: async () => {
    if (!state.webhookSecret) throw new Error('not configured');
    return state.webhookSecret;
  },
}));

vi.mock('@/lib/db/order', () => ({
  getOrder: async () => mockOrder(),
  transitionTo: async (_id: string, target: string, meta: { paymentKey?: string } = {}) => {
    state.transitionCalls.push({ target, paymentKey: meta.paymentKey });
    return {};
  },
  transitionIfStatus: async (_id: string, from: string, to: string) => {
    state.casCalls.push({ from, to });
    return state.casResult;
  },
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isWebhookAuditAvailable: async () => state.auditAvailable,
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      if (table === 'payment_events') {
        return {
          insert: (row: Record<string, unknown>) => {
            if (state.doneLockTaken) {
              return Promise.resolve({ error: { message: 'duplicate key', code: '23505' } });
            }
            state.paymentEventsInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'payment_webhook_events') {
        return {
          insert: (row: Record<string, unknown>) => {
            state.auditInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unmocked service-role table: ${table}`);
    },
  }),
}));

vi.mock('@/lib/db/coupons', () => ({
  consumeCouponByCode: async (code: string) => {
    state.couponConsumeCalls.push(code);
    return { ok: true };
  },
  releaseCouponByOrder: async (code: string) => {
    state.couponReleaseCalls.push(code);
  },
}));

vi.mock('@/lib/db/points', () => ({
  reversePointsForOrder: async (
    _id: string,
    _userId: string,
    amounts: { redeemed: number; accrued: number },
  ) => {
    state.pointsReverseCalls.push(amounts);
    return { ok: true, restored: amounts.redeemed, reclaimed: amounts.accrued };
  },
}));

vi.mock('@/lib/render/enqueue', () => ({ enqueuePrintRender: () => {} }));
vi.mock('@/lib/notify', () => ({ notifyNewOrder: async () => {} }));

beforeEach(async () => {
  reset();
  const { _resetRateLimit } = await import('@/lib/ratelimit');
  _resetRateLimit();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function delivery(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    eventType: 'PAYMENT_STATUS_CHANGED',
    createdAt: '2026-10-28T10:00:00.000000',
    data: { paymentKey: 'pk-1', orderId: ORDER_NO, status: 'DONE', totalAmount: 12000 },
    ...overrides,
  });
}

async function post(body: string, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/webhook/payment/route');
  return POST(
    new Request('http://localhost/api/webhook/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
  );
}

function signed(body: string, time = '2026-10-28T10:00:00.000000', key = SECURITY_KEY) {
  const digest = createHmac('sha256', key).update(`${body}:${time}`, 'utf8').digest('base64');
  return {
    'tosspayments-webhook-signature': `v1:${digest}`,
    'tosspayments-webhook-transmission-time': time,
  };
}

describe('웹훅 인증 — 서명은 선택, 진실은 결제 재조회', () => {
  it('서명 없는 웹훅도 Toss 재조회로 처리한다', async () => {
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.getPaymentCalls).toEqual(['pk-1']);
    expect(state.transitionCalls).toEqual([{ target: 'PAID', paymentKey: 'pk-1' }]);
  });

  it('보안 키가 설정돼 있고 서명이 문서 방식으로 맞으면 처리한다', async () => {
    state.webhookSecret = SECURITY_KEY;
    const body = delivery();
    const res = await post(body, signed(body));
    expect(res.status).toBe(200);
    expect(state.getPaymentCalls).toHaveLength(1);
  });

  it('보안 키가 설정돼 있는데 서명이 틀리면 401 — Toss 조회도 하지 않는다', async () => {
    state.webhookSecret = SECURITY_KEY;
    const body = delivery();
    const res = await post(body, signed(body, undefined, 'wrong-key'));
    expect(res.status).toBe(401);
    expect(state.getPaymentCalls).toHaveLength(0);
  });

  it('예전 방식(본문만 hex HMAC, tosspayments-signature 헤더)은 서명으로 취급하지 않는다', async () => {
    state.webhookSecret = SECURITY_KEY;
    const body = delivery();
    const legacy = createHmac('sha256', SECURITY_KEY).update(body, 'utf8').digest('hex');
    const res = await post(body, { 'tosspayments-signature': legacy });
    // 문서 헤더가 없으니 서명 검증을 건너뛰고 재조회로 처리.
    expect(res.status).toBe(200);
    expect(state.getPaymentCalls).toHaveLength(1);
  });

  it('서명은 왔지만 보안 키가 없으면 재조회로 처리한다', async () => {
    const body = delivery();
    const res = await post(body, signed(body));
    expect(res.status).toBe(200);
    expect(state.getPaymentCalls).toHaveLength(1);
  });

  it('본문의 상태·금액은 무시한다 — Toss 가 READY 라면 본문이 DONE 이어도 전이 없음', async () => {
    state.toss = { paymentKey: 'pk-1', orderId: ORDER_NO, status: 'READY', totalAmount: 12000 };
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.transitionCalls).toHaveLength(0);
    expect(state.casCalls).toHaveLength(0);
  });

  it.each([
    ['JSON 아님', 'not-json'],
    ['paymentKey 없음', JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', data: {} })],
  ])('%s → 400', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(state.getPaymentCalls).toHaveLength(0);
  });

  it('구독하지 않은 이벤트 타입은 200 으로 확인만 한다', async () => {
    const res = await post(delivery({ eventType: 'DEPOSIT_CALLBACK' }));
    expect(res.status).toBe(200);
    expect(state.getPaymentCalls).toHaveLength(0);
  });

  it('Toss 가 결제를 모르면(404) 200 — 재전송해도 같다', async () => {
    const { TossApiError } = await import('@/lib/payment/toss');
    state.toss = new TossApiError(404, 'NOT_FOUND_PAYMENT', 'not found');
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.transitionCalls).toHaveLength(0);
  });

  it('키 미설정·네트워크 오류면 503 으로 재전송을 받는다', async () => {
    state.toss = new Error('Toss 시크릿 키가 설정되지 않았습니다.');
    const res = await post(delivery());
    expect(res.status).toBe(503);
    expect(state.transitionCalls).toHaveLength(0);
  });
});

describe('DONE — confirm 과 같은 정산 경로 (결함 2: 쿠폰 대칭)', () => {
  it('웹훅이 먼저 정산하면 DONE 락을 잡고 PAID 전이 + 쿠폰을 소비한다', async () => {
    state.order!.couponCode = 'WELCOME5';
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.paymentEventsInserts).toHaveLength(1);
    expect(state.paymentEventsInserts[0]).toMatchObject({ payment_key: 'pk-1', status: 'DONE' });
    expect(state.transitionCalls).toEqual([{ target: 'PAID', paymentKey: 'pk-1' }]);
    expect(state.couponConsumeCalls).toEqual(['WELCOME5']);
  });

  it('confirm 이 락을 선점했으면 전이도 쿠폰 소비도 하지 않는다(이중 소비 없음)', async () => {
    state.order!.couponCode = 'WELCOME5';
    state.doneLockTaken = true;
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.transitionCalls).toHaveLength(0);
    expect(state.couponConsumeCalls).toHaveLength(0);
  });

  it('금액이 주문과 다르면 어떤 전이도 하지 않는다', async () => {
    state.toss = { paymentKey: 'pk-1', orderId: ORDER_NO, status: 'DONE', totalAmount: 1 };
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.paymentEventsInserts).toHaveLength(0);
    expect(state.transitionCalls).toHaveLength(0);
  });

  it('이미 PAID 면 아무것도 하지 않는다', async () => {
    state.order!.status = 'PAID';
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.paymentEventsInserts).toHaveLength(0);
    expect(state.transitionCalls).toHaveLength(0);
  });
});

describe('CANCELED — 같은 결제의 후속 상태 반영 (결함 1)', () => {
  function canceled(at: string) {
    state.toss = {
      paymentKey: 'pk-1',
      orderId: ORDER_NO,
      status: 'CANCELED',
      totalAmount: 12000,
      balanceAmount: 0,
      cancels: [{ cancelAmount: 12000, canceledAt: at }],
    };
  }

  it('DONE 락이 이미 있어도 대시보드 취소를 반영한다: PAID→CANCELLED + 적립금·쿠폰 복원', async () => {
    state.doneLockTaken = true; // 예전엔 이 UNIQUE 충돌로 이벤트가 버려졌다.
    state.order = { ...state.order!, status: 'PAID', couponCode: 'WELCOME5', pointsRedeemed: 3000 };
    canceled(minutesAgo(5));
    const res = await post(delivery({ data: { paymentKey: 'pk-1' } }));
    expect(res.status).toBe(200);
    expect(state.casCalls).toEqual([{ from: 'PAID', to: 'CANCELLED' }]);
    expect(state.pointsReverseCalls).toEqual([{ redeemed: 3000, accrued: 0 }]);
    expect(state.couponReleaseCalls).toEqual(['WELCOME5']);
  });

  it('취소 직후(30초 이내)는 503 으로 미뤄 우리 관리자 흐름이 먼저 끝나게 한다', async () => {
    state.order!.status = 'PAID';
    canceled(new Date(NOW - 5_000).toISOString());
    const res = await post(delivery());
    expect(res.status).toBe(503);
    expect(state.casCalls).toHaveLength(0);
  });

  it('이미 CANCELLED/REFUNDED 면 무동작(관리자 흐름이 처리함)', async () => {
    state.order!.status = 'REFUNDED';
    canceled(minutesAgo(5));
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.casCalls).toHaveLength(0);
    expect(state.couponReleaseCalls).toHaveLength(0);
  });

  it('배송 완료(DELIVERED) 주문은 REFUNDED 로 전이한다', async () => {
    state.order!.status = 'DELIVERED';
    canceled(minutesAgo(5));
    await post(delivery());
    expect(state.casCalls).toEqual([{ from: 'DELIVERED', to: 'REFUNDED' }]);
  });

  it('배송 중(SHIPPED)은 자동 반영하지 않고 수동 확인으로 남긴다', async () => {
    state.order!.status = 'SHIPPED';
    canceled(minutesAgo(5));
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.casCalls).toHaveLength(0);
  });

  it('CREATED 였던 주문은 적립금만 복원하고 쿠폰은 건드리지 않는다(PAID 때만 소비)', async () => {
    state.order = { ...state.order!, status: 'CREATED', couponCode: 'WELCOME5', pointsRedeemed: 1000 };
    canceled(minutesAgo(5));
    await post(delivery());
    expect(state.casCalls).toEqual([{ from: 'CREATED', to: 'CANCELLED' }]);
    expect(state.pointsReverseCalls).toEqual([{ redeemed: 1000, accrued: 0 }]);
    expect(state.couponReleaseCalls).toHaveLength(0);
  });

  it('CAS 에서 지면 부수효과를 실행하지 않는다', async () => {
    state.order = { ...state.order!, status: 'PAID', couponCode: 'WELCOME5', pointsRedeemed: 1000 };
    state.casResult = false;
    canceled(minutesAgo(5));
    await post(delivery());
    expect(state.pointsReverseCalls).toHaveLength(0);
    expect(state.couponReleaseCalls).toHaveLength(0);
  });
});

describe('PARTIAL_CANCELED · 감사 기록', () => {
  it('우리 기록보다 큰 Toss 부분취소는 수동 보정 대상으로만 남기고 전이하지 않는다', async () => {
    state.order = { ...state.order!, status: 'PAID', refundedAmount: 0 };
    state.toss = {
      paymentKey: 'pk-1',
      orderId: ORDER_NO,
      status: 'PARTIAL_CANCELED',
      totalAmount: 12000,
      balanceAmount: 9000,
      cancels: [{ cancelAmount: 3000, canceledAt: minutesAgo(5) }],
    };
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.casCalls).toHaveLength(0);
    expect(state.auditInserts[0]).toMatchObject({ outcome: 'partial_cancel_manual' });
  });

  it('043 이 있으면 수신을 Toss 확인 상태·처리 결과와 함께 기록한다', async () => {
    await post(delivery(), {
      'tosspayments-webhook-transmission-id': 'tx-1',
      'tosspayments-webhook-transmission-retried-count': '2',
    });
    expect(state.auditInserts).toEqual([
      expect.objectContaining({
        transmission_id: 'tx-1',
        retried_count: 2,
        event_type: 'PAYMENT_STATUS_CHANGED',
        payment_key: 'pk-1',
        order_no: ORDER_NO,
        toss_status: 'DONE',
        outcome: 'settled_paid',
      }),
    ]);
  });

  it('043 미적용이면 기록만 건너뛰고 처리는 그대로 한다', async () => {
    state.auditAvailable = false;
    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(state.auditInserts).toHaveLength(0);
    expect(state.transitionCalls).toHaveLength(1);
  });
});
