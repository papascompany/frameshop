'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatPhone } from '@/lib/checkout/validate';

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

const STATUS_LABEL: Record<string, string> = {
  CREATED: '주문 접수',
  PAID: '결제 완료',
  PREPARING: '제작 중',
  SHIPPED: '배송 중',
  DELIVERED: '배송 완료',
  CANCELLED: '취소',
};

export function OrderLookupClient() {
  const [orderNo, setOrderNo] = useState('');
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
      <Card padding="md" className="flex flex-col gap-3">
        <Input
          label="주문번호"
          value={orderNo}
          onChange={(e) => setOrderNo(e.target.value)}
          placeholder="20260512-0001"
        />
        <Input
          label="전화번호"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          inputMode="tel"
        />
        <Button variant="primary" onClick={lookup} disabled={loading}>
          {loading ? '조회 중…' : '조회'}
        </Button>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
      </Card>

      {result ? (
        <Card padding="md" className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between font-semibold">
            <span>주문번호: {result.orderNo}</span>
            <span>{STATUS_LABEL[result.status] ?? result.status}</span>
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
                <p className="text-muted-fg">
                  {result.courier} · {result.trackingNumber}
                </p>
              </div>
            </>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
