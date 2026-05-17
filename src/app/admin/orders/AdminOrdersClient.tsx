'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Tabs } from '@/components/ui/Tabs';
import { cn } from '@/lib/cn';
import type { OrderWithItems } from '@/types/order';
import type { OrderStatus } from '@/types/order';

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

const TAB_FILTERS: { value: string; label: string; statuses: OrderStatus[] | null }[] = [
  { value: 'ALL',           label: '전체',     statuses: null },
  { value: 'PAID',          label: '결제완료', statuses: ['PAID'] },
  { value: 'IN_PRODUCTION', label: '제작중',   statuses: ['IN_PRODUCTION'] },
  { value: 'SHIPPED',       label: '배송중',   statuses: ['SHIPPED'] },
  { value: 'DELIVERED',     label: '배송완료', statuses: ['DELIVERED'] },
];

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
};

export function AdminOrdersClient({ orders }: Props) {
  const [activeTab, setActiveTab] = useState('ALL');

  const currentFilter = TAB_FILTERS.find((t) => t.value === activeTab);
  const filtered =
    currentFilter?.statuses == null
      ? orders
      : orders.filter((o) => currentFilter.statuses!.includes(o.status));

  return (
    <div className="space-y-4">
      <Tabs.Root value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          {TAB_FILTERS.map((tab) => (
            <Tabs.Trigger key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {TAB_FILTERS.map((tab) => (
          <Tabs.Panel key={tab.value} value={tab.value}>
            {/* Empty state */}
            {filtered.length === 0 ? (
              <div className="bg-canvas border border-hairline py-16 flex flex-col items-center gap-3 text-center">
                <span className="text-stone">
                  <IconInbox />
                </span>
                <p className="text-sm font-medium text-ink">해당 주문이 없습니다</p>
                <p className="text-xs text-mute">다른 탭을 확인해 보세요.</p>
              </div>
            ) : (
              <>
                {/* Desktop: table */}
                <div className="hidden md:block bg-canvas border border-hairline overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-soft-cloud border-b border-hairline">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">
                          주문번호
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">
                          상태
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">
                          주문인
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-mute">
                          총 금액
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">
                          주문일시
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-mute">
                          상세
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {filtered.map((order) => {
                        const badge = STATUS_BADGE[order.status];
                        return (
                          <tr
                            key={order.id as string}
                            className="hover:bg-soft-cloud/60 transition-colors"
                          >
                            <td className="px-4 py-3 font-mono text-xs text-mute whitespace-nowrap">
                              {order.orderNo as string}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={cn(
                                  'inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full',
                                  badge.className,
                                )}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap font-medium text-ink">
                              {order.orderer.name}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums font-medium text-ink">
                              {order.totalPrice.toLocaleString('ko-KR')}원
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-mute text-xs">
                              {formatDateTime(order.createdAt)}
                            </td>
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
                  {filtered.map((order) => {
                    const badge = STATUS_BADGE[order.status];
                    return (
                      <div
                        key={order.id as string}
                        className="bg-canvas border border-hairline p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-xs text-mute truncate">
                              {order.orderNo as string}
                            </p>
                            <p className="font-semibold text-ink text-sm mt-0.5">
                              {order.orderer.name}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full',
                              badge.className,
                            )}
                          >
                            {badge.label}
                          </span>
                        </div>

                        <div className="mt-2 flex items-center justify-between">
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium tabular-nums text-ink">
                              {order.totalPrice.toLocaleString('ko-KR')}원
                            </p>
                            <p className="text-xs text-mute">
                              {formatDateTime(order.createdAt)}
                            </p>
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
              </>
            )}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}
