/**
 * reversePointsForOrder — 환불/취소 원장 정합 (FS-EC P1-1).
 *
 * Money path: (a) 사용분 복원 ADJUSTMENT(+redeemed), (b) 적립분 회수
 * REFUND(−accrued). 두 다리 모두 (order_id, transaction_type) 멱등이어야 하고,
 * 031 미적용이면 전부 skip, 잔액 부족(RPC CHECK) 회수 실패는 구조화 로그 후
 * 계속(은폐 금지, throw 금지)이어야 한다.
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
  ledger: LedgerEntry[];
  ledgerReadFails: boolean;
  refundRpcFails: boolean;
  pointsTxCalls: PointsTxCall[];
};

const state: FakeState = {
  pointsBalance: 0,
  ledger: [],
  ledgerReadFails: false,
  refundRpcFails: false,
  pointsTxCalls: [],
};

const probes = { points: true };

type LedgerBuilder = {
  eq(col: string, val: string): LedgerBuilder;
  limit(n: number): Promise<{
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  }>;
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

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      if (table === 'user_points_ledger') {
        return { select: () => makeLedgerBuilder() };
      }
      throw new Error(`Unmocked table: ${table}`);
    },
    rpc: async (fn: string, args: unknown) => {
      if (fn === 'apply_points_transaction') {
        const call = args as PointsTxCall;
        state.pointsTxCalls.push(call);
        if (call.p_type === 'REFUND' && state.refundRpcFails) {
          // 고객이 이미 포인트를 소진 → CHECK(points_balance >= 0) abort.
          return {
            data: null,
            error: { message: 'user_profiles_points_balance_check violated' },
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

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.pointsBalance = 1000;
  state.ledger = [];
  state.ledgerReadFails = false;
  state.refundRpcFails = false;
  state.pointsTxCalls = [];
  probes.points = true;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('reversePointsForOrder — 정상 경로', () => {
  it('사용분 복원(ADJUSTMENT +)과 적립분 회수(REFUND −)를 order_id 결합으로 기록한다', async () => {
    const { reversePointsForOrder } = await import('@/lib/db/points');

    const result = await reversePointsForOrder(ORDER_ID, USER_ID, {
      redeemed: 5000,
      accrued: 280,
    });

    expect(result).toEqual({ ok: true, restored: 5000, reclaimed: 280 });
    expect(state.pointsTxCalls).toHaveLength(2);

    const [restore, reclaim] = state.pointsTxCalls;
    expect(restore.p_type).toBe('ADJUSTMENT');
    expect(restore.p_delta).toBe(5000);
    expect(restore.p_order_id).toBe('order-uuid-1');
    expect(restore.p_description).toBe('주문 취소/환불 — 사용 적립금 복원');

    expect(reclaim.p_type).toBe('REFUND');
    expect(reclaim.p_delta).toBe(-280);
    expect(reclaim.p_order_id).toBe('order-uuid-1');
    expect(reclaim.p_description).toBe('주문 환불 — 적립 회수');

    // 순변화 = +5000 − 280.
    expect(state.pointsBalance).toBe(1000 + 5000 - 280);
  });

  it('redeemed/accrued 가 모두 0이면 아무것도 하지 않는다', async () => {
    const { reversePointsForOrder } = await import('@/lib/db/points');
    const result = await reversePointsForOrder(ORDER_ID, USER_ID, {
      redeemed: 0,
      accrued: 0,
    });
    expect(result).toEqual({ ok: true, restored: 0, reclaimed: 0 });
    expect(state.pointsTxCalls).toHaveLength(0);
  });
});

describe('reversePointsForOrder — 멱등', () => {
  it('두 번째 호출은 원장 존재로 skip — 이중 복원/이중 회수 없음', async () => {
    const { reversePointsForOrder } = await import('@/lib/db/points');

    const first = await reversePointsForOrder(ORDER_ID, USER_ID, {
      redeemed: 5000,
      accrued: 280,
    });
    const second = await reversePointsForOrder(ORDER_ID, USER_ID, {
      redeemed: 5000,
      accrued: 280,
    });

    expect(first).toEqual({ ok: true, restored: 5000, reclaimed: 280 });
    expect(second).toEqual({ ok: true, restored: 0, reclaimed: 0 });
    // RPC 는 정확히 2번(첫 호출의 두 다리)만.
    expect(state.pointsTxCalls).toHaveLength(2);
    expect(state.pointsBalance).toBe(1000 + 5000 - 280);
  });

  it('한 다리만 기록된 상태(부분 실패 후 재시도)면 나머지 다리만 마저 적용한다', async () => {
    const { reversePointsForOrder } = await import('@/lib/db/points');
    // 이전 시도에서 ADJUSTMENT 만 성공한 상황을 시뮬레이션.
    state.ledger.push({
      id: 'ledger-pre',
      order_id: 'order-uuid-1',
      transaction_type: 'ADJUSTMENT',
    });

    const result = await reversePointsForOrder(ORDER_ID, USER_ID, {
      redeemed: 5000,
      accrued: 280,
    });

    expect(result).toEqual({ ok: true, restored: 0, reclaimed: 280 });
    expect(state.pointsTxCalls).toHaveLength(1);
    expect(state.pointsTxCalls[0].p_type).toBe('REFUND');
  });

  it('멱등 체크 자체가 실패하면 해당 다리를 적용하지 않는다(fail closed)', async () => {
    const { reversePointsForOrder } = await import('@/lib/db/points');
    state.ledgerReadFails = true;

    const result = await reversePointsForOrder(ORDER_ID, USER_ID, {
      redeemed: 5000,
      accrued: 280,
    });

    expect(result.ok).toBe(false);
    expect(result.restored).toBe(0);
    expect(result.reclaimed).toBe(0);
    // 이중 지급 위험 > 늦은 보정 — RPC 호출 0.
    expect(state.pointsTxCalls).toHaveLength(0);
    const logged = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('points_reversal_failed');
  });
});

describe('reversePointsForOrder — graceful / 은폐 금지', () => {
  it('031 미적용(probe false)이면 전부 skip 하고 스키마에 접근하지 않는다', async () => {
    const { reversePointsForOrder } = await import('@/lib/db/points');
    probes.points = false;

    const result = await reversePointsForOrder(ORDER_ID, USER_ID, {
      redeemed: 5000,
      accrued: 280,
    });

    expect(result).toEqual({ ok: true, restored: 0, reclaimed: 0 });
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('회수(REFUND)가 잔액 부족 CHECK 로 실패해도 복원은 유지되고 구조화 로그를 남긴다', async () => {
    const { reversePointsForOrder } = await import('@/lib/db/points');
    state.refundRpcFails = true;

    const result = await reversePointsForOrder(ORDER_ID, USER_ID, {
      redeemed: 5000,
      accrued: 280,
    });

    // throw 하지 않고 값으로 반환 — 주 흐름(환불)을 실패시키지 않는다.
    expect(result.ok).toBe(false);
    expect(result.restored).toBe(5000);
    expect(result.reclaimed).toBe(0);
    expect(result.error).toContain('points_balance_check');
    // 복원 다리는 살아 있다.
    expect(state.pointsBalance).toBe(1000 + 5000);
    const logged = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('points_reversal_failed');
  });
});
