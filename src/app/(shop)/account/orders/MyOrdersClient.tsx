'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { OrderStatus, OrderWithItems } from '@/types/order';

// ── 주문 상태 한국어 매핑 ──────────────────────────────────────────────────────

export function orderStatusLabel(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    CREATED: '주문접수',
    PAID: '결제완료',
    IN_PRODUCTION: '제작중',
    SHIPPED: '배송중',
    DELIVERED: '배송완료',
    CANCELLED: '취소됨',
    REFUNDED: '환불됨',
  };
  return map[status] ?? status;
}

function orderStatusVariant(status: OrderStatus): 'default' | 'success' | 'warning' | 'accent' {
  switch (status) {
    case 'PAID':
    case 'DELIVERED':
      return 'success';
    case 'IN_PRODUCTION':
    case 'SHIPPED':
      return 'accent';
    case 'CANCELLED':
    case 'REFUNDED':
      return 'warning';
    default:
      return 'default';
  }
}

// ── MyOrdersClient ────────────────────────────────────────────────────────────

type Props = {
  orders: OrderWithItems[];
};

export function MyOrdersClient({ orders }: Props) {
  const router = useRouter();
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  async function handleReorder(orderId: string) {
    setReorderingId(orderId);
    try {
      const res = await fetch('/api/cart/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        items?: Array<{ productId: string; variantId: string }>;
        code?: string;
      };
      if (!body.ok) {
        alert('재주문 처리 중 오류가 발생했습니다.');
        return;
      }
      // 재주문 아이템을 cart에 추가.
      // 이 경로의 아이템은 photo / cropTransform 정보가 없어
      // 재편집이 필요하므로, 장바구니로 이동 후 사용자가 직접 확인.
      router.push('/cart');
    } catch {
      alert('재주문 요청에 실패했습니다.');
    } finally {
      setReorderingId(null);
    }
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-16 text-muted-fg">
        <p className="text-sm">주문 내역이 없습니다.</p>
        <Link href="/catalog/basic-frame" className="mt-4 inline-block text-sm underline">
          쇼핑 시작하기
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {orders.map((order) => {
        const firstTwo = order.items.slice(0, 2);
        const rest = order.items.length - 2;
        const isReordering = reorderingId === (order.id as string);

        return (
          <li key={order.id as string}>
            <Card padding="md" className="space-y-3">
              {/* 헤더 행 */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <p className="text-xs text-muted-fg tabular-nums">
                    주문번호: {order.orderNo}
                  </p>
                  <p className="text-xs text-muted-fg tabular-nums">
                    {new Date(order.createdAt).toLocaleDateString('ko-KR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <Badge variant={orderStatusVariant(order.status)}>
                  {orderStatusLabel(order.status)}
                </Badge>
              </div>

              {/* 상품 목록 요약 */}
              <div className="border-t border-border pt-3 space-y-1">
                {firstTwo.map((item) => (
                  <p key={item.id as string} className="text-sm text-foreground truncate">
                    {item.snapshot.productName}{' '}
                    <span className="text-muted-fg text-xs">
                      {item.snapshot.sizeLabel} / {item.snapshot.colorLabel}
                      {item.quantity > 1 ? ` x${item.quantity}` : ''}
                    </span>
                  </p>
                ))}
                {rest > 0 && (
                  <p className="text-xs text-muted-fg">외 {rest}건</p>
                )}
              </div>

              {/* 인쇄파일 링크 */}
              {order.items.some((item) => item.printFileUrl) && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {order.items
                    .filter((item) => item.printFileUrl)
                    .map((item) => (
                      <a
                        key={item.id as string}
                        href={item.printFileUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline text-foreground hover:text-muted-fg"
                      >
                        인쇄파일 보기
                      </a>
                    ))}
                </div>
              )}

              {/* 푸터 행 — 합계금액 + 재주문 */}
              <div className="flex items-center justify-between border-t border-border pt-3">
                <p className="text-sm font-semibold tabular-nums">
                  {order.totalPrice.toLocaleString('ko-KR')}원
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={isReordering}
                  disabled={isReordering}
                  onClick={() => void handleReorder(order.id as string)}
                >
                  재주문
                </Button>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
