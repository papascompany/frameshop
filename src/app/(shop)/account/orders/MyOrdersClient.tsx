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

// ── 리뷰 작성 모달 ────────────────────────────────────────────────────────────

type ReviewModalProps = {
  orderId: string;
  onClose: () => void;
  onSuccess: () => void;
};

function ReviewModal({ orderId, onClose, onSuccess }: ReviewModalProps) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, rating, body: body || null }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        onSuccess();
      } else {
        setError(typeof data.error === 'string' ? data.error : '리뷰 작성 실패');
      }
    } catch {
      setError('네트워크 오류');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="리뷰 작성"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Card padding="md" className="w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">리뷰 작성</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* 별점 */}
          <div className="space-y-1">
            <label className="text-sm font-medium">별점</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  aria-label={`별점 ${star}점`}
                  className={`text-2xl ${star <= rating ? 'text-amber-400' : 'text-gray-300'}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          {/* 내용 */}
          <div className="space-y-1">
            <label htmlFor="review-body" className="text-sm font-medium">
              내용 (선택)
            </label>
            <textarea
              id="review-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full border border-border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ink"
              placeholder="상품에 대한 솔직한 후기를 남겨주세요."
            />
            <p className="text-xs text-muted-fg text-right">{body.length}/2000</p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-red-600">{error}</p>
          ) : null}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
              리뷰 작성
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ── MyOrdersClient ────────────────────────────────────────────────────────────

type Props = {
  orders: OrderWithItems[];
};

export function MyOrdersClient({ orders }: Props) {
  const router = useRouter();
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [reviewOrderId, setReviewOrderId] = useState<string | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());

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
    <>
      {reviewOrderId ? (
        <ReviewModal
          orderId={reviewOrderId}
          onClose={() => setReviewOrderId(null)}
          onSuccess={() => {
            setReviewedIds((prev) => new Set([...prev, reviewOrderId]));
            setReviewOrderId(null);
          }}
        />
      ) : null}

      <ul className="flex flex-col gap-4">
        {orders.map((order) => {
          const firstTwo = order.items.slice(0, 2);
          const rest = order.items.length - 2;
          const isReordering = reorderingId === (order.id as string);
          const isDelivered = order.status === 'DELIVERED';
          const hasReview = reviewedIds.has(order.id as string);

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

                {/* 푸터 행 — 합계금액 + 리뷰 + 재주문 */}
                <div className="flex items-center justify-between border-t border-border pt-3 flex-wrap gap-2">
                  <p className="text-sm font-semibold tabular-nums">
                    {order.totalPrice.toLocaleString('ko-KR')}원
                  </p>
                  <div className="flex gap-2">
                    {isDelivered ? (
                      hasReview ? (
                        <Badge variant="success">리뷰 완료</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setReviewOrderId(order.id as string)}
                        >
                          리뷰 작성
                        </Button>
                      )
                    ) : null}
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
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
