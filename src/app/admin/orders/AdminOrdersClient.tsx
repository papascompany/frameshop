'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import type { OrderWithItems } from '@/types/order';
import type { OrderStatus } from '@/types/order';

type BadgeVariant = 'default' | 'accent' | 'dark' | 'success' | 'warning';

const STATUS_BADGE: Record<OrderStatus, { label: string; variant: BadgeVariant }> = {
  CREATED:       { label: '주문접수', variant: 'default' },
  PAID:          { label: '결제완료', variant: 'accent' },
  IN_PRODUCTION: { label: '제작중',   variant: 'warning' },
  SHIPPED:       { label: '배송중',   variant: 'dark' },
  DELIVERED:     { label: '배송완료', variant: 'success' },
  CANCELLED:     { label: '취소',     variant: 'default' },
  REFUNDED:      { label: '환불',     variant: 'default' },
};

const TAB_FILTERS: { value: string; label: string; statuses: OrderStatus[] | null }[] = [
  { value: 'ALL',           label: '전체',     statuses: null },
  { value: 'PAID',          label: '결제완료', statuses: ['PAID'] },
  { value: 'IN_PRODUCTION', label: '제작중',   statuses: ['IN_PRODUCTION'] },
  { value: 'SHIPPED',       label: '배송중',   statuses: ['SHIPPED'] },
  { value: 'DELIVERED',     label: '배송완료', statuses: ['DELIVERED'] },
];

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
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-fg text-center py-8">
                해당 주문이 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-fg whitespace-nowrap">
                        주문번호
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-muted-fg whitespace-nowrap">
                        상태
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-muted-fg whitespace-nowrap">
                        주문인
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-fg whitespace-nowrap">
                        총 금액
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-muted-fg whitespace-nowrap">
                        주문일시
                      </th>
                      <th className="px-4 py-3 text-center font-medium text-muted-fg whitespace-nowrap">
                        상세
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((order) => {
                      const badge = STATUS_BADGE[order.status];
                      return (
                        <tr key={order.id as string} className="hover:bg-surface-muted/40 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-muted-fg whitespace-nowrap">
                            {order.orderNo as string}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {order.orderer.name}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                            {order.totalPrice.toLocaleString('ko-KR')}원
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-muted-fg text-xs">
                            {new Date(order.createdAt).toLocaleString('ko-KR', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <Link
                              href={`/admin/orders/${order.id as string}`}
                              className="text-accent hover:underline text-xs font-medium"
                            >
                              상세보기
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}
