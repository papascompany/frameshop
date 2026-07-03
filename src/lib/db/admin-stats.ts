/**
 * Admin dashboard aggregates (FS-EC-06).
 *
 * Server-only. 명시 컬럼 SELECT + 30일 범위 필터 후 앱 집계(주문량 규모 작음).
 *
 * 매출 정의: 유효 매출 = status IN REVENUE_STATUSES (CANCELLED/REFUNDED 제외),
 * 금액 = orders.total_price(적립금 차감 후 실결제액 — 주문 시점 스냅샷 그대로).
 *
 * refunded_amount(마이그레이션 038)는 미적용 DB가 존재하므로 SELECT에 포함하지
 * 않는다(ADR-023 명시 컬럼 원칙). 따라서 이번 버전의 매출 수치는 부분환불을
 * 반영하지 않는다 — 전액 환불(status=REFUNDED)만 상태 필터로 제외된다.
 *
 * 실패 정책: 섹션별 graceful — 각 집계는 실패 시 null 을 반환하고 경고 로그만
 * 남긴다. 대시보드 페이지는 null 섹션에 "집계 불가"를 표시한다(크래시 금지).
 */

import 'server-only';
import { z } from 'zod';
import { ORDER_STATUSES, type OrderStatus } from '@/types/order';
import { requireAdmin } from './admin';
import { getServiceRoleSupabase } from '../supabase/service';

// ---------- 순수 집계 로직 (단위 테스트 대상) ----------

export const REVENUE_STATUSES = [
  'PAID',
  'IN_PRODUCTION',
  'SHIPPED',
  'DELIVERED',
] as const satisfies readonly OrderStatus[];

export function isRevenueStatus(status: string): boolean {
  return (REVENUE_STATUSES as readonly string[]).includes(status);
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * KST(Asia/Seoul) 달력 기준 `daysBack`일 전 자정(00:00 KST)의 UTC 시각.
 * 예) now=2026-07-03T03:00Z(=12:00 KST), daysBack=0 → 2026-07-02T15:00Z.
 * order_no 발급부(generateOrderNo)와 동일한 +9h 시프트 방식 — KST는 DST가
 * 없으므로 고정 오프셋이 안전하다.
 */
export function kstDayStartUtc(now: Date, daysBack = 0): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(
      kst.getUTCFullYear(),
      kst.getUTCMonth(),
      kst.getUTCDate() - daysBack,
    ) - KST_OFFSET_MS,
  );
}

export type OrderStatRow = {
  status: string;
  total_price: number;
  created_at: string;
};

export type PeriodStats = {
  /** 유효 매출 합계(원). 부분환불 미반영 — 모듈 헤더 주석 참조. */
  revenue: number;
  /** 유효 상태 주문 건수. */
  orderCount: number;
};

export type SalesStats = {
  /** KST 오늘 자정 이후. */
  today: PeriodStats;
  /** KST 기준 오늘 포함 최근 7일. */
  last7Days: PeriodStats;
  /** KST 기준 오늘 포함 최근 30일. */
  last30Days: PeriodStats;
};

/**
 * 30일 범위로 조회한 주문 행에서 오늘/7일/30일 매출·건수를 집계한다.
 * 유효 매출 상태가 아닌 행(CREATED/CANCELLED/REFUNDED)은 제외.
 */
export function summarizeSales(rows: OrderStatRow[], now: Date): SalesStats {
  const todayStart = kstDayStartUtc(now, 0).getTime();
  const d7Start = kstDayStartUtc(now, 6).getTime();
  const d30Start = kstDayStartUtc(now, 29).getTime();

  const empty = (): PeriodStats => ({ revenue: 0, orderCount: 0 });
  const stats: SalesStats = {
    today: empty(),
    last7Days: empty(),
    last30Days: empty(),
  };

  for (const row of rows) {
    if (!isRevenueStatus(row.status)) continue;
    const t = Date.parse(row.created_at);
    if (Number.isNaN(t)) continue;
    const price = typeof row.total_price === 'number' ? row.total_price : 0;

    if (t >= d30Start) {
      stats.last30Days.revenue += price;
      stats.last30Days.orderCount += 1;
    }
    if (t >= d7Start) {
      stats.last7Days.revenue += price;
      stats.last7Days.orderCount += 1;
    }
    if (t >= todayStart) {
      stats.today.revenue += price;
      stats.today.orderCount += 1;
    }
  }
  return stats;
}

export type OrderItemStatRow = {
  price: number;
  quantity: number;
  /** order_items.variant_snapshot(jsonb) — 신뢰하지 않고 zod 로 좁힌다. */
  variant_snapshot: unknown;
};

export type TopProduct = {
  productName: string;
  quantity: number;
  revenue: number;
};

/** variant_snapshot 에서 필요한 필드만 좁힌다(다른 키는 무시). */
const snapshotNameSchema = z.object({ productName: z.string().min(1) });

/**
 * order_items 를 variant_snapshot.productName 기준으로 집계해 인기 상품
 * 상위 `limit`개를 반환한다. price 는 단가(createOrder 가 v.price 를 저장) —
 * 라인 매출 = price * quantity. 정렬: 수량 내림차순, 동률 시 매출 내림차순.
 * productName 이 없는 손상 스냅샷은 집계에서 제외한다(크래시 금지).
 */
export function aggregateTopProducts(
  rows: OrderItemStatRow[],
  limit = 5,
): TopProduct[] {
  const byName = new Map<string, TopProduct>();
  for (const row of rows) {
    const parsed = snapshotNameSchema.safeParse(row.variant_snapshot);
    if (!parsed.success) continue;
    const quantity = typeof row.quantity === 'number' ? row.quantity : 0;
    const price = typeof row.price === 'number' ? row.price : 0;
    const name = parsed.data.productName;
    const acc = byName.get(name) ?? { productName: name, quantity: 0, revenue: 0 };
    acc.quantity += quantity;
    acc.revenue += price * quantity;
    byName.set(name, acc);
  }
  return [...byName.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, limit);
}

// ---------- 조회 + 오케스트레이션 ----------

export type RecentOrderSummary = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  totalPrice: number;
  createdAt: string;
  ordererName: string;
};

export type AdminDashboardStats = {
  /** null = 해당 섹션 집계 실패("집계 불가" 표시). */
  sales: SalesStats | null;
  statusCounts: Record<OrderStatus, number> | null;
  recentOrders: RecentOrderSummary[] | null;
  topProducts: TopProduct[] | null;
};

const ordererNameSchema = z.object({ name: z.string() });

function warnSection(section: string, err: unknown): void {
  console.warn(
    JSON.stringify({
      event: 'admin_stats_section_failed',
      section,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

type Service = ReturnType<typeof getServiceRoleSupabase>;

/** `.in()` URL 길이 한계 방어용 청크 크기(30일 주문 규모는 통상 이보다 작음). */
const IN_CHUNK = 200;

async function fetchOrderItemsForOrders(
  supabase: Service,
  orderIds: string[],
): Promise<OrderItemStatRow[]> {
  const all: OrderItemStatRow[] = [];
  for (let i = 0; i < orderIds.length; i += IN_CHUNK) {
    const chunk = orderIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from('order_items')
      .select('order_id, price, quantity, variant_snapshot')
      .in('order_id', chunk);
    if (error) throw new Error(`order_items 30d: ${error.message}`);
    all.push(...((data ?? []) as unknown as OrderItemStatRow[]));
  }
  return all;
}

/**
 * 매출(오늘/7일/30일) + 인기 상품. 두 파트는 같은 30일 주문 조회를 공유하되,
 * order_items 조회만 실패하면 매출은 살리고 인기 상품만 null 로 둔다.
 */
async function fetchSalesAndTopProducts(
  supabase: Service,
  now: Date,
): Promise<{ sales: SalesStats | null; topProducts: TopProduct[] | null }> {
  let rows: Array<OrderStatRow & { id: string }>;
  try {
    const since = kstDayStartUtc(now, 29).toISOString();
    const { data, error } = await supabase
      .from('orders')
      // ADR-023: refunded_amount(마이그 038 미적용 가능)는 SELECT 금지.
      .select('id, status, total_price, created_at')
      .gte('created_at', since);
    if (error) throw new Error(`orders 30d: ${error.message}`);
    rows = (data ?? []) as Array<OrderStatRow & { id: string }>;
  } catch (err) {
    warnSection('sales', err);
    return { sales: null, topProducts: null };
  }

  const sales = summarizeSales(rows, now);

  let topProducts: TopProduct[] | null = null;
  try {
    const revenueOrderIds = rows
      .filter((r) => isRevenueStatus(r.status))
      .map((r) => r.id);
    const items =
      revenueOrderIds.length === 0
        ? []
        : await fetchOrderItemsForOrders(supabase, revenueOrderIds);
    topProducts = aggregateTopProducts(items);
  } catch (err) {
    warnSection('top_products', err);
  }
  return { sales, topProducts };
}

/** 상태별 전체 기간 카운트 — head:true exact count 를 상태별 병렬 실행. */
async function fetchStatusCounts(
  supabase: Service,
): Promise<Record<OrderStatus, number>> {
  const results = await Promise.all(
    ORDER_STATUSES.map(async (status) => {
      const { count, error } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw new Error(`status count ${status}: ${error.message}`);
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(results) as Record<OrderStatus, number>;
}

async function fetchRecentOrders(
  supabase: Service,
): Promise<RecentOrderSummary[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_no, status, total_price, created_at, orderer')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`recent orders: ${error.message}`);

  type Row = {
    id: string;
    order_no: string;
    status: string;
    total_price: number;
    created_at: string;
    orderer: unknown;
  };
  return ((data ?? []) as Row[]).map((row) => {
    const orderer = ordererNameSchema.safeParse(row.orderer);
    const status = (ORDER_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as OrderStatus)
      : 'CREATED';
    return {
      id: row.id,
      orderNo: row.order_no,
      status,
      totalPrice: row.total_price,
      createdAt: row.created_at,
      ordererName: orderer.success ? orderer.data.name : '',
    };
  });
}

/**
 * 관리자 대시보드 통계 일괄 조회. 인증 실패(requireAdmin)만 throw 하고,
 * 각 집계 쿼리 실패는 해당 섹션 null 로 강등한다.
 */
export async function getAdminDashboardStats(
  now: Date = new Date(),
): Promise<AdminDashboardStats> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();

  const [salesAndTop, statusCounts, recentOrders] = await Promise.all([
    fetchSalesAndTopProducts(supabase, now),
    fetchStatusCounts(supabase).catch((err: unknown) => {
      warnSection('status_counts', err);
      return null;
    }),
    fetchRecentOrders(supabase).catch((err: unknown) => {
      warnSection('recent_orders', err);
      return null;
    }),
  ]);

  return {
    sales: salesAndTop.sales,
    topProducts: salesAndTop.topProducts,
    statusCounts,
    recentOrders,
  };
}
