import Link from 'next/link';
import { cn } from '@/lib/cn';
import { adminTileItems, type AdminNavKey } from '@/lib/admin/adminNav';
import {
  getAdminDashboardStats,
  type PeriodStats,
  type RecentOrderSummary,
  type TopProduct,
} from '@/lib/db/admin-stats';
import { ORDER_STATUSES, type OrderStatus } from '@/types/order';

// 매 요청 시점 집계 — 통계는 캐시하지 않는다(다른 admin 페이지와 동일 패턴).
export const dynamic = 'force-dynamic';

const IconBox = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path d="M10.362 1.093a.75.75 0 0 0-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925ZM18 6.443l-7.25 3.997v7.474l6.533-3.003A.75.75 0 0 0 18 14.25V6.443ZM2 14.25v-7.807L9.25 10.44v7.474L2.717 14.91A.75.75 0 0 1 2 14.25Z" />
  </svg>
);

const IconFrame = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path fillRule="evenodd" d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1H6Z" clipRule="evenodd" />
  </svg>
);

const IconList = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" clipRule="evenodd" />
  </svg>
);

const IconSparkles = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.632l2.051-.684a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.949 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
  </svg>
);

const IconTruck = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path d="M6.5 3A1.5 1.5 0 0 0 5 4.5H3a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h.5a2.5 2.5 0 0 0 5 0h3a2.5 2.5 0 0 0 5 0H17a2 2 0 0 0 2-2V9.485a2 2 0 0 0-.586-1.414l-1.899-1.9A2 2 0 0 0 15.101 5.6H14A1.5 1.5 0 0 0 12.5 4H8A1.5 1.5 0 0 0 6.5 3Zm7 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm6-6.5v2h2.101a.5.5 0 0 1 .354.146l1.899 1.9A.5.5 0 0 1 17 10.015V11h-1V9.485a1 1 0 0 0-.293-.707L13.808 6.88A1 1 0 0 0 13.101 6.6H13.5Z" />
  </svg>
);

const IconSliders = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path d="M17 2.75a.75.75 0 0 0-1.5 0v8.5H4.75a.75.75 0 0 0 0 1.5H15.5v3.5a.75.75 0 0 0 1.5 0V2.75ZM3 6.25a.75.75 0 0 0 1.5 0V2.75a.75.75 0 0 0-1.5 0V6.25Zm.75 2A2.25 2.25 0 0 0 1.5 10.5a2.25 2.25 0 0 0 2.25 2.25A2.25 2.25 0 0 0 6 10.5 2.25 2.25 0 0 0 3.75 8.25ZM3.75 9.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm12.5 3.75A2.25 2.25 0 0 0 14 15.75a2.25 2.25 0 0 0 2.25 2.25A2.25 2.25 0 0 0 18.5 15.75a2.25 2.25 0 0 0-2.25-2.25Zm0 1.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
  </svg>
);

const IconArrowRight = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden>
    <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
  </svg>
);

// Tile-surface icons, keyed by the adminNav SSOT keys. Note 카테고리 uses the list
// glyph here (distinct from the sidebar's tag glyph) — icons stay per-surface.
const ICONS: Partial<Record<AdminNavKey, React.ReactNode>> = {
  categories: <IconList />,
  products: <IconBox />,
  frames: <IconFrame />,
  options: <IconSliders />,
  orders: <IconList />,
  curation: <IconSparkles />,
  shipping: <IconTruck />,
};

function formatDate() {
  return new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

// ---------- 통계 표시 유틸 ----------

// 대시보드 전용 표시 메타. AdminOrdersClient 의 배지 맵과 시각적으로 맞추되,
// 'use client' 모듈에서 상수를 가져오면 서버 컴포넌트 경계가 깨지므로 재선언.
const STATUS_META: Record<OrderStatus, { label: string; barClass: string; textClass: string }> = {
  CREATED:       { label: '주문접수', barClass: 'bg-stone',    textClass: 'text-mute' },
  PAID:          { label: '결제완료', barClass: 'bg-info',     textClass: 'text-info' },
  IN_PRODUCTION: { label: '제작중',   barClass: 'bg-warning',  textClass: 'text-warning' },
  SHIPPED:       { label: '배송중',   barClass: 'bg-charcoal', textClass: 'text-charcoal' },
  DELIVERED:     { label: '배송완료', barClass: 'bg-success',  textClass: 'text-success' },
  CANCELLED:     { label: '취소',     barClass: 'bg-sale',     textClass: 'text-sale' },
  REFUNDED:      { label: '환불',     barClass: 'bg-sale',     textClass: 'text-sale' },
};

function formatKRW(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

function formatDateTimeKST(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SectionUnavailable() {
  return (
    <div className="border border-hairline bg-canvas p-4">
      <p className="text-sm text-mute">집계 불가 — 잠시 후 새로고침해 주세요.</p>
    </div>
  );
}

function SalesCard({ title, stats }: { title: string; stats: PeriodStats }) {
  return (
    <div className="border border-hairline bg-canvas p-4 md:p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-stone">{title}</p>
      <p className="mt-2 text-xl md:text-2xl font-bold text-ink tabular-nums">
        {formatKRW(stats.revenue)}
      </p>
      <p className="mt-0.5 text-xs text-mute tabular-nums">주문 {stats.orderCount}건</p>
    </div>
  );
}

function StatusCountBars({ counts }: { counts: Record<OrderStatus, number> }) {
  const max = Math.max(1, ...ORDER_STATUSES.map((s) => counts[s]));
  return (
    <div className="border border-hairline bg-canvas p-4 md:p-5 space-y-2.5">
      {ORDER_STATUSES.map((status) => {
        const meta = STATUS_META[status];
        const count = counts[status];
        return (
          <div key={status} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs text-mute">{meta.label}</span>
            <div className="flex-1 h-2 bg-soft-cloud">
              <div
                className={cn('h-full', meta.barClass)}
                style={{ width: `${Math.round((count / max) * 100)}%` }}
              />
            </div>
            <span className={cn('w-10 shrink-0 text-right text-xs font-medium tabular-nums', meta.textClass)}>
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TopProductsList({ products }: { products: TopProduct[] }) {
  if (products.length === 0) {
    return (
      <div className="border border-hairline bg-canvas p-4">
        <p className="text-sm text-mute">최근 30일 판매 데이터가 없습니다.</p>
      </div>
    );
  }
  const max = Math.max(1, ...products.map((p) => p.quantity));
  return (
    <ol className="border border-hairline bg-canvas p-4 md:p-5 space-y-3">
      {products.map((p, i) => (
        <li key={p.productName} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm text-ink truncate">
              <span className="font-semibold tabular-nums mr-1.5">{i + 1}.</span>
              {p.productName}
            </p>
            <p className="shrink-0 text-xs text-mute tabular-nums">
              {p.quantity}개 · {formatKRW(p.revenue)}
            </p>
          </div>
          <div className="h-1.5 bg-soft-cloud">
            <div
              className="h-full bg-ink"
              style={{ width: `${Math.round((p.quantity / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function RecentOrdersTable({ orders }: { orders: RecentOrderSummary[] }) {
  if (orders.length === 0) {
    return (
      <div className="border border-hairline bg-canvas p-4">
        <p className="text-sm text-mute">주문이 없습니다.</p>
      </div>
    );
  }
  return (
    <div className="border border-hairline bg-canvas divide-y divide-hairline-soft">
      {orders.map((order) => {
        const meta = STATUS_META[order.status];
        return (
          <Link
            key={order.id}
            href={`/admin/orders/${order.id}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-soft-cloud transition-colors"
          >
            <span className="text-xs font-medium text-ink tabular-nums shrink-0">
              {order.orderNo}
            </span>
            <span className="flex-1 truncate text-xs text-mute">
              {order.ordererName}
            </span>
            <span className={cn('text-xs font-medium shrink-0', meta.textClass)}>
              {meta.label}
            </span>
            <span className="text-xs text-ink tabular-nums shrink-0 w-20 text-right">
              {formatKRW(order.totalPrice)}
            </span>
            <span className="hidden md:inline text-xs text-stone tabular-nums shrink-0">
              {formatDateTimeKST(order.createdAt)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default async function AdminHomePage() {
  const stats = await getAdminDashboardStats();

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-ink tracking-tight">
          안녕하세요, 관리자님
        </h2>
        <p className="text-sm text-mute">{formatDate()}</p>
      </div>

      {/* 매출 요약 — 유효 매출(PAID/제작/배송 계열), 부분환불 미반영(ADR-023) */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone mb-3">
          매출 요약 <span className="normal-case font-normal">(KST 기준 · 취소/환불 제외)</span>
        </h3>
        {stats.sales ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SalesCard title="오늘" stats={stats.sales.today} />
            <SalesCard title="최근 7일" stats={stats.sales.last7Days} />
            <SalesCard title="최근 30일" stats={stats.sales.last30Days} />
          </div>
        ) : (
          <SectionUnavailable />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 상태별 주문 현황 (전체 기간) */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-stone mb-3">
            상태별 주문 현황
          </h3>
          {stats.statusCounts ? (
            <StatusCountBars counts={stats.statusCounts} />
          ) : (
            <SectionUnavailable />
          )}
        </div>

        {/* 인기 상품 TOP 5 (최근 30일, 유효 주문 기준) */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-stone mb-3">
            인기 상품 TOP 5 <span className="normal-case font-normal">(최근 30일)</span>
          </h3>
          {stats.topProducts ? (
            <TopProductsList products={stats.topProducts} />
          ) : (
            <SectionUnavailable />
          )}
        </div>
      </div>

      {/* 최근 주문 10건 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-stone">
            최근 주문
          </h3>
          <Link href="/admin/orders" className="text-xs text-mute hover:text-ink transition-colors">
            전체 보기
          </Link>
        </div>
        {stats.recentOrders ? (
          <RecentOrdersTable orders={stats.recentOrders} />
        ) : (
          <SectionUnavailable />
        )}
      </div>

      {/* Quick Nav Grid */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone mb-3">
          빠른 이동
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {adminTileItems().map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className={cn(
                'group relative bg-canvas border border-hairline p-4 md:p-5',
                'flex flex-col gap-3',
                'transition-all duration-200',
                'hover:border-ink hover:shadow-sm',
                'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[3px]',
                'after:bg-ink after:scale-x-0 hover:after:scale-x-100',
                'after:transition-transform after:duration-200 after:origin-left',
              )}
            >
              <span className="text-ink">{ICONS[tile.key]}</span>
              <div className="flex-1">
                <p className="font-semibold text-ink text-sm">{tile.label}</p>
                <p className="text-xs text-mute mt-0.5 leading-relaxed">
                  {tile.tileDescription}
                </p>
              </div>
              <span className="self-end text-stone group-hover:text-ink transition-colors">
                <IconArrowRight />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
