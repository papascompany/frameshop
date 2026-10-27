/**
 * 결제 백스톱 스윕 (src/lib/payment/sweep.ts) — CREATED 주문을 Toss 실제 결제
 * 상태로 판정해 PAID 정산 / 방치 만료 / 무변경을 고르는지 고정한다.
 * DB·Toss·confirmPayment·적립금은 전부 vi.mock — 판정 로직만 검증한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Candidate = { id: string; orderNo: string; totalPrice: number; createdAt: string };
type TossPayment = { paymentKey: string; orderId: string; status: string; totalAmount: number };

const NOW = new Date('2026-10-28T12:00:00Z');
const HOURS = 60 * 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const state: {
  tossConfigured: boolean;
  candidates: Candidate[];
  listArgs: Array<{ createdBefore: Date; limit: number }>;
  /** orderNo → Toss 조회 결과. Error 면 throw. 없으면 NOT_FOUND_PAYMENT. */
  toss: Record<string, TossPayment | Error>;
  confirmCalls: Array<{ input: { paymentKey: string; orderId: string; amount: number }; opts: unknown }>;
  confirmResult: { ok: true } | { ok: false; code: string; message: string };
  casCalls: Array<{ orderId: string; from: string; to: string }>;
  casResult: boolean;
  orderPoints: { userId: string | null; pointsRedeemed: number; pointsAccrued: number };
  reverseCalls: Array<{ orderId: string; userId: string; amounts: { redeemed: number; accrued: number } }>;
} = {
  tossConfigured: true,
  candidates: [],
  listArgs: [],
  toss: {},
  confirmCalls: [],
  confirmResult: { ok: true },
  casCalls: [],
  casResult: true,
  orderPoints: { userId: null, pointsRedeemed: 0, pointsAccrued: 0 },
  reverseCalls: [],
};

vi.mock('@/lib/env', () => ({
  getEffectiveTossSecretKey: async () => {
    if (!state.tossConfigured) throw new Error('Toss 시크릿 키가 설정되지 않았습니다.');
    return 'test_sk_dummy';
  },
}));

vi.mock('@/lib/db/order', () => ({
  listStaleCreatedOrders: async (createdBefore: Date, limit: number) => {
    state.listArgs.push({ createdBefore, limit });
    return state.candidates;
  },
  transitionIfStatus: async (orderId: string, from: string, to: string) => {
    state.casCalls.push({ orderId, from, to });
    return state.casResult;
  },
  getOrder: async (orderNo: string) => {
    const c = state.candidates.find((x) => x.orderNo === orderNo);
    return c ? { id: c.id, orderNo: c.orderNo, ...state.orderPoints } : null;
  },
}));

vi.mock('@/lib/db/points', () => ({
  reversePointsForOrder: async (
    orderId: string,
    userId: string,
    amounts: { redeemed: number; accrued: number },
  ) => {
    state.reverseCalls.push({ orderId, userId, amounts });
    return { ok: true, restored: amounts.redeemed, reclaimed: amounts.accrued };
  },
}));

vi.mock('@/lib/payment/confirm', () => ({
  confirmPayment: async (
    input: { paymentKey: string; orderId: string; amount: number },
    opts: unknown,
  ) => {
    state.confirmCalls.push({ input, opts });
    return state.confirmResult;
  },
}));

vi.mock('@/lib/payment/toss', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment/toss')>(
    '@/lib/payment/toss',
  );
  return {
    ...actual,
    tossClient: {
      getPaymentByOrderId: async (orderId: string) => {
        const hit = state.toss[orderId];
        if (hit instanceof Error) throw hit;
        if (!hit) {
          throw new actual.TossApiError(404, 'NOT_FOUND_PAYMENT', '존재하지 않는 결제 정보 입니다.');
        }
        return hit;
      },
    },
  };
});

beforeEach(() => {
  state.tossConfigured = true;
  state.candidates = [];
  state.listArgs = [];
  state.toss = {};
  state.confirmCalls = [];
  state.confirmResult = { ok: true };
  state.casCalls = [];
  state.casResult = true;
  state.orderPoints = { userId: null, pointsRedeemed: 0, pointsAccrued: 0 };
  state.reverseCalls = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

async function sweep() {
  const { sweepUnconfirmedOrders } = await import('@/lib/payment/sweep');
  return sweepUnconfirmedOrders(NOW);
}

describe('sweepUnconfirmedOrders', () => {
  it('Toss 키가 없으면 아무것도 조회·변경하지 않는다', async () => {
    state.tossConfigured = false;
    state.candidates = [{ id: 'o1', orderNo: '20261001-0001', totalPrice: 10000, createdAt: ago(72 * HOURS) }];
    const summary = await sweep();
    expect(summary).toEqual({ skipped: 'TOSS_NOT_CONFIGURED', scanned: 0, outcomes: [] });
    expect(state.listArgs).toHaveLength(0);
    expect(state.casCalls).toHaveLength(0);
  });

  it('15분보다 젊은 주문은 후보 조회에서 제외한다(cutoff = now − 15분)', async () => {
    await sweep();
    expect(state.listArgs).toHaveLength(1);
    expect(state.listArgs[0].createdBefore.toISOString()).toBe(ago(15 * 60_000));
    expect(state.listArgs[0].limit).toBe(20);
  });

  it('DONE(돈은 받았는데 DB 는 CREATED) → DB 금액으로 confirmPayment + 락 인수 허용', async () => {
    state.candidates = [{ id: 'o1', orderNo: '20261027-0001', totalPrice: 16800, createdAt: ago(2 * HOURS) }];
    state.toss['20261027-0001'] = { paymentKey: 'pk-done', orderId: '20261027-0001', status: 'DONE', totalAmount: 16800 };
    const summary = await sweep();
    expect(state.confirmCalls).toEqual([
      {
        input: { paymentKey: 'pk-done', orderId: '20261027-0001', amount: 16800 },
        opts: { takeOverStaleLock: true },
      },
    ]);
    expect(summary.outcomes[0]).toMatchObject({ tossStatus: 'DONE', action: 'confirmed' });
    expect(state.casCalls).toHaveLength(0);
  });

  it('IN_PROGRESS → 승인 시도, 실패하면 confirm_failed 로 남기고 상태는 건드리지 않는다', async () => {
    state.candidates = [{ id: 'o1', orderNo: '20261027-0002', totalPrice: 9000, createdAt: ago(30 * 60_000) }];
    state.toss['20261027-0002'] = { paymentKey: 'pk-ip', orderId: '20261027-0002', status: 'IN_PROGRESS', totalAmount: 9000 };
    state.confirmResult = { ok: false, code: 'TOSS_REJECTED', message: 'expired' };
    const summary = await sweep();
    expect(state.confirmCalls).toHaveLength(1);
    expect(summary.outcomes[0]).toMatchObject({ action: 'confirm_failed', detail: 'TOSS_REJECTED: expired' });
    expect(state.casCalls).toHaveLength(0);
  });

  it('결제 없음 + 24시간 경과 → CREATED→CANCELLED CAS + 사용 적립금 복원', async () => {
    state.candidates = [{ id: 'o1', orderNo: '20261020-0001', totalPrice: 20000, createdAt: ago(25 * HOURS) }];
    state.orderPoints = { userId: 'user-1', pointsRedeemed: 3000, pointsAccrued: 0 };
    const summary = await sweep();
    expect(state.casCalls).toEqual([{ orderId: 'o1', from: 'CREATED', to: 'CANCELLED' }]);
    expect(state.reverseCalls).toEqual([
      { orderId: 'o1', userId: 'user-1', amounts: { redeemed: 3000, accrued: 0 } },
    ]);
    expect(summary.outcomes[0]).toMatchObject({ tossStatus: 'NOT_FOUND', action: 'expired' });
    expect(state.confirmCalls).toHaveLength(0);
  });

  it.each(['READY', 'EXPIRED', 'ABORTED', 'CANCELED'])(
    'Toss %s + 24시간 경과 → 만료',
    async (status) => {
      state.candidates = [{ id: 'o1', orderNo: '20261020-0002', totalPrice: 5000, createdAt: ago(30 * HOURS) }];
      state.toss['20261020-0002'] = { paymentKey: 'pk', orderId: '20261020-0002', status, totalAmount: 5000 };
      const summary = await sweep();
      expect(summary.outcomes[0]).toMatchObject({ tossStatus: status, action: 'expired' });
    },
  );

  it('결제 없음이어도 24시간 전이면 기다린다(만료하지 않음)', async () => {
    state.candidates = [{ id: 'o1', orderNo: '20261028-0001', totalPrice: 5000, createdAt: ago(3 * HOURS) }];
    const summary = await sweep();
    expect(summary.outcomes[0]).toMatchObject({ action: 'waiting' });
    expect(state.casCalls).toHaveLength(0);
  });

  it('비회원·적립금 미사용 주문은 만료만 하고 적립금 원장은 건드리지 않는다', async () => {
    state.candidates = [{ id: 'o1', orderNo: '20261020-0003', totalPrice: 5000, createdAt: ago(48 * HOURS) }];
    state.orderPoints = { userId: null, pointsRedeemed: 0, pointsAccrued: 0 };
    await sweep();
    expect(state.casCalls).toHaveLength(1);
    expect(state.reverseCalls).toHaveLength(0);
  });

  it('CAS 에서 지면(다른 경로가 먼저 처리) 적립금을 복원하지 않는다', async () => {
    state.candidates = [{ id: 'o1', orderNo: '20261020-0004', totalPrice: 5000, createdAt: ago(48 * HOURS) }];
    state.orderPoints = { userId: 'user-1', pointsRedeemed: 1000, pointsAccrued: 0 };
    state.casResult = false;
    const summary = await sweep();
    expect(summary.outcomes[0]).toMatchObject({ action: 'lost_race' });
    expect(state.reverseCalls).toHaveLength(0);
  });

  it('Toss 조회 실패(인증 오류·5xx·네트워크)는 절대 만료하지 않는다', async () => {
    const { TossApiError } = await import('@/lib/payment/toss');
    state.candidates = [{ id: 'o1', orderNo: '20261001-0005', totalPrice: 5000, createdAt: ago(72 * HOURS) }];
    state.toss['20261001-0005'] = new TossApiError(401, 'UNAUTHORIZED_KEY', 'invalid key');
    const summary = await sweep();
    expect(summary.outcomes[0]).toMatchObject({ tossStatus: 'LOOKUP_FAILED', action: 'error' });
    expect(state.casCalls).toHaveLength(0);
  });

  it.each(['WAITING_FOR_DEPOSIT', 'PARTIAL_CANCELED'])(
    'Toss %s 는 수동 확인 대상으로 남긴다',
    async (status) => {
      state.candidates = [{ id: 'o1', orderNo: '20261001-0006', totalPrice: 5000, createdAt: ago(72 * HOURS) }];
      state.toss['20261001-0006'] = { paymentKey: 'pk', orderId: '20261001-0006', status, totalAmount: 5000 };
      const summary = await sweep();
      expect(summary.outcomes[0]).toMatchObject({ action: 'manual' });
      expect(state.casCalls).toHaveLength(0);
      expect(state.confirmCalls).toHaveLength(0);
    },
  );

  it('한 주문의 오류가 나머지 처리를 막지 않는다', async () => {
    state.candidates = [
      { id: 'o1', orderNo: '20261001-0007', totalPrice: 5000, createdAt: ago(72 * HOURS) },
      { id: 'o2', orderNo: '20261001-0008', totalPrice: 5000, createdAt: ago(72 * HOURS) },
    ];
    state.toss['20261001-0007'] = new Error('network down');
    const summary = await sweep();
    expect(summary.scanned).toBe(2);
    expect(summary.outcomes.map((o) => o.action)).toEqual(['error', 'expired']);
  });
});
