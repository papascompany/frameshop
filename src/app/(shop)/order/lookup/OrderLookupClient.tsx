'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatPhone } from '@/lib/checkout/validate';
import { groupOrderByGroupId } from '@/lib/order/grouping';
import { courierTrackingUrl } from '@/lib/shipping/courier';
import {
  ORIENTATION_LABELS,
  composeOrientationChips,
} from '../../cart/group-view';
import { ORDER_STATUSES, type OrderStatus } from '@/types/order';
import type { Orientation } from '@/types/project';

type LookupItem = {
  id: string;
  productName: string;
  sizeLabel: string;
  colorLabel: string;
  quantity: number;
  price: number;
  /** FS-X-04 — 라우트 확장 전 캐시/구응답 호환을 위해 옵셔널. */
  groupLabel?: string | null;
  orientation?: Orientation | null;
};

type LookupResult = {
  orderNo: string;
  status: string;
  createdAt: string;
  orderer: { name: string };
  shipping: { name: string; zip: string; addr1: string; addr2: string };
  totalPrice: number;
  shippingFee: number;
  /** FS-X-04 합계 분해 — 미적용 마이그레이션이면 0/null(행 비표시). */
  surchargeFee?: number;
  pointsRedeemed?: number;
  couponCode?: string | null;
  couponDiscount?: number;
  trackingNumber: string | null;
  courier: string | null;
  items: LookupItem[];
};

export function OrderLookupClient() {
  const searchParams = useSearchParams();
  const tStatus = useTranslations('order.status');
  // #9: drive labels off the canonical order.status.* keys so a status can
  // never leak as a raw English code (the old local map missed IN_PRODUCTION/REFUNDED).
  function statusLabel(status: string): string {
    return (ORDER_STATUSES as readonly string[]).includes(status)
      ? tStatus(status as OrderStatus)
      : status;
  }
  // Prefill the order number from ?orderNo= (e.g. the payment-fail recovery link).
  const [orderNo, setOrderNo] = useState(() => searchParams?.get('orderNo') ?? '');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  async function lookup() {
    setError(null);
    setResult(null);

    if (!/^\d{8}-\d{4}$/.test(orderNo)) {
      setError('주문번호 형식이 올바르지 않습니다. 예: 20260512-0001');
      return;
    }
    if (!/^01[0-9]-\d{3,4}-\d{4}$/.test(phone)) {
      setError('전화번호 형식이 올바르지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNo, phone }),
      });

      const data = (await res.json()) as { error?: string } & Partial<LookupResult>;

      if (!res.ok) {
        setError(data.error ?? '주문 조회에 실패했습니다.');
        return;
      }

      setResult(data as LookupResult);
    } catch {
      setError('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
          noValidate
        >
          <Input
            label="주문번호"
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
            placeholder="20260512-0001"
            hint="예: 20260512-0001"
          />
          <Input
            label="전화번호"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            inputMode="tel"
            autoComplete="tel"
          />
          <Button type="submit" variant="primary" loading={loading} disabled={loading}>
            {loading ? '조회 중…' : '조회'}
          </Button>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </form>
      </Card>

      {result ? (
        <Card padding="md" className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between font-semibold">
            <span>주문번호: {result.orderNo}</span>
            <span>{statusLabel(result.status)}</span>
          </div>
          <div className="text-muted-fg">
            주문일: {new Date(result.createdAt).toLocaleDateString('ko-KR')}
          </div>

          <hr className="border-muted" />

          <div>
            <p className="font-medium mb-1">주문 상품</p>
            {(() => {
              // FS-X-04: snapshot.groupLabel 기준 그룹 렌더(X-00 뷰모델 공용).
              // 프로젝션은 평면이라 스냅샷 형태로 어댑트해 넘긴다.
              const grouped = groupOrderByGroupId(
                result.items.map((item) => ({
                  ...item,
                  snapshot: { groupLabel: item.groupLabel ?? undefined },
                })),
              );
              return (
                <>
                  {grouped.groups.map((group) => (
                    <div
                      key={group.key}
                      className="border border-border p-2 mb-2"
                      data-testid="lookup-group"
                    >
                      <div className="flex justify-between font-medium">
                        <span>
                          {group.key}{' '}
                          <span className="text-xs text-muted-fg font-normal">
                            {composeOrientationChips(
                              group.lines.map((l) => l.orientation),
                            )}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {group.subtotal.toLocaleString('ko-KR')}원
                        </span>
                      </div>
                      {group.lines.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between py-1 text-muted-fg"
                        >
                          <span>
                            {item.productName} ({item.sizeLabel} / {item.colorLabel}
                            {item.orientation
                              ? ` / ${ORIENTATION_LABELS[item.orientation]}형`
                              : ''}
                            ) × {item.quantity}
                          </span>
                          <span>{item.price.toLocaleString('ko-KR')}원</span>
                        </div>
                      ))}
                      <p className="text-xs text-muted-fg mt-1">
                        세트는 주문 단위로만 취소할 수 있습니다
                      </p>
                    </div>
                  ))}
                  {grouped.singles.map((item) => (
                    <div key={item.id} className="flex justify-between py-1">
                      <span>
                        {item.productName} ({item.sizeLabel} / {item.colorLabel}) × {item.quantity}
                      </span>
                      <span>{item.price.toLocaleString('ko-KR')}원</span>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>

          <hr className="border-muted" />

          <div className="flex justify-between">
            <span>배송비</span>
            <span>{result.shippingFee.toLocaleString('ko-KR')}원</span>
          </div>
          {(result.surchargeFee ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span>제주/도서산간 추가 배송비</span>
              <span>+{(result.surchargeFee ?? 0).toLocaleString('ko-KR')}원</span>
            </div>
          ) : null}
          {(result.couponDiscount ?? 0) > 0 ? (
            <div className="flex justify-between" data-testid="lookup-coupon-row">
              <span>쿠폰 할인{result.couponCode ? ` (${result.couponCode})` : ''}</span>
              <span className="text-sale">
                -{(result.couponDiscount ?? 0).toLocaleString('ko-KR')}원
              </span>
            </div>
          ) : null}
          {(result.pointsRedeemed ?? 0) > 0 ? (
            <div className="flex justify-between" data-testid="lookup-redeem-row">
              <span>적립금 사용</span>
              <span className="text-sale">
                -{(result.pointsRedeemed ?? 0).toLocaleString('ko-KR')}원
              </span>
            </div>
          ) : null}
          <div className="flex justify-between font-semibold">
            <span>합계</span>
            <span>{result.totalPrice.toLocaleString('ko-KR')}원</span>
          </div>

          {result.trackingNumber ? (
            <>
              <hr className="border-muted" />
              <div>
                <p className="font-medium">배송 정보</p>
                {(() => {
                  const url = courierTrackingUrl(result.courier, result.trackingNumber);
                  return url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center text-ink underline underline-offset-2"
                    >
                      {result.courier} · {result.trackingNumber} · 배송조회
                    </a>
                  ) : (
                    <p className="text-muted-fg">
                      {result.courier} · {result.trackingNumber}
                    </p>
                  );
                })()}
              </div>
            </>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
