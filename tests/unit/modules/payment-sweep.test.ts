/**
 * 결제 백스톱 스윕 (src/lib/payment/sweep.ts) — CREATED 주문을 Toss 실제 결제
 * 상태로 판정해 PAID 정산 / 방치 만료 / 무변경을 고르는지 고정한다.
 * DB·Toss·confirmPayment·적립금은 전부 vi.mock — 판정 로직만 검증한다.
 * 후보 조회 mock 은 실제 쿼리와 같은 최신 순 (created_at, id) 키셋 페이지네이션을
 * 흉내 낸다(보안 검토 P1-8 기아 방지 회귀 고정).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Candidate = { id: string; orderNo: string; totalPrice: number; createdAt: string };
type Cursor = { createdAt: string; id: string };
type TossPayment = { paymentKey: string; orderId: string; status: string; totalAmount: number };

const NOW = new Date('2026-10-28T12:00:00Z');
const HOURS = 60 * 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const state: {
  tossConfigured: boolean;
  candidates: Candidate[];
  listArgs: Array<{ createdBefore: Date; limit: number; after?: Cursor }>;
  /** 쿼리 이상 시뮬레이션 — 커서를 무시하고 늘 첫 페이지를 돌려준다. */
  ignoreCursor: boolean;
  /** 주입 시계(ms) — Toss 조회 1건마다 msPerLookup 만큼 흐른다. */
  clockMs: number;
  msPerLookup: number;
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
  ignoreCursor: false,
  clockMs: 0,
  msPerLookup: 0,
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
  // 실제 쿼리 미러: created_at DESC, id DESC + (created_at, id) < after 키셋.
  listStaleCreatedOrders: async (createdBefore: Date, limit: number, after?: Cursor) => {
    state.listArgs.push({ createdBefore, limit, after });
    const desc = (a: Candidate, b: Candidate) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    const isBefore = (c: Candidate, k: Cursor) =>
      c.createdAt < k.createdAt || (c.createdAt === k.createdAt && c.id < k.id);
    return [...state.candidates]
      .sort(desc)
      .filter((c) => state.ignoreCursor || !after || isBefore(c, after))
      .slice(0, limit);
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
        state.clockMs += state.msPerLookup;
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
  state.ignoreCursor = false;
  state.clockMs = 0;
  state.msPerLookup = 0;
  state.toss = {};
  state.confirmCalls = [];
  state.confirmResult = { ok: true };
  state.casCalls = [];
  state.casResult = true;
  state.orderPoints = { userId: null, pointsRedeemed: 0, pointsAccrued: 0 };
  state.reverseCalls = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function sweep(opts: { timeBudgetMs?: number } = {}) {
  const { sweepUnconfirmedOrders } = await import('@/lib/payment/sweep');
  return sweepUnconfirmedOrders(NOW, { clock: () => state.clockMs, ...opts });
}

describe('sweepUnconfirmedOrders', () => {
  it('Toss 키가 없으면 아무것도 조회·변경하지 않는다', async () => {
    state.tossConfigured = false;
    state.candidates = [{ id: 'o1', orderNo: '20261001-0001', totalPrice: 10000, createdAt: ago(72 * HOURS) }];
    const summary = await sweep();
    expect(summary).toEqual({
      skipped: 'TOSS_NOT_CONFIGURED',
      scanned: 0,
      pages: 0,
      hasMore: false,
      outcomes: [],
    });
    expect(state.listArgs).toHaveLength(0);
    expect(state.casCalls).toHaveLength(0);
  });

  it('15분보다 젊은 주문은 후보 조회에서 제외한다(cutoff = now − 15분)', async () => {
    await sweep();
    expect(state.listArgs).toHaveLength(1);
    expect(state.listArgs[0].createdBefore.toISOString()).toBe(ago(15 * 60_000));
    expect(state.listArgs[0].limit).toBe(20);
    expect(state.listArgs[0].after).toBeUndefined();
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
      { id: 'o2', orderNo: '20261001-0008', totalPrice: 5000, createdAt: ago(73 * HOURS) },
    ];
    state.toss['20261001-0007'] = new Error('network down');
    const summary = await sweep();
    expect(summary.scanned).toBe(2);
    expect(summary.outcomes.map((o) => o.action)).toEqual(['error', 'expired']);
  });
});

describe('sweepUnconfirmedOrders — 감사 로그 (보안 검토 P2-5)', () => {
  it('주문별 결과는 프로덕션 빌드에서 제거되지 않는 console.info 로 남긴다', async () => {
    state.candidates = [{ id: 'o1', orderNo: '20261027-0001', totalPrice: 16800, createdAt: ago(2 * HOURS) }];
    state.toss = { '20261027-0001': { paymentKey: 'pk-1', orderId: '20261027-0001', status: 'DONE', totalAmount: 16800 } };
    await sweep();
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"event":"payment_sweep_order"'));
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('sweepUnconfirmedOrders — 기아 방지 (보안 검토 P1-8)', () => {
  /** 결제 없는 24시간 미만 주문 n건(waiting) — i 가 클수록 오래됨. */
  const waitingOrders = (n: number, baseAgoMs = 1 * HOURS): Candidate[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `w${String(i).padStart(3, '0')}`,
      orderNo: `20261028-${String(i + 1).padStart(4, '0')}`,
      totalPrice: 5000,
      createdAt: ago(baseAgoMs + i * 60_000),
    }));

  it('앞 20건(첫 페이지)이 모두 waiting 이어도 21번째 DONE 주문이 정산된다', async () => {
    const done: Candidate = { id: 'd1', orderNo: '20261028-9001', totalPrice: 16800, createdAt: ago(5 * HOURS) };
    state.candidates = [...waitingOrders(20), done];
    state.toss[done.orderNo] = { paymentKey: 'pk-21', orderId: done.orderNo, status: 'DONE', totalAmount: 16800 };

    const summary = await sweep();

    expect(state.confirmCalls.map((c) => c.input.orderId)).toEqual([done.orderNo]);
    expect(summary.outcomes).toHaveLength(21);
    expect(summary.outcomes[20]).toMatchObject({ orderNo: done.orderNo, action: 'confirmed' });
    expect(summary.outcomes.slice(0, 20).every((o) => o.action === 'waiting')).toBe(true);
    expect(summary).toMatchObject({ scanned: 21, pages: 2, hasMore: false });
  });

  it('다음 페이지는 직전 페이지 마지막 행의 (created_at, id) 커서로 읽어 이미 판정한 주문을 건너뛴다', async () => {
    state.candidates = waitingOrders(45);

    const summary = await sweep();

    const seen = summary.outcomes.map((o) => o.orderNo);
    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
    expect(summary.pages).toBe(3);
    // 최신 순: 첫 페이지 마지막(20번째) 행이 두 번째 조회의 커서다.
    expect(state.listArgs.map((a) => a.after?.id)).toEqual([undefined, 'w019', 'w039']);
    expect(state.listArgs[1].after?.createdAt).toBe(ago(1 * HOURS + 19 * 60_000));
    // 모든 페이지가 같은 cutoff 를 쓴다(실행 중에 생긴 주문을 끌어오지 않음).
    expect(new Set(state.listArgs.map((a) => a.createdBefore.toISOString())).size).toBe(1);
  });

  it('후보 수가 페이지 크기의 배수면 빈 페이지를 확인하고 끝낸다(hasMore=false)', async () => {
    state.candidates = waitingOrders(40);
    const summary = await sweep();
    expect(summary).toMatchObject({ scanned: 40, pages: 3, hasMore: false });
  });

  it('시간 예산이 끝나면 새 주문 판정을 멈추고 hasMore 를 보고한다', async () => {
    state.candidates = waitingOrders(30);
    state.msPerLookup = 1_000; // 25초 예산 → 25건

    const summary = await sweep();

    expect(summary.scanned).toBe(25);
    expect(summary.hasMore).toBe(true);
  });

  it('최신 순 — 끝내 CREATED 로 남는 오래된 manual·조회 실패 행이 최근 DONE 정산을 막지 않는다', async () => {
    const stale: Candidate[] = Array.from({ length: 30 }, (_, i) => ({
      id: `m${String(i).padStart(3, '0')}`,
      orderNo: `20261001-${String(i + 1).padStart(4, '0')}`,
      totalPrice: 5000,
      createdAt: ago(10 * 24 * HOURS + i * 60_000),
    }));
    for (const [i, c] of stale.entries()) {
      state.toss[c.orderNo] =
        i % 2 === 0
          ? { paymentKey: `pk-${c.id}`, orderId: c.orderNo, status: 'WAITING_FOR_DEPOSIT', totalAmount: 5000 }
          : new Error('network down');
    }
    const done: Candidate = { id: 'd1', orderNo: '20261028-9002', totalPrice: 9900, createdAt: ago(2 * HOURS) };
    state.candidates = [...stale, done];
    state.toss[done.orderNo] = { paymentKey: 'pk-new', orderId: done.orderNo, status: 'DONE', totalAmount: 9900 };
    state.msPerLookup = 1_000;

    // 예산이 2건분뿐이어도 최근 DONE 이 먼저 판정된다.
    const summary = await sweep({ timeBudgetMs: 1_500 });

    expect(summary.outcomes[0]).toMatchObject({ orderNo: done.orderNo, action: 'confirmed' });
    expect(summary.scanned).toBe(2);
    expect(summary.hasMore).toBe(true);
  });

  it('커서가 전진하지 않으면(쿼리 이상) 같은 페이지를 다시 판정하지 않고 멈춘다', async () => {
    state.candidates = waitingOrders(20);
    state.ignoreCursor = true;

    const summary = await sweep();

    expect(summary.scanned).toBe(20);
    expect(summary).toMatchObject({ pages: 2, hasMore: true });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"event":"payment_sweep_cursor_stalled"'),
    );
  });
});
