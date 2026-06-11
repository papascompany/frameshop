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
  cancelOrderAction,
  refundOrderAction,
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
  // Inline cancel/refund flow: null = idle, otherwise the pending action with
  // its reason text. Requires an explicit confirm + non-empty reason.
  const [pendingAction, setPendingAction] = useState<null | 'cancel' | 'refund'>(null);
  const [reason, setReason] = useState('');

  const badge = STATUS_BADGE[status];
  // CREATED / PAID / IN_PRODUCTION can be cancelled; PAID / DELIVERED can be refunded.
  const canCancel = status === 'CREATED' || status === 'PAID' || status === 'IN_PRODUCTION';
  const canRefund = status === 'PAID' || status === 'DELIVERED';

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
    // Shipping sends a customer email — confirm to avoid mis-click.
    if (!window.confirm(`${courier} ${trackingNumber.trim()} 운송장으로 출하 처리하고 고객에게 배송 알림을 보냅니다. 계속할까요?`)) {
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
    if (!window.confirm('배송완료로 변경합니다. 계속할까요?')) return;
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

  async function handleConfirmCancelOrRefund() {
    if (!pendingAction) return;
    if (reason.trim().length === 0) {
      setError(pendingAction === 'cancel' ? '취소 사유를 입력해주세요.' : '환불 사유를 입력해주세요.');
      return;
    }
    const isPaid = Boolean(order.paymentId);
    const verb = pendingAction === 'cancel' ? '취소' : '환불';
    const msg = isPaid
      ? `결제 금액 ${order.totalPrice.toLocaleString('ko-KR')}원을 환불하고 주문을 ${verb} 처리합니다. 되돌릴 수 없습니다. 계속할까요?`
      : `주문을 ${verb} 처리합니다. 되돌릴 수 없습니다. 계속할까요?`;
    if (!window.confirm(msg)) return;

    setLoading(true);
    setError(null);
    const result =
      pendingAction === 'cancel'
        ? await cancelOrderAction(order.id as string, reason.trim())
        : await refundOrderAction(order.id as string, reason.trim());
    setLoading(false);
    if (result.ok) {
      setStatus(pendingAction === 'cancel' ? 'CANCELLED' : 'REFUNDED');
      setPendingAction(null);
      setReason('');
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

        {status === 'CREATED' && (
          <p className="text-sm text-muted-fg mb-3">
            결제 대기 중입니다. 필요 시 아래에서 주문을 취소할 수 있습니다.
          </p>
        )}

        {(status === 'CANCELLED' || status === 'REFUNDED') && (
          <p className="text-sm text-muted-fg">
            {status === 'CANCELLED' ? '취소된 주문입니다.' : '환불된 주문입니다.'} 추가 전환은 없습니다.
          </p>
        )}

        {/* 취소 / 환불 */}
        {(canCancel || canRefund) && (
          <div className="mt-5 pt-5 border-t border-border">
            {pendingAction === null ? (
              <div className="flex flex-wrap gap-2">
                {canCancel && (
                  <Button
                    variant="ghost"
                    onClick={() => { setPendingAction('cancel'); setError(null); }}
                    disabled={loading}
                  >
                    주문 취소
                  </Button>
                )}
                {canRefund && (
                  <Button
                    variant="ghost"
                    onClick={() => { setPendingAction('refund'); setError(null); }}
                    disabled={loading}
                  >
                    환불
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  {pendingAction === 'cancel' ? '주문 취소' : '환불'}
                  {order.paymentId ? ` — 결제 ${order.totalPrice.toLocaleString('ko-KR')}원이 환불됩니다.` : ''}
                </p>
                <Input
                  label="사유"
                  placeholder={pendingAction === 'cancel' ? '취소 사유' : '환불 사유'}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={loading}
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => void handleConfirmCancelOrRefund()}
                    loading={loading}
                    disabled={loading}
                  >
                    {pendingAction === 'cancel' ? '취소 확정' : '환불 확정'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => { setPendingAction(null); setReason(''); setError(null); }}
                    disabled={loading}
                  >
                    닫기
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
