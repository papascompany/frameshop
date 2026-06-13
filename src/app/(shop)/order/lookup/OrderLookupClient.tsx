'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatPhone } from '@/lib/checkout/validate';
import { courierTrackingUrl } from '@/lib/shipping/courier';
import { ORDER_STATUSES, type OrderStatus } from '@/types/order';

type LookupResult = {
  orderNo: string;
  status: string;
  createdAt: string;
  orderer: { name: string };
  shipping: { name: string; zip: string; addr1: string; addr2: string };
  totalPrice: number;
  shippingFee: number;
  trackingNumber: string | null;
  courier: string | null;
  items: Array<{
    id: string;
    productName: string;
    sizeLabel: string;
    colorLabel: string;
    quantity: number;
    price: number;
  }>;
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
            {result.items.map((item) => (
              <div key={item.id} className="flex justify-between py-1">
                <span>
                  {item.productName} ({item.sizeLabel} / {item.colorLabel}) × {item.quantity}
                </span>
                <span>{item.price.toLocaleString('ko-KR')}원</span>
              </div>
            ))}
          </div>

          <hr className="border-muted" />

          <div className="flex justify-between">
            <span>배송비</span>
            <span>{result.shippingFee.toLocaleString('ko-KR')}원</span>
          </div>
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
