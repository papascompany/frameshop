/**
 * src/lib/db/points.ts + confirmPurchase earn wiring — FS-EC-02.
 *
 * Money path: the accrual must be IDEMPOTENT (ledger check per order), the
 * summary must fail closed (available: false) when migration 031 is unapplied,
 * and an accrual failure must never roll back a purchase confirmation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { OrderId, UserId } from '@/types/common';

// ---------- Test doubles ----------

type LedgerEntry = { id: string; order_id: string | null; transaction_type: string };

type PointsTxCall = {
  p_user_id: string;
  p_order_id: string | null;
  p_type: string;
  p_delta: number;
  p_description: string;
};

type FakeState = {
  pointsBalance: number;
  profileReadFails: boolean;
  ledger: LedgerEntry[];
  ledgerReadFails: boolean;
  accrualRpcFails: boolean;
  redeemRpcFails: boolean;
  pointsTxCalls: PointsTxCall[];
  orderRow: Record<string, unknown>;
  /** 원장 사전 조회가 경쟁으로 아직 아무것도 못 보는 상황(check-then-insert 창). */
  ledgerCheckBlind: boolean;
  /** migration 044 user_points_ledger_order_type_uniq 를 RPC 에서 흉내(23505). */
  enforceLedgerUnique: boolean;
  /** getOrder 가 confirmed_at 을 null 로 본다(동시 구매확정의 오래된 읽기). */
  staleConfirmedAtRead: boolean;
  snapshotUpdates: number;
};

const state: FakeState = {
  pointsBalance: 0,
  profileReadFails: false,
  ledger: [],
  ledgerReadFails: false,
  accrualRpcFails: false,
  redeemRpcFails: false,
  pointsTxCalls: [],
  orderRow: {},
  ledgerCheckBlind: false,
  enforceLedgerUnique: false,
  staleConfirmedAtRead: false,
  snapshotUpdates: 0,
};

const probes = { points: true };

type LedgerBuilder = {
  eq(col: string, val: string): LedgerBuilder;
  limit(n: number): Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
};

function makeLedgerBuilder(): LedgerBuilder {
  const filters: Record<string, string> = {};
  const builder: LedgerBuilder = {
    eq(col, val) {
      filters[col] = val;
      return builder;
    },
    limit() {
      if (state.ledgerReadFails) {
        return Promise.resolve({
          data: null,
          error: { message: 'ledger read failed (simulated)' },
        });
      }
      if (state.ledgerCheckBlind) {
        return Promise.resolve({ data: [], error: null });
      }
      const rows = state.ledger
        .filter(
          (r) =>
            (filters.order_id == null || r.order_id === filters.order_id) &&
            (filters.transaction_type == null ||
              r.transaction_type === filters.transaction_type),
        )
        .map((r) => ({ id: r.id }));
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return builder;
}

function makeChain(table: string) {
  if (table === 'user_profiles') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            state.profileReadFails
              ? Promise.resolve({
                  data: null,
                  error: { message: 'profile read failed (simulated)' },
                })
              : Promise.resolve({
                  data: { points_balance: state.pointsBalance },
                  error: null,
                }),
        }),
      }),
    };
  }
  if (table === 'user_points_ledger') {
    return { select: () => makeLedgerBuilder() };
  }
  if (table === 'orders') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: state.staleConfirmedAtRead
                ? { ...state.orderRow, confirmed_at: null }
                : { ...state.orderRow },
              error: null,
            }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        if ('confirmed_at' in patch) {
          // confirmPurchase CAS: .eq('id').is('confirmed_at', null).select('id') —
          // applies only while the real row is still unconfirmed.
          return {
            eq: () => ({
              is: (col: string, val: null) => ({
                select: () => {
                  if (state.orderRow[col] !== val) {
                    return Promise.resolve({ data: [], error: null });
                  }
                  Object.assign(state.orderRow, patch);
                  return Promise.resolve({
                    data: [{ id: state.orderRow.id }],
                    error: null,
                  });
                },
              }),
            }),
          };
        }
        // accruePointsForOrder points_accrued snapshot: .update().eq('id').
        return {
          eq: () => {
            state.snapshotUpdates += 1;
            Object.assign(state.orderRow, patch);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }
  if (table === 'order_items') {
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    };
  }
  throw new Error(`Unmocked table: ${table}`);
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => makeChain(table),
    rpc: async (fn: string, args: unknown) => {
      if (fn === 'apply_points_transaction') {
        const call = args as PointsTxCall;
        state.pointsTxCalls.push(call);
        if (call.p_type === 'ACCRUAL' && state.accrualRpcFails) {
          return { data: null, error: { message: 'rpc failed (simulated)' } };
        }
        if (call.p_type === 'REDEMPTION' && state.redeemRpcFails) {
          return {
            data: null,
            error: { message: 'user_profiles_points_balance_check violated' },
          };
        }
        if (
          state.enforceLedgerUnique &&
          call.p_order_id != null &&
          state.ledger.some(
            (r) =>
              r.order_id === call.p_order_id &&
              r.transaction_type === call.p_type,
          )
        ) {
          // Ledger INSERT violates the partial UNIQUE → whole RPC tx rolls back
          // (balance untouched).
          return {
            data: null,
            error: {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "user_points_ledger_order_type_uniq"',
            },
          };
        }
        state.pointsBalance += call.p_delta;
        state.ledger.push({
          id: `ledger-${state.ledger.length + 1}`,
          order_id: call.p_order_id,
          transaction_type: call.p_type,
        });
        return { data: state.pointsBalance, error: null };
      }
      return { data: null, error: { message: `unmocked rpc ${fn}` } };
    },
  }),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isPointsAvailable: async () => probes.points,
  isSurchargeAvailable: async () => true,
  isReceiptAvailable: async () => true,
  isPartialRefundAvailable: async () => true,
  isConfirmAvailable: async () => true,
}));

// ---------- Fixtures ----------

const USER_ID = asBrand<UserId>('user-1');
const ORDER_ID = asBrand<OrderId>('order-uuid-1');

function makeDeliveredOrderRow(): Record<string, unknown> {
  return {
    id: 'order-uuid-1',
    order_no: '20260703-0001',
    user_id: 'user-1',
    status: 'DELIVERED',
    total_price: 28_000,
    shipping_fee: 3000,
    shipping_method: 'STANDARD',
    payment_id: null,
    tracking_number: null,
    courier: null,
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'a@b.com' },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '12345',
      addr1: '서울시',
      addr2: '',
      memo: '',
    },
    confirmed_at: null,
    created_at: new Date().toISOString(),
    paid_at: new Date().toISOString(),
    shipped_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  state.pointsBalance = 1000;
  state.profileReadFails = false;
  state.ledger = [];
  state.ledgerReadFails = false;
  state.accrualRpcFails = false;
  state.redeemRpcFails = false;
  state.pointsTxCalls = [];
  state.orderRow = makeDeliveredOrderRow();
  state.ledgerCheckBlind = false;
  state.enforceLedgerUnique = false;
  state.staleConfirmedAtRead = false;
  state.snapshotUpdates = 0;
  probes.points = true;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------- getPointsSummary ----------

describe('getPointsSummary — probe-graceful', () => {
  it('returns available: false when migration 031 is unapplied', async () => {
    const { getPointsSummary } = await import('@/lib/db/points');
    probes.points = false;
    expect(await getPointsSummary(USER_ID)).toEqual({ balance: 0, available: false });
  });

  it('returns the profile balance when available', async () => {
    const { getPointsSummary } = await import('@/lib/db/points');
    state.pointsBalance = 7777;
    expect(await getPointsSummary(USER_ID)).toEqual({ balance: 7777, available: true });
  });

  it('fails closed (available: false) on a balance read error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getPointsSummary } = await import('@/lib/db/points');
    state.profileReadFails = true;
    expect(await getPointsSummary(USER_ID)).toEqual({ balance: 0, available: false });
    errSpy.mockRestore();
  });
});

// ---------- redeem / refund guards ----------

describe('redeemPoints / refundRedeemedPoints — input guards', () => {
  it('rejects non-positive or fractional amounts without calling the RPC', async () => {
    const { redeemPoints, refundRedeemedPoints } = await import('@/lib/db/points');
    expect((await redeemPoints(USER_ID, null, 0)).ok).toBe(false);
    expect((await redeemPoints(USER_ID, null, -100)).ok).toBe(false);
    expect((await redeemPoints(USER_ID, null, 10.5)).ok).toBe(false);
    expect((await refundRedeemedPoints(USER_ID, null, 0)).ok).toBe(false);
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('deducts via REDEMPTION and returns the new balance', async () => {
    const { redeemPoints } = await import('@/lib/db/points');
    const result = await redeemPoints(USER_ID, null, 500, '주문 X 적립금 사용');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.balance).toBe(500);
    const call = state.pointsTxCalls[0];
    expect(call.p_type).toBe('REDEMPTION');
    expect(call.p_delta).toBe(-500);
    expect(call.p_description).toBe('주문 X 적립금 사용');
  });

  it('returns the RPC overdraw error as a value (never throws)', async () => {
    const { redeemPoints } = await import('@/lib/db/points');
    state.redeemRpcFails = true; // CHECK(points_balance >= 0) abort
    const result = await redeemPoints(USER_ID, null, 500);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('points_balance_check');
  });
});

// ---------- accruePointsForOrder ----------

describe('accruePointsForOrder — earn 멱등 (FS-EC-02)', () => {
  it('accrues floor(1%) once and snapshots orders.points_accrued', async () => {
    const { accruePointsForOrder } = await import('@/lib/db/points');
    const result = await accruePointsForOrder(ORDER_ID, USER_ID, 28_000);
    expect(result).toEqual({ ok: true, accrued: 280 });

    const accruals = state.pointsTxCalls.filter((c) => c.p_type === 'ACCRUAL');
    expect(accruals).toHaveLength(1);
    expect(accruals[0].p_delta).toBe(280);
    expect(accruals[0].p_order_id).toBe('order-uuid-1');
    expect(state.orderRow.points_accrued).toBe(280);
  });

  it('is idempotent: a second call for the same order accrues nothing', async () => {
    const { accruePointsForOrder } = await import('@/lib/db/points');
    const first = await accruePointsForOrder(ORDER_ID, USER_ID, 28_000);
    const second = await accruePointsForOrder(ORDER_ID, USER_ID, 28_000);
    expect(first.accrued).toBe(280);
    expect(second).toEqual({ ok: true, accrued: 0 });
    // Exactly ONE ledger mutation — no double earn.
    expect(state.pointsTxCalls.filter((c) => c.p_type === 'ACCRUAL')).toHaveLength(1);
    expect(state.pointsBalance).toBe(1000 + 280);
  });

  it('skips gracefully when migration 031 is unapplied', async () => {
    const { accruePointsForOrder } = await import('@/lib/db/points');
    probes.points = false;
    expect(await accruePointsForOrder(ORDER_ID, USER_ID, 28_000)).toEqual({
      ok: true,
      accrued: 0,
    });
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('fails closed when the idempotency check itself fails (no blind accrual)', async () => {
    const { accruePointsForOrder } = await import('@/lib/db/points');
    state.ledgerReadFails = true;
    const result = await accruePointsForOrder(ORDER_ID, USER_ID, 28_000);
    expect(result.ok).toBe(false);
    expect(result.accrued).toBe(0);
    // Better to earn late (ops backfill) than risk earning twice.
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('accrues nothing for a 0/negative total (free order edge)', async () => {
    const { accruePointsForOrder } = await import('@/lib/db/points');
    expect(await accruePointsForOrder(ORDER_ID, USER_ID, 0)).toEqual({
      ok: true,
      accrued: 0,
    });
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('23505(044 UNIQUE) 는 멱등 성공 — 사전 조회를 통과한 경쟁 호출도 이중 적립하지 않는다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { accruePointsForOrder } = await import('@/lib/db/points');
    state.enforceLedgerUnique = true;

    const first = await accruePointsForOrder(ORDER_ID, USER_ID, 28_000);
    // 경쟁: 두 번째 호출의 사전 조회가 첫 원장 행을 아직 못 봤다.
    state.ledgerCheckBlind = true;
    const second = await accruePointsForOrder(ORDER_ID, USER_ID, 28_000);

    expect(first).toEqual({ ok: true, accrued: 280 });
    expect(second).toEqual({ ok: true, accrued: 0 });
    expect(state.pointsBalance).toBe(1000 + 280);
    expect(state.ledger.filter((r) => r.transaction_type === 'ACCRUAL')).toHaveLength(1);
    // 진 호출은 스냅샷을 다시 쓰지 않는다.
    expect(state.snapshotUpdates).toBe(1);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ---------- confirmPurchase wiring ----------

describe('confirmPurchase — earn 연결 (FS-EC-02)', () => {
  it('confirms then accrues 1%; a retry after confirmation earns nothing', async () => {
    const { confirmPurchase } = await import('@/lib/db/order');

    const first = await confirmPurchase(ORDER_ID, USER_ID);
    expect(first).toEqual({ ok: true });
    expect(state.orderRow.confirmed_at).not.toBeNull();
    expect(state.pointsTxCalls.filter((c) => c.p_type === 'ACCRUAL')).toHaveLength(1);
    expect(state.pointsTxCalls[0].p_delta).toBe(280); // floor(28000 * 1%)

    // Idempotent short-circuit: already confirmed → no second accrual.
    const second = await confirmPurchase(ORDER_ID, USER_ID);
    expect(second).toEqual({ ok: true });
    expect(state.pointsTxCalls.filter((c) => c.p_type === 'ACCRUAL')).toHaveLength(1);
  });

  it('stays idempotent even if confirmed_at is lost (ledger is the backstop)', async () => {
    const { confirmPurchase } = await import('@/lib/db/order');
    await confirmPurchase(ORDER_ID, USER_ID);
    // Simulate a racing confirm that read confirmed_at as null.
    state.orderRow.confirmed_at = null;
    await confirmPurchase(ORDER_ID, USER_ID);
    expect(state.pointsTxCalls.filter((c) => c.p_type === 'ACCRUAL')).toHaveLength(1);
  });

  it('does not roll back the confirmation when the accrual RPC fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { confirmPurchase } = await import('@/lib/db/order');
    state.accrualRpcFails = true;

    const result = await confirmPurchase(ORDER_ID, USER_ID);
    expect(result).toEqual({ ok: true }); // 확정 유지 — 적립은 후속 보정 대상
    expect(state.orderRow.confirmed_at).not.toBeNull();
    expect(state.orderRow.points_accrued).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('confirmPurchase — 동시성 (보안 검토 P1-1, confirmed_at CAS)', () => {
  it('이중 호출(둘 다 미확정으로 읽음) → confirmed_at CAS 진 쪽은 적립을 건너뛴다', async () => {
    const { confirmPurchase } = await import('@/lib/db/order');
    // 두 요청 모두 confirmed_at null 을 읽었고, 원장 사전 조회도 경쟁으로 비어 있다 —
    // CAS 만이 이중 적립을 막는 상황.
    state.staleConfirmedAtRead = true;
    state.ledgerCheckBlind = true;

    const first = await confirmPurchase(ORDER_ID, USER_ID);
    const second = await confirmPurchase(ORDER_ID, USER_ID);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(state.pointsTxCalls.filter((c) => c.p_type === 'ACCRUAL')).toHaveLength(1);
    expect(state.pointsBalance).toBe(1000 + 280);
  });

  it('동시 호출(Promise.all) → 적립 정확히 1회', async () => {
    const { confirmPurchase } = await import('@/lib/db/order');
    state.enforceLedgerUnique = true;

    const results = await Promise.all([
      confirmPurchase(ORDER_ID, USER_ID),
      confirmPurchase(ORDER_ID, USER_ID),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(state.orderRow.confirmed_at).not.toBeNull();
    expect(state.ledger.filter((r) => r.transaction_type === 'ACCRUAL')).toHaveLength(1);
    expect(state.pointsBalance).toBe(1000 + 280);
  });
});
