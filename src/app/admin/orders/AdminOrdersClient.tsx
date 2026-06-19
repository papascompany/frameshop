'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import type { OrderWithItems } from '@/types/order';
import type { OrderStatus } from '@/types/order';
import { bulkUpdateTrackingAction } from './actions';

type BadgeConfig = { label: string; className: string };

const STATUS_BADGE: Record<OrderStatus, BadgeConfig> = {
  CREATED:       { label: '주문접수', className: 'bg-soft-cloud text-mute' },
  PAID:          { label: '결제완료', className: 'bg-info/10 text-info' },
  IN_PRODUCTION: { label: '제작중',   className: 'bg-warning/10 text-warning' },
  SHIPPED:       { label: '배송중',   className: 'bg-charcoal/10 text-charcoal' },
  DELIVERED:     { label: '배송완료', className: 'bg-success/10 text-success' },
  CANCELLED:     { label: '취소',     className: 'bg-sale/10 text-sale' },
  REFUNDED:      { label: '환불',     className: 'bg-sale/10 text-sale' },
};

const TAB_FILTERS: { status: OrderStatus | null; label: string }[] = [
  { status: null,            label: '전체' },
  { status: 'PAID',          label: '결제완료' },
  { status: 'IN_PRODUCTION', label: '제작중' },
  { status: 'SHIPPED',       label: '배송중' },
  { status: 'DELIVERED',     label: '배송완료' },
  { status: 'CANCELLED',     label: '취소' },
  { status: 'REFUNDED',      label: '환불' },
];

type Filters = {
  status: OrderStatus | null;
  q: string | null;
  from: string | null;
  to: string | null;
};

/**
 * 현재 필터(status/q/from/to)를 보존하며 페이지만 바꾼 목록 URL을 만든다.
 * 탭 전환(상태 변경) 시에도 검색어/기간은 그대로 유지된다.
 */
function buildHref(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/admin/orders?${qs}` : '/admin/orders';
}

/** 현재 필터로 CSV export 라우트 쿼리스트링을 만든다(화면 == CSV). */
function buildExportHref(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  if (filters.from) params.set('from', filters.from);
  // 종료일은 하루 전체 포함되도록 호출부에서 정규화하지 않고 그대로 전달.
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  return qs ? `/api/admin/orders/export?${qs}` : '/api/admin/orders/export';
}

type ParsedTrackingRow = {
  orderNo: string;
  courier: string;
  trackingNumber: string;
};

/**
 * 운송장 일괄등록용 CSV 파싱. 한 줄당 `주문번호,택배사,운송장번호`.
 * - 빈 줄/공백 줄은 무시
 * - 탭(TSV)도 자동 인식
 * - 헤더 줄(주문번호로 시작)도 무시
 */
function parseTrackingCsv(text: string): ParsedTrackingRow[] {
  const rows: ParsedTrackingRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.split(/[\t,]/).map((c) => c.trim());
    const [orderNo = '', courier = '', trackingNumber = ''] = cells;
    if (!orderNo) continue;
    // 헤더 줄 스킵 (예: "주문번호,택배사,운송장번호").
    if (orderNo === '주문번호') continue;
    rows.push({ orderNo, courier, trackingNumber });
  }
  return rows;
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const IconArrowRight = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden>
    <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
  </svg>
);

const IconInbox = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="32" height="32" aria-hidden>
    <path fillRule="evenodd" d="M1 11.27c0-.897.63-1.673 1.51-1.845L3 9.231V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5.231l.49.194A1.878 1.878 0 0 1 19 11.27V16a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-4.73ZM5 4h10v4.931l-2 .794v1.275a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-1.275l-2-.794V4Z" clipRule="evenodd" />
  </svg>
);

type Props = {
  orders: OrderWithItems[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  status: OrderStatus | null;
  q: string | null;
  from: string | null;
  to: string | null;
};

export function AdminOrdersClient({
  orders,
  total,
  page,
  pageSize,
  hasMore,
  status,
  q,
  from,
  to,
}: Props) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 현재 적용된 필터(탭 링크/페이지네이션/export 가 공유).
  const filters: Filters = { status, q, from, to };

  // 검색 폼 로컬 상태 (제출 시에만 URL 반영).
  const [qInput, setQInput] = useState(q ?? '');
  const [fromInput, setFromInput] = useState(from ?? '');
  const [toInput, setToInput] = useState(to ?? '');

  // 운송장 일괄등록 다이얼로그 상태.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCsv, setBulkCsv] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<
    { orderNo: string; ok: boolean; error?: string }[] | null
  >(null);
  const [bulkPending, startBulk] = useTransition();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    // 검색 시 상태 탭은 유지하되 페이지는 1로 리셋.
    router.push(
      buildHref(
        {
          status,
          q: qInput.trim() || null,
          from: fromInput.trim() || null,
          to: toInput.trim() || null,
        },
        1,
      ),
    );
  }

  function handleResetSearch() {
    setQInput('');
    setFromInput('');
    setToInput('');
    router.push(buildHref({ status, q: null, from: null, to: null }, 1));
  }

  function handleBulkSubmit() {
    setBulkError(null);
    setBulkResults(null);
    const rows = parseTrackingCsv(bulkCsv);
    if (rows.length === 0) {
      setBulkError('등록할 행이 없습니다. 한 줄에 "주문번호,택배사,운송장번호" 형식으로 입력해 주세요.');
      return;
    }
    startBulk(async () => {
      const res = await bulkUpdateTrackingAction(rows);
      setBulkResults(res.results);
      // 한 건이라도 성공했다면 목록을 새로고침해 상태 변화를 반영.
      if (res.results.some((r) => r.ok)) {
        router.refresh();
      }
    });
  }

  const bulkSuccessCount = bulkResults?.filter((r) => r.ok).length ?? 0;
  const bulkFailCount = bulkResults ? bulkResults.length - bulkSuccessCount : 0;

  return (
    <div className="space-y-4">
      {/* 검색/도구 모음 */}
      <div className="bg-canvas border border-hairline p-4 space-y-3">
        <form
          onSubmit={handleSearch}
          className="flex flex-col gap-3 lg:flex-row lg:items-end"
          data-testid="admin-orders-search-form"
        >
          <div className="flex-1 min-w-0">
            <Input
              label="통합검색"
              placeholder="주문번호 · 주문자명 · 전화 · 이메일"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              data-testid="admin-orders-search-q"
            />
          </div>
          <div className="flex gap-3">
            <Input
              type="date"
              label="시작일"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="w-full"
              data-testid="admin-orders-search-from"
            />
            <Input
              type="date"
              label="종료일"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className="w-full"
              data-testid="admin-orders-search-to"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              data-testid="admin-orders-search-submit"
            >
              검색
            </Button>
            {(q || from || to) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetSearch}
                data-testid="admin-orders-search-reset"
              >
                초기화
              </Button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setBulkError(null);
              setBulkResults(null);
              setBulkCsv('');
              setBulkOpen(true);
            }}
            data-testid="admin-orders-bulk-open"
          >
            운송장 일괄등록
          </Button>
          {/* CSV export — 현재 필터 그대로 다운로드. 새 탭/네이티브 다운로드를
              위해 anchor 사용(download 속성). */}
          <a
            href={buildExportHref(filters)}
            className={cn(
              'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap',
              'rounded-[30px] h-10 px-4 text-sm transition-colors duration-150 tap-collapse',
              'bg-soft-cloud text-ink hover:bg-hairline-soft',
              'focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 focus-visible:outline',
            )}
            data-testid="admin-orders-export"
          >
            엑셀 다운로드
          </a>
        </div>
      </div>

      {/* 서버사이드 상태 필터 (링크 — 전체 주문 대상 필터, 검색어/기간 유지) */}
      <div className="flex flex-wrap gap-1.5">
        {TAB_FILTERS.map((tab) => {
          const active = tab.status === status;
          return (
            <Link
              key={tab.label}
              href={buildHref({ status: tab.status, q, from, to }, 1)}
              className={cn(
                'inline-flex items-center px-3 py-1.5 text-sm rounded-[30px] transition-colors',
                active
                  ? 'bg-ink text-on-primary'
                  : 'bg-soft-cloud text-mute hover:text-ink',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {orders.length === 0 ? (
        <div className="bg-canvas border border-hairline py-16 flex flex-col items-center gap-3 text-center">
          <span className="text-stone">
            <IconInbox />
          </span>
          <p className="text-sm font-medium text-ink">해당 주문이 없습니다</p>
          <p className="text-xs text-mute">다른 필터를 확인해 보세요.</p>
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden md:block bg-canvas border border-hairline overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-soft-cloud border-b border-hairline">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">주문번호</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">상태</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">주문인</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-mute">총 금액</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">주문일시</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-mute">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {orders.map((order) => {
                  const badge = STATUS_BADGE[order.status];
                  return (
                    <tr key={order.id as string} className="hover:bg-soft-cloud/60 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-mute whitespace-nowrap">{order.orderNo as string}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn('inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full', badge.className)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-ink">{order.orderer.name}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums font-medium text-ink">
                        {order.totalPrice.toLocaleString('ko-KR')}원
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-mute text-xs">{formatDateTime(order.createdAt)}</td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <Link
                          href={`/admin/orders/${order.id as string}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-ink hover:text-charcoal transition-colors"
                        >
                          상세보기
                          <IconArrowRight />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden space-y-2">
            {orders.map((order) => {
              const badge = STATUS_BADGE[order.status];
              return (
                <div key={order.id as string} className="bg-canvas border border-hairline p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-mute truncate">{order.orderNo as string}</p>
                      <p className="font-semibold text-ink text-sm mt-0.5">{order.orderer.name}</p>
                    </div>
                    <span className={cn('shrink-0 inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full', badge.className)}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium tabular-nums text-ink">{order.totalPrice.toLocaleString('ko-KR')}원</p>
                      <p className="text-xs text-mute">{formatDateTime(order.createdAt)}</p>
                    </div>
                    <Link
                      href={`/admin/orders/${order.id as string}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-ink bg-soft-cloud px-3 py-1.5 rounded-[30px] hover:bg-hairline transition-colors"
                    >
                      상세보기
                      <IconArrowRight />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              {page > 1 ? (
                <Link
                  href={buildHref(filters, page - 1)}
                  className="px-3 py-1.5 text-sm rounded-[30px] bg-soft-cloud text-ink hover:bg-hairline transition-colors"
                >
                  이전
                </Link>
              ) : (
                <span className="px-3 py-1.5 text-sm rounded-[30px] bg-soft-cloud/50 text-stone">이전</span>
              )}
              <span className="text-sm text-mute tabular-nums">{page} / {totalPages}</span>
              {hasMore ? (
                <Link
                  href={buildHref(filters, page + 1)}
                  className="px-3 py-1.5 text-sm rounded-[30px] bg-soft-cloud text-ink hover:bg-hairline transition-colors"
                >
                  다음
                </Link>
              ) : (
                <span className="px-3 py-1.5 text-sm rounded-[30px] bg-soft-cloud/50 text-stone">다음</span>
              )}
            </div>
          )}
        </>
      )}

      {/* 운송장 일괄등록 다이얼로그 */}
      <Dialog
        open={bulkOpen}
        onOpenChange={(o) => {
          setBulkOpen(o);
          if (!o) {
            setBulkError(null);
            setBulkResults(null);
          }
        }}
        title="운송장 일괄등록"
        description="한 줄에 한 건씩 주문번호,택배사,운송장번호 순서로 입력해 주세요. (CSV/TSV)"
        maxWidth="max-w-lg"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBulkOpen(false)}
              disabled={bulkPending}
            >
              닫기
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={bulkPending}
              disabled={bulkPending}
              onClick={handleBulkSubmit}
              data-testid="admin-orders-bulk-submit"
            >
              일괄 등록
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="bulk-tracking-csv"
              className="text-sm font-medium text-foreground"
            >
              운송장 데이터
            </label>
            <textarea
              id="bulk-tracking-csv"
              value={bulkCsv}
              onChange={(e) => setBulkCsv(e.target.value)}
              rows={7}
              placeholder={
                '20260619-0001,CJ대한통운,1234567890\n20260619-0002,한진택배,9876543210'
              }
              className="w-full font-mono text-xs bg-surface border border-border rounded-input p-2 focus:outline-none focus:border-foreground"
              data-testid="admin-orders-bulk-csv"
            />
            <p className="text-xs text-muted-fg">
              결제완료(제작중) 상태의 주문만 배송중으로 전환됩니다. 헤더 줄과 빈
              줄은 자동으로 무시됩니다.
            </p>
          </div>

          {bulkError && (
            <p className="text-xs text-danger" data-testid="admin-orders-bulk-error">
              {bulkError}
            </p>
          )}

          {bulkResults && (
            <div className="space-y-2" data-testid="admin-orders-bulk-results">
              <p className="text-sm font-medium text-ink">
                결과: 성공 {bulkSuccessCount}건 · 실패 {bulkFailCount}건
              </p>
              <div className="max-h-48 overflow-y-auto border border-hairline rounded-input divide-y divide-hairline">
                {bulkResults.map((r, idx) => (
                  <div
                    key={`${r.orderNo}-${idx}`}
                    className="flex items-start justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-mute truncate">{r.orderNo}</span>
                    {r.ok ? (
                      <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-success/10 text-success font-semibold">
                        성공
                      </span>
                    ) : (
                      <span className="shrink-0 text-right text-sale">
                        실패{r.error ? ` · ${r.error}` : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
