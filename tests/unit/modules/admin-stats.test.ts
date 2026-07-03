/**
 * src/lib/db/admin-stats.ts — FS-EC-06 관리자 대시보드 집계.
 *
 * 핵심 계약: (1) 유효 매출 상태 필터(PAID/IN_PRODUCTION/SHIPPED/DELIVERED만),
 * (2) KST(Asia/Seoul) 자정 경계, (3) variant_snapshot 앱 집계(인기 상품),
 * (4) 집계 쿼리 실패 시 섹션별 graceful degrade(null) — 크래시 금지.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Supabase 테스트 더블 ----------

type FakeResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

type FakeState = {
  /** 30일 범위 조회(gte) 결과 행. */
  rangeRows: Array<Record<string, unknown>>;
  rangeFails: boolean;
  /** head:true 상태별 카운트. */
  countsByStatus: Record<string, number>;
  countFails: boolean;
  /** 최근 주문(limit) 결과 행. */
  recentRows: Array<Record<string, unknown>>;
  recentFails: boolean;
  /** order_items 조회 결과 행. */
  itemRows: Array<Record<string, unknown>>;
  itemsFails: boolean;
  /** order_items .in() 으로 전달된 order_id 목록(검증용). */
  itemInIds: string[];
};

const state: FakeState = {
  rangeRows: [],
  rangeFails: false,
  countsByStatus: {},
  countFails: false,
  recentRows: [],
  recentFails: false,
  itemRows: [],
  itemsFails: false,
  itemInIds: [],
};

function resetState(): void {
  state.rangeRows = [];
  state.rangeFails = false;
  state.countsByStatus = {};
  state.countFails = false;
  state.recentRows = [];
  state.recentFails = false;
  state.itemRows = [];
  state.itemsFails = false;
  state.itemInIds = [];
}

type OrdersBuilder = {
  select(cols: string, opts?: { count?: string; head?: boolean }): OrdersBuilder;
  gte(col: string, val: string): OrdersBuilder;
  eq(col: string, val: string): OrdersBuilder;
  order(col: string, opts: { ascending: boolean }): OrdersBuilder;
  limit(n: number): OrdersBuilder;
  then(resolve: (r: FakeResult) => void): void;
};

/** 호출 패턴(head/gte/limit)으로 세 가지 orders 쿼리를 구분하는 thenable. */
function makeOrdersBuilder(): OrdersBuilder {
  const ctx = { head: false, gte: false, limit: false, statusEq: '' };
  const builder: OrdersBuilder = {
    select(_cols, opts) {
      ctx.head = opts?.head === true;
      return builder;
    },
    gte() {
      ctx.gte = true;
      return builder;
    },
    eq(_col, val) {
      ctx.statusEq = val;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      ctx.limit = true;
      return builder;
    },
    then(resolve) {
      if (ctx.head) {
        resolve(
          state.countFails
            ? { data: null, error: { message: 'count failed (simulated)' }, count: null }
            : { data: null, error: null, count: state.countsByStatus[ctx.statusEq] ?? 0 },
        );
        return;
      }
      if (ctx.gte) {
        resolve(
          state.rangeFails
            ? { data: null, error: { message: 'range query failed (simulated)' } }
            : { data: state.rangeRows, error: null },
        );
        return;
      }
      resolve(
        state.recentFails
          ? { data: null, error: { message: 'recent query failed (simulated)' } }
          : { data: state.recentRows, error: null },
      );
    },
  };
  return builder;
}

type ItemsBuilder = {
  select(cols: string): ItemsBuilder;
  in(col: string, ids: string[]): Promise<FakeResult>;
};

function makeItemsBuilder(): ItemsBuilder {
  const builder: ItemsBuilder = {
    select() {
      return builder;
    },
    in(_col, ids) {
      state.itemInIds.push(...ids);
      return Promise.resolve(
        state.itemsFails
          ? { data: null, error: { message: 'items query failed (simulated)' } }
          : { data: state.itemRows, error: null },
      );
    },
  };
  return builder;
}

const fakeSupabase = {
  from(table: string): OrdersBuilder | ItemsBuilder {
    return table === 'order_items' ? makeItemsBuilder() : makeOrdersBuilder();
  },
};

vi.mock('@/lib/db/admin', () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'a@b.c', role: 'admin' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => fakeSupabase,
}));

import {
  aggregateTopProducts,
  getAdminDashboardStats,
  kstDayStartUtc,
  summarizeSales,
  type OrderStatRow,
} from '@/lib/db/admin-stats';

// now = 2026-07-03 12:00 KST (= 03:00 UTC)
const NOW = new Date('2026-07-03T03:00:00Z');

function row(status: string, totalPrice: number, createdAt: string): OrderStatRow {
  return { status, total_price: totalPrice, created_at: createdAt };
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- (1) 상태 필터 ----------

describe('summarizeSales — 유효 매출 상태 필터', () => {
  it('PAID/IN_PRODUCTION/SHIPPED/DELIVERED 만 매출·건수에 포함한다', () => {
    const today = '2026-07-03T01:00:00Z'; // 10:00 KST 오늘
    const rows: OrderStatRow[] = [
      row('PAID', 10_000, today),
      row('IN_PRODUCTION', 20_000, today),
      row('SHIPPED', 30_000, today),
      row('DELIVERED', 40_000, today),
      // 아래 3건은 전부 제외되어야 한다.
      row('CREATED', 99_999, today),
      row('CANCELLED', 99_999, today),
      row('REFUNDED', 99_999, today),
    ];
    const stats = summarizeSales(rows, NOW);
    expect(stats.today).toEqual({ revenue: 100_000, orderCount: 4 });
    expect(stats.last7Days).toEqual({ revenue: 100_000, orderCount: 4 });
    expect(stats.last30Days).toEqual({ revenue: 100_000, orderCount: 4 });
  });
});

// ---------- (2) KST 자정 경계 ----------

describe('KST(Asia/Seoul) 자정 경계', () => {
  it('kstDayStartUtc: KST 오늘 자정은 UTC 전일 15:00 이다', () => {
    expect(kstDayStartUtc(NOW, 0).toISOString()).toBe('2026-07-02T15:00:00.000Z');
    expect(kstDayStartUtc(NOW, 6).toISOString()).toBe('2026-06-26T15:00:00.000Z');
    expect(kstDayStartUtc(NOW, 29).toISOString()).toBe('2026-06-03T15:00:00.000Z');
  });

  it('UTC 로는 어제여도 KST 자정 이후 주문은 "오늘"로 집계한다 (경계 ±1분)', () => {
    const rows: OrderStatRow[] = [
      // 2026-07-03 00:01 KST → 오늘
      row('PAID', 1_000, '2026-07-02T15:01:00Z'),
      // 2026-07-02 23:59 KST → 오늘 아님, 7일에는 포함
      row('PAID', 20_000, '2026-07-02T14:59:00Z'),
      // 2026-06-27 00:00 KST 정각 → 7일 창의 시작(포함)
      row('PAID', 300_000, '2026-06-26T15:00:00Z'),
      // 2026-06-26 23:59 KST → 7일 제외, 30일 포함
      row('PAID', 4_000_000, '2026-06-26T14:59:00Z'),
      // 2026-06-03 23:59 KST → 30일 창 이전(제외)
      row('PAID', 50_000_000, '2026-06-03T14:59:00Z'),
    ];
    const stats = summarizeSales(rows, NOW);
    expect(stats.today).toEqual({ revenue: 1_000, orderCount: 1 });
    expect(stats.last7Days).toEqual({ revenue: 321_000, orderCount: 3 });
    expect(stats.last30Days).toEqual({ revenue: 4_321_000, orderCount: 4 });
  });
});

// ---------- (3) 인기 상품 집계 ----------

describe('aggregateTopProducts — variant_snapshot 앱 집계', () => {
  it('productName 기준 합산(매출=단가*수량), 수량 내림차순, 상위 N개만 반환한다', () => {
    const items = [
      { price: 10_000, quantity: 2, variant_snapshot: { productName: 'A4 우드 프레임' } },
      { price: 12_000, quantity: 3, variant_snapshot: { productName: 'A4 우드 프레임' } },
      { price: 50_000, quantity: 1, variant_snapshot: { productName: '캔버스 대형' } },
      { price: 5_000, quantity: 4, variant_snapshot: { productName: '미니 액자' } },
      { price: 8_000, quantity: 2, variant_snapshot: { productName: '포스터' } },
      { price: 9_000, quantity: 2, variant_snapshot: { productName: '엽서 세트' } },
      { price: 7_000, quantity: 1, variant_snapshot: { productName: '아크릴 스탠드' } },
    ];
    const top = aggregateTopProducts(items, 5);
    expect(top).toHaveLength(5); // 6종 중 상위 5개만
    expect(top[0]).toEqual({
      productName: 'A4 우드 프레임',
      quantity: 5,
      revenue: 10_000 * 2 + 12_000 * 3, // 56,000
    });
    expect(top[1]).toEqual({ productName: '미니 액자', quantity: 4, revenue: 20_000 });
    // 수량 동률(2) → 매출 내림차순: 엽서 세트(18,000) > 포스터(16,000)
    expect(top[2]?.productName).toBe('엽서 세트');
    expect(top[3]?.productName).toBe('포스터');
    // 최하위(아크릴 스탠드)는 잘려나간다.
    expect(top.map((p) => p.productName)).not.toContain('아크릴 스탠드');
  });

  it('productName 이 없는 손상 스냅샷은 건너뛴다(크래시 금지)', () => {
    const items = [
      { price: 10_000, quantity: 1, variant_snapshot: { productName: '정상 상품' } },
      { price: 99_000, quantity: 9, variant_snapshot: { sizeLabel: 'A4' } },
      { price: 99_000, quantity: 9, variant_snapshot: null },
      { price: 99_000, quantity: 9, variant_snapshot: 'not-an-object' },
    ];
    const top = aggregateTopProducts(items);
    expect(top).toEqual([{ productName: '정상 상품', quantity: 1, revenue: 10_000 }]);
  });
});

// ---------- (4) graceful degrade ----------

describe('getAdminDashboardStats — 섹션별 graceful degrade', () => {
  it('30일 매출 쿼리 실패 시 sales/topProducts 만 null, 나머지 섹션은 살린다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.rangeFails = true;
    state.countsByStatus = { PAID: 3, SHIPPED: 1 };
    state.recentRows = [
      {
        id: 'o-1',
        order_no: '20260703-0001',
        status: 'PAID',
        total_price: 42_000,
        created_at: '2026-07-03T01:00:00Z',
        orderer: { name: '홍길동', phone: 'x', email: 'x' },
      },
    ];

    const stats = await getAdminDashboardStats(NOW);

    expect(stats.sales).toBeNull();
    expect(stats.topProducts).toBeNull();
    expect(stats.statusCounts).not.toBeNull();
    expect(stats.statusCounts?.PAID).toBe(3);
    expect(stats.statusCounts?.SHIPPED).toBe(1);
    expect(stats.statusCounts?.CREATED).toBe(0);
    expect(stats.recentOrders).toEqual([
      {
        id: 'o-1',
        orderNo: '20260703-0001',
        status: 'PAID',
        totalPrice: 42_000,
        createdAt: '2026-07-03T01:00:00Z',
        ordererName: '홍길동',
      },
    ]);
    expect(warn).toHaveBeenCalled();
  });

  it('모든 쿼리 실패여도 throw 하지 않고 전 섹션 null 을 반환한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.rangeFails = true;
    state.countFails = true;
    state.recentFails = true;

    const stats = await getAdminDashboardStats(NOW);
    expect(stats).toEqual({
      sales: null,
      topProducts: null,
      statusCounts: null,
      recentOrders: null,
    });
  });

  it('order_items 조회만 실패하면 sales 는 유지하고 topProducts 만 null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.rangeRows = [
      { id: 'o-1', status: 'PAID', total_price: 10_000, created_at: '2026-07-03T01:00:00Z' },
    ];
    state.itemsFails = true;

    const stats = await getAdminDashboardStats(NOW);
    expect(stats.sales?.today).toEqual({ revenue: 10_000, orderCount: 1 });
    expect(stats.topProducts).toBeNull();
  });

  it('유효 상태 주문의 id 만 order_items 조회에 사용한다', async () => {
    state.rangeRows = [
      { id: 'o-paid', status: 'PAID', total_price: 10_000, created_at: '2026-07-03T01:00:00Z' },
      { id: 'o-cancelled', status: 'CANCELLED', total_price: 5_000, created_at: '2026-07-03T01:00:00Z' },
    ];
    state.itemRows = [
      { order_id: 'o-paid', price: 10_000, quantity: 1, variant_snapshot: { productName: 'A4 우드 프레임' } },
    ];

    const stats = await getAdminDashboardStats(NOW);
    expect(state.itemInIds).toEqual(['o-paid']);
    expect(stats.topProducts).toEqual([
      { productName: 'A4 우드 프레임', quantity: 1, revenue: 10_000 },
    ]);
  });
});
