/**
 * /api/account/points GET 계약 테스트 (FS-EC-01 IT).
 *
 * graceful 계약:
 *  - 비로그인 → 401 UNAUTHENTICATED (체크아웃의 게스트 fetch 는 조용히 숨김).
 *  - migration 031 미적용(probe false) → 200 { ok:true, available:false,
 *    balance:0, ledger:[] } — 이때 스키마 쿼리는 실행되지 않아야 한다.
 *  - 적용 시 → 잔액(user_profiles) + 최근 원장(user_points_ledger, 명시 컬럼)
 *    을 camelCase 도메인 뷰로 매핑.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type LedgerRowFixture = {
  id: string;
  user_id: string;
  order_id: string | null;
  transaction_type: string;
  points_delta: number;
  balance_after: number;
  description: string | null;
  created_at: string;
};

const mockState: {
  user: { id: string } | null;
  pointsAvailable: boolean;
  profileRow: { points_balance: number } | null;
  profileError: { message: string } | null;
  ledgerRows: LedgerRowFixture[];
  fromCalls: string[];
} = {
  user: null,
  pointsAvailable: false,
  profileRow: null,
  profileError: null,
  ledgerRows: [],
  fromCalls: [],
};

vi.mock('@/lib/db/feature-probe', () => ({
  isPointsAvailable: () => Promise.resolve(mockState.pointsAvailable),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockState.user } }),
    },
    from: (table: string) => {
      mockState.fromCalls.push(table);
      if (table === 'user_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: mockState.profileRow,
                error: mockState.profileError,
              }),
            }),
          }),
        };
      }
      if (table === 'user_points_ledger') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: mockState.ledgerRows,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unmocked table: ${table}`);
    },
  }),
}));

import { GET } from '@/app/api/account/points/route';

type PointsResponse = {
  ok: boolean;
  code?: string;
  available?: boolean;
  balance?: number;
  ledger?: Array<{
    id: string;
    userId: string;
    orderId: string | null;
    transactionType: string;
    pointsDelta: number;
    balanceAfter: number;
    description: string | null;
    createdAt: string;
  }>;
};

async function call(): Promise<{ status: number; body: PointsResponse }> {
  const res = await GET();
  return { status: res.status, body: (await res.json()) as PointsResponse };
}

beforeEach(() => {
  mockState.user = null;
  mockState.pointsAvailable = false;
  mockState.profileRow = null;
  mockState.profileError = null;
  mockState.ledgerRows = [];
  mockState.fromCalls = [];
});

describe('GET /api/account/points', () => {
  it('비로그인 → 401 UNAUTHENTICATED', async () => {
    const { status, body } = await call();
    expect(status).toBe(401);
    expect(body).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('031 미적용(probe false) → graceful 응답 + 스키마 쿼리 미실행', async () => {
    mockState.user = { id: 'user-1' };
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      available: false,
      balance: 0,
      ledger: [],
    });
    // graceful 핵심: 존재하지 않을 수 있는 테이블에 접근하지 않는다.
    expect(mockState.fromCalls).not.toContain('user_profiles');
    expect(mockState.fromCalls).not.toContain('user_points_ledger');
  });

  it('적용 + 잔액/원장 존재 → camelCase 매핑 응답', async () => {
    mockState.user = { id: 'user-1' };
    mockState.pointsAvailable = true;
    mockState.profileRow = { points_balance: 1_500 };
    mockState.ledgerRows = [
      {
        id: 'l-2',
        user_id: 'user-1',
        order_id: 'order-9',
        transaction_type: 'REDEMPTION',
        points_delta: -500,
        balance_after: 1_500,
        description: '주문 사용',
        created_at: '2026-07-02T00:00:00.000Z',
      },
      {
        id: 'l-1',
        user_id: 'user-1',
        order_id: null,
        transaction_type: 'ACCRUAL',
        points_delta: 2_000,
        balance_after: 2_000,
        description: null,
        created_at: '2026-07-01T00:00:00.000Z',
      },
    ];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.available).toBe(true);
    expect(body.balance).toBe(1_500);
    expect(body.ledger).toHaveLength(2);
    expect(body.ledger?.[0]).toEqual({
      id: 'l-2',
      userId: 'user-1',
      orderId: 'order-9',
      transactionType: 'REDEMPTION',
      pointsDelta: -500,
      balanceAfter: 1_500,
      description: '주문 사용',
      createdAt: '2026-07-02T00:00:00.000Z',
    });
    expect(body.ledger?.[1]?.orderId).toBeNull();
  });

  it('적용 + 프로필 행 없음(첫 적립 전) → 잔액 0', async () => {
    mockState.user = { id: 'user-1' };
    mockState.pointsAvailable = true;
    const { body } = await call();
    expect(body).toEqual({ ok: true, available: true, balance: 0, ledger: [] });
  });

  it('적용 + 조회 오류 → 500 DB_ERROR', async () => {
    mockState.user = { id: 'user-1' };
    mockState.pointsAvailable = true;
    mockState.profileError = { message: 'boom' };
    const { status, body } = await call();
    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, code: 'DB_ERROR' });
  });
});
