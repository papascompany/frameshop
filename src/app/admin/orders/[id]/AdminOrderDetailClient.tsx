'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { OrderWithItems } from '@/types/order';
import type { OrderStatus } from '@/types/order';
import {
  startProductionAction,
  shipOrderAction,
  markDeliveredAction,
} from '../actions';

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

const COURIER_OPTIONS = [
  { value: 'CJ대한통운', label: 'CJ대한통운' },
  { value: '롯데택배',   label: '롯데택배' },
  { value: '우체국',     label: '우체국' },
  { value: '한진',       label: '한진' },
  { value: '로젠',       label: '로젠' },
];

type Props = {
  order: OrderWithItems;
};

export function AdminOrderDetailClient({ order }: Props) {
  const [status, setStatus] = useState(order.status);
  const [courier, setCourier] = useState(order.courier ?? '');
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badge = STATUS_BADGE[status];

  async function handleStartProduction() {
    setLoading(true);
    setError(null);
    const result = await startProductionAction(order.id as string);
    setLoading(false);
    if (result.ok) {
      setStatus('IN_PRODUCTION');
    } else {
      setError(result.error ?? '처리 실패');
    }
  }

  async function handleShip() {
    if (!courier) {
      setError('택배사를 선택해주세요.');
      return;
    }
    if (!trackingNumber.trim()) {
      setError('운송장번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await shipOrderAction(order.id as string, courier, trackingNumber.trim());
    setLoading(false);
    if (result.ok) {
      setStatus('SHIPPED');
    } else {
      setError(result.error ?? '처리 실패');
    }
  }

  async function handleDelivered() {
    setLoading(true);
    setError(null);
    const result = await markDeliveredAction(order.id as string);
    setLoading(false);
    if (result.ok) {
      setStatus('DELIVERED');
    } else {
      setError(result.error ?? '처리 실패');
    }
  }

  return (
    <div className="space-y-6">
      {/* 기본 정보 */}
      <Card padding="md">
        <h2 className="font-semibold mb-3">주문 기본 정보</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-fg">주문번호</dt>
            <dd className="font-mono">{order.orderNo as string}</dd>
          </div>
          <div>
            <dt className="text-muted-fg">상태</dt>
            <dd>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-fg">결제일</dt>
            <dd>
              {order.paidAt
                ? new Date(order.paidAt).toLocaleString('ko-KR')
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-fg">총 금액</dt>
            <dd className="tabular-nums font-medium">
              {order.totalPrice.toLocaleString('ko-KR')}원
            </dd>
          </div>
          {(courier || order.courier) && (
            <>
              <div>
                <dt className="text-muted-fg">택배사</dt>
                <dd>{courier || order.courier}</dd>
              </div>
              <div>
                <dt className="text-muted-fg">운송장번호</dt>
                <dd className="font-mono">{trackingNumber || order.trackingNumber}</dd>
              </div>
            </>
          )}
        </dl>
      </Card>

      {/* 배송지 정보 */}
      <Card padding="md">
        <h2 className="font-semibold mb-3">배송지 정보</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-fg">수령인</dt>
            <dd>{order.shipping.name}</dd>
          </div>
          <div>
            <dt className="text-muted-fg">전화번호</dt>
            <dd>{order.shipping.phone}</dd>
          </div>
          <div>
            <dt className="text-muted-fg">우편번호</dt>
            <dd>{order.shipping.zip}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-fg">주소</dt>
            <dd>{order.shipping.addr1} {order.shipping.addr2}</dd>
          </div>
          {order.shipping.memo && (
            <div className="col-span-2">
              <dt className="text-muted-fg">배송 메모</dt>
              <dd className="text-muted-fg italic">{order.shipping.memo}</dd>
            </div>
          )}
        </dl>
      </Card>

      {/* 주문 상품 */}
      <Card padding="md">
        <h2 className="font-semibold mb-3">주문 상품</h2>
        <ul className="divide-y divide-border">
          {order.items.map((item) => (
            <li key={item.id as string} className="py-3 flex items-start gap-4">
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium">{item.snapshot.productName}</p>
                <p className="text-xs text-muted-fg">
                  {item.snapshot.sizeLabel} / {item.snapshot.colorLabel}
                </p>
                <p className="text-xs text-muted-fg">
                  수량: {item.quantity} &nbsp;|&nbsp; 단가:{' '}
                  {item.snapshot.unitPrice.toLocaleString('ko-KR')}원
                </p>
                {item.printFileUrl && (
                  <a
                    href={item.printFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline"
                  >
                    인쇄 파일 다운로드
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* 상태 전환 */}
      <Card padding="md">
        <h2 className="font-semibold mb-4">상태 전환</h2>

        {error && (
          <p className="text-sm text-danger mb-3">{error}</p>
        )}

        {status === 'PAID' && (
          <Button
            onClick={() => void handleStartProduction()}
            loading={loading}
            disabled={loading}
          >
            제작 시작
          </Button>
        )}

        {status === 'IN_PRODUCTION' && (
          <div className="space-y-3">
            <Select
              label="택배사"
              options={COURIER_OPTIONS}
              placeholder="택배사 선택"
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              disabled={loading}
            />
            <Input
              label="운송장번호"
              placeholder="운송장번호 입력"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              disabled={loading}
            />
            <Button
              onClick={() => void handleShip()}
              loading={loading}
              disabled={loading}
            >
              출하 처리
            </Button>
          </div>
        )}

        {status === 'SHIPPED' && (
          <Button
            onClick={() => void handleDelivered()}
            loading={loading}
            disabled={loading}
          >
            배송완료
          </Button>
        )}

        {(status === 'DELIVERED' || status === 'CANCELLED' || status === 'REFUNDED' || status === 'CREATED') && (
          <p className="text-sm text-muted-fg">현재 상태에서 전환 가능한 액션이 없습니다.</p>
        )}
      </Card>
    </div>
  );
}
