'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { groupOrderByGroupId } from '@/lib/order/grouping';
import type { OrderItem, OrderWithItems } from '@/types/order';
import type { OrderStatus } from '@/types/order';
import {
  startProductionAction,
  shipOrderAction,
  markDeliveredAction,
  cancelOrderAction,
  refundOrderAction,
  saveOrderMemoAction,
} from '../actions';
import { cn } from '@/lib/cn';

type BadgeVariant = 'default' | 'accent' | 'dark' | 'success' | 'warning';

/** Orderer-level memo cap — mirrors saveOrderMemoAction / setOrderMemo. */
const ORDER_MEMO_MAX = 200;

/** 저장 진행 상태. idle 외에는 인라인 피드백을 노출한다. */
type MemoSaveState = 'idle' | 'saving' | 'success' | 'error';

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

/** 현금영수증 식별번호 마스킹 — 마지막 4자리 숫자만 노출(하이픈은 유지). */
function maskReceiptInfo(info: string | null | undefined): string {
  if (!info) return '—';
  const totalDigits = info.replace(/[^0-9]/g, '').length;
  let seen = 0;
  return info
    .split('')
    .map((ch) => {
      if (!/[0-9]/.test(ch)) return ch;
      seen += 1;
      return seen > totalDigits - 4 ? ch : '*';
    })
    .join('');
}

/**
 * 묶음(세트) 라인 1행 — 그룹 트리의 구성 행과 단품 행이 공유한다.
 * 행별 인쇄파일 링크는 015 불변식(렌더 파이프라인 산출물 경로) 그대로 유지.
 */
function OrderItemRow({ item }: { item: OrderItem }) {
  return (
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
  );
}

type Props = {
  order: OrderWithItems;
  /** 038(orders.refunded_amount) 적용 여부 — false 면 부분환불 UI 비노출. */
  partialRefundAvailable: boolean;
};

export function AdminOrderDetailClient({ order, partialRefundAvailable }: Props) {
  const [status, setStatus] = useState(order.status);
  const [courier, setCourier] = useState(order.courier ?? '');
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Inline cancel/refund flow: null = idle, otherwise the pending action with
  // its reason text. Requires an explicit confirm + non-empty reason.
  const [pendingAction, setPendingAction] = useState<null | 'cancel' | 'refund' | 'partial'>(null);
  const [reason, setReason] = useState('');
  // 부분환불(FS-EC-03): 누적 환불액은 서버 응답으로 동기화한다.
  const [refunded, setRefunded] = useState(order.refundedAmount ?? 0);
  const [partialAmount, setPartialAmount] = useState('');

  // 관리자 메모(주문자 레벨 자유 메모). 배송 요청(shipping.memo)과 별개.
  // order.orderMemo 는 mapOrder 에서 항상 string | null 로 채워진다.
  const [memo, setMemo] = useState(order.orderMemo ?? '');
  const [memoSaveState, setMemoSaveState] = useState<MemoSaveState>('idle');
  const [memoError, setMemoError] = useState<string | null>(null);

  const memoTooLong = memo.length > ORDER_MEMO_MAX;

  const badge = STATUS_BADGE[status];
  // CREATED / PAID / IN_PRODUCTION can be cancelled; PAID / DELIVERED can be refunded.
  const canCancel = status === 'CREATED' || status === 'PAID' || status === 'IN_PRODUCTION';
  const canRefund = status === 'PAID' || status === 'DELIVERED';

  const remaining = order.totalPrice - refunded;
  // 부분환불: 038 적용 + 결제 존재 + 미종결 상태 + 잔여액 존재.
  const canPartialRefund =
    partialRefundAvailable &&
    Boolean(order.paymentId) &&
    remaining > 0 &&
    (status === 'PAID' || status === 'IN_PRODUCTION' || status === 'SHIPPED' || status === 'DELIVERED');

  const hasPrintFiles = order.items.some((item) => item.printFileUrl);

  // FS-X-05: 묶음(세트) 트리 — 그룹 키는 snapshot.groupLabel(ADR-025 동결).
  const grouped = groupOrderByGroupId(order.items);

  // 할인 분해(031/042 계약): 상품합계 + 배송비 + 추가배송비 − 쿠폰 − 적립금
  // = totalPrice(net 저장). 할인이 하나라도 있으면 분해 라인을 노출한다.
  // couponCode/couponDiscount 는 042 스냅샷(mapOrder — 미적용 시 null/0 폴백).
  const couponCode = order.couponCode ?? null;
  const couponDiscount = order.couponDiscount ?? 0;
  const pointsRedeemed = order.pointsRedeemed ?? 0;
  const surchargeFee = order.surchargeFee ?? 0;
  const itemsSubtotal = order.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const hasDiscounts = couponDiscount > 0 || pointsRedeemed > 0;

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
    if (pendingAction !== 'cancel' && pendingAction !== 'refund') return;
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
        : await refundOrderAction(order.id as string, { reason: reason.trim() });
    setLoading(false);
    if (result.ok) {
      setStatus(pendingAction === 'cancel' ? 'CANCELLED' : 'REFUNDED');
      setPendingAction(null);
      setReason('');
    } else {
      setError(result.error ?? '처리 실패');
    }
  }

  async function handleConfirmPartialRefund() {
    const amount = Number(partialAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('환불 금액은 1원 이상의 정수여야 합니다.');
      return;
    }
    if (amount > remaining) {
      setError(`환불 금액이 잔여 금액(${remaining.toLocaleString('ko-KR')}원)을 초과합니다.`);
      return;
    }
    if (reason.trim().length === 0) {
      setError('환불 사유를 입력해주세요.');
      return;
    }
    if (
      !window.confirm(
        `${amount.toLocaleString('ko-KR')}원을 부분환불합니다. 되돌릴 수 없습니다. 계속할까요?`,
      )
    ) {
      return;
    }

    setLoading(true);
    setError(null);
    const result = await refundOrderAction(order.id as string, {
      cancelAmount: amount,
      reason: reason.trim(),
    });
    setLoading(false);
    if (result.ok) {
      setRefunded(result.refundedAmount ?? refunded + amount);
      if (result.status) setStatus(result.status);
      setPendingAction(null);
      setPartialAmount('');
      setReason('');
    } else {
      setError(result.error ?? '부분환불 실패');
    }
  }

  async function handleSaveMemo() {
    if (memoTooLong) {
      setMemoSaveState('error');
      setMemoError(`메모는 최대 ${ORDER_MEMO_MAX}자까지 입력할 수 있습니다.`);
      return;
    }
    setMemoSaveState('saving');
    setMemoError(null);
    const result = await saveOrderMemoAction(order.id as string, memo);
    if (result.ok) {
      setMemoSaveState('success');
    } else {
      setMemoSaveState('error');
      setMemoError(result.error ?? '메모 저장 실패');
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
          {/* FS-X-05: 쿠폰/적립 할인 분해 (couponDiscount·pointsRedeemed > 0 시) */}
          {hasDiscounts && (
            <div className="col-span-2 border-t border-border pt-2">
              <dl className="space-y-1 text-sm" data-testid="order-discount-breakdown">
                <div className="flex justify-between">
                  <dt className="text-muted-fg">상품합계</dt>
                  <dd className="tabular-nums">
                    {itemsSubtotal.toLocaleString('ko-KR')}원
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-fg">배송비</dt>
                  <dd className="tabular-nums">
                    {order.shippingFee.toLocaleString('ko-KR')}원
                  </dd>
                </div>
                {surchargeFee > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-fg">추가 배송비</dt>
                    <dd className="tabular-nums">
                      {surchargeFee.toLocaleString('ko-KR')}원
                    </dd>
                  </div>
                )}
                {couponDiscount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-fg">
                      쿠폰 할인{couponCode ? ` (${couponCode})` : ''}
                    </dt>
                    <dd className="tabular-nums text-danger">
                      -{couponDiscount.toLocaleString('ko-KR')}원
                    </dd>
                  </div>
                )}
                {pointsRedeemed > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-fg">적립금 사용</dt>
                    <dd className="tabular-nums text-danger">
                      -{pointsRedeemed.toLocaleString('ko-KR')}원
                    </dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1 font-medium">
                  <dt>결제 금액</dt>
                  <dd className="tabular-nums">
                    {order.totalPrice.toLocaleString('ko-KR')}원
                  </dd>
                </div>
              </dl>
            </div>
          )}
          {refunded > 0 && (
            <>
              <div>
                <dt className="text-muted-fg">누적 환불액</dt>
                <dd className="tabular-nums font-medium text-danger">
                  {refunded.toLocaleString('ko-KR')}원
                </dd>
              </div>
              <div>
                <dt className="text-muted-fg">잔여 금액</dt>
                <dd className="tabular-nums font-medium">
                  {remaining.toLocaleString('ko-KR')}원
                </dd>
              </div>
            </>
          )}
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

      {/* 현금영수증 (039 미적용/미신청이면 receiptType null → 카드 비노출) */}
      {order.receiptType && (
        <Card padding="md">
          <h2 className="font-semibold mb-3">현금영수증</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-muted-fg">신청 유형</dt>
              <dd>{order.receiptType === 'income' ? '소득공제' : '지출증빙'}</dd>
            </div>
            <div>
              <dt className="text-muted-fg">식별번호</dt>
              <dd className="font-mono">{maskReceiptInfo(order.receiptInfo)}</dd>
            </div>
            <div>
              <dt className="text-muted-fg">발급 상태</dt>
              <dd>
                {order.receiptIssuedAt ? (
                  <Badge variant="success">발급완료</Badge>
                ) : (
                  <Badge variant="default">미발급</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-fg">발급 시각</dt>
              <dd>
                {order.receiptIssuedAt
                  ? new Date(order.receiptIssuedAt).toLocaleString('ko-KR')
                  : '—'}
              </dd>
            </div>
            {order.receiptUrl && (
              <div className="col-span-2">
                <dt className="text-muted-fg">영수증</dt>
                <dd>
                  <a
                    href={order.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    영수증 보기
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {/* 주문 상품 */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">주문 상품</h2>
          {hasPrintFiles && (
            <a
              href={`/api/admin/orders/${order.id as string}/zip`}
              className="text-sm text-accent hover:underline"
            >
              인쇄 파일 ZIP 다운로드
            </a>
          )}
        </div>
        <ul className="divide-y divide-border">
          {/* 묶음(세트) 그룹 — 헤더(라벨 + 구성 수 + 소계) + 구성 행 트리 */}
          {grouped.groups.map((group) => (
            <li key={group.key} className="py-3" data-testid="admin-order-group">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">
                  {group.key}{' '}
                  <span className="text-xs font-normal text-muted-fg">
                    구성 {group.lines.length}개
                  </span>
                </p>
                <p className="text-sm font-medium tabular-nums">
                  {group.subtotal.toLocaleString('ko-KR')}원
                </p>
              </div>
              <ul className="mt-2 border-l-2 border-border pl-3 divide-y divide-border">
                {group.lines.map((item) => (
                  <li key={item.id as string} className="py-2 flex items-start gap-4">
                    <OrderItemRow item={item} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {/* 단품 — 현행 평면 행 그대로 */}
          {grouped.singles.map((item) => (
            <li key={item.id as string} className="py-3 flex items-start gap-4">
              <OrderItemRow item={item} />
            </li>
          ))}
        </ul>
      </Card>

      {/* 관리자 메모 */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold">관리자 메모</h2>
          <span
            className={cn(
              'text-xs tabular-nums',
              memoTooLong ? 'text-danger' : 'text-muted-fg',
            )}
          >
            {memo.length}/{ORDER_MEMO_MAX}
          </span>
        </div>
        <p className="text-xs text-muted-fg mb-3">
          주문자 요청(사이즈 변경, 입금 확인 등)을 기록합니다. 배송 메모와는 별개이며 고객에게 노출되지 않습니다.
        </p>
        <textarea
          value={memo}
          onChange={(e) => {
            setMemo(e.target.value);
            if (memoSaveState !== 'idle') setMemoSaveState('idle');
            if (memoError) setMemoError(null);
          }}
          rows={4}
          maxLength={ORDER_MEMO_MAX}
          placeholder="관리자 메모를 입력하세요"
          disabled={memoSaveState === 'saving'}
          aria-invalid={memoTooLong ? true : undefined}
          className={cn(
            'w-full bg-surface text-foreground placeholder:text-muted-fg',
            'border border-border rounded-input px-3 py-2 text-sm resize-y',
            'transition-colors duration-150',
            'focus:outline-none focus:border-foreground',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            memoTooLong && 'border-danger focus:border-danger',
          )}
        />
        <div className="mt-3 flex items-center gap-3">
          <Button
            onClick={() => void handleSaveMemo()}
            loading={memoSaveState === 'saving'}
            disabled={memoSaveState === 'saving' || memoTooLong}
          >
            저장
          </Button>
          {memoSaveState === 'success' && (
            <span className="text-sm text-success">저장되었습니다.</span>
          )}
          {memoSaveState === 'error' && (
            <span className="text-sm text-danger">{memoError ?? '메모 저장 실패'}</span>
          )}
        </div>
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

        {/* 취소 / 환불 / 부분환불 */}
        {(canCancel || canRefund || canPartialRefund) && (
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
                {canPartialRefund && (
                  <Button
                    variant="ghost"
                    onClick={() => { setPendingAction('partial'); setError(null); }}
                    disabled={loading}
                  >
                    부분환불
                  </Button>
                )}
              </div>
            ) : pendingAction === 'partial' ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">부분환불</p>
                <p className="text-sm text-muted-fg tabular-nums">
                  누적 환불액 {refunded.toLocaleString('ko-KR')}원 / 잔여{' '}
                  {remaining.toLocaleString('ko-KR')}원 (총{' '}
                  {order.totalPrice.toLocaleString('ko-KR')}원)
                </p>
                <Input
                  label="환불 금액(원)"
                  type="number"
                  min={1}
                  max={remaining}
                  step={1}
                  placeholder={`1 ~ ${remaining.toLocaleString('ko-KR')}`}
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  disabled={loading}
                />
                <Input
                  label="사유"
                  placeholder="부분환불 사유"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={loading}
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => void handleConfirmPartialRefund()}
                    loading={loading}
                    disabled={loading}
                  >
                    부분환불 확정
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => { setPendingAction(null); setPartialAmount(''); setReason(''); setError(null); }}
                    disabled={loading}
                  >
                    닫기
                  </Button>
                </div>
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
