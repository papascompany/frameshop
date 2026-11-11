/**
 * 관리자 취소·환불 동시성 (cancelOrderAction / refundOrderAction) — CAS 고정.
 *
 * 예전에는 Toss 취소 후 `transitionTo`(같은 상태 전이를 성공으로 반환)를 써서, 같은
 * 주문을 동시에(또는 이미 종결된 주문을 다시) 조작하면 적립금·쿠폰 복원과 고객 알림이
 * 두 번 실행될 수 있었다. 이제는 `transitionIfStatus`(읽은 상태 → 목표) CAS 이고
 * 이긴 요청만 부수효과를 실행한다(customerCancelOrder 와 같은 방식). 환불 먼저 →
 * 성공해야 전이 순서는 그대로다.
 *
 * 주문 행은 하나의 공유 상태(row)로 두고, CAS 는 실제 UPDATE … WHERE status = from 과
 * 같은 의미로 동작한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderWithItems, OrderStatus } from '@/types/order';
import { asBrand } from '@/types/common';
import type { OrderId, PaymentKey, UserId } from '@/types/common';

const h = vi.hoisted(() => ({
  row: {
    status: 'PAID' as string,
    refundedAmount: 0,
  },
  overrides: {} as Record<string, unknown>,
}));

vi.mock('@/lib/db/admin', () => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin-1', email: 'admin@example.com', role: 'admin' })),
}));

vi.mock('@/lib/db/order', () => ({
  // 읽는 시점의 행 스냅샷을 돌려준다(동시 요청은 같은 상태를 읽을 수 있다).
  getOrder: vi.fn(async () => buildOrder()),
  transitionTo: vi.fn(async () => {
    throw new Error('cancel/refund must not use transitionTo');
  }),
  transitionIfStatus: vi.fn(async (_id: string, from: string, to: string) => {
    if (h.row.status !== from) return false;
    h.row.status = to;
    return true;
  }),
  readOrderStatus: vi.fn(async () => h.row.status),
  isTerminalCancelled: (s: string | null) => s === 'CANCELLED' || s === 'REFUNDED',
  setOrderMemo: vi.fn(),
}));

vi.mock('@/lib/notify', () => ({
  notifyShipped: vi.fn(async () => {}),
  notifyDelivered: vi.fn(async () => {}),
  notifyCancelled: vi.fn(async () => {}),
  notifyRefunded: vi.fn(async () => {}),
}));

vi.mock('@/lib/payment/toss', () => ({
  tossClient: {
    confirm: vi.fn(),
    cancel: vi.fn(async () => ({ status: 'CANCELED' })),
    getPayment: vi.fn(),
    issueCashReceipt: vi.fn(),
  },
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isPartialRefundAvailable: vi.fn(async () => true),
}));

vi.mock('@/lib/db/points', () => ({
  reversePointsForOrder: vi.fn(async () => ({ ok: true, restored: 0, reclaimed: 0 })),
}));

vi.mock('@/lib/db/coupons', () => ({
  releaseCouponByOrder: vi.fn(async () => {}),
}));

// 부분환불 누적액 낙관적 잠금(refunded_amount = prev 조건) — 공유 행 기준.
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: () => ({
      update: (patch: { refunded_amount: number }) => {
        const eqs: Record<string, unknown> = {};
        const builder = {
          eq(col: string, val: unknown) {
            eqs[col] = val;
            return builder;
          },
          select: async () => {
            if (eqs.refunded_amount !== h.row.refundedAmount) return { data: [], error: null };
            h.row.refundedAmount = patch.refunded_amount;
            return { data: [{ id: 'order-id-1' }], error: null };
          },
        };
        return builder;
      },
    }),
  }),
}));

import { cancelOrderAction, refundOrderAction } from '@/app/admin/orders/actions';
import { transitionIfStatus } from '@/lib/db/order';
import { reversePointsForOrder } from '@/lib/db/points';
import { releaseCouponByOrder } from '@/lib/db/coupons';
import { notifyCancelled, notifyRefunded } from '@/lib/notify';
import { tossClient } from '@/lib/payment/toss';

const casMock = vi.mocked(transitionIfStatus);
const reverseMock = vi.mocked(reversePointsForOrder);
const couponMock = vi.mocked(releaseCouponByOrder);
const notifyCancelledMock = vi.mocked(notifyCancelled);
const notifyRefundedMock = vi.mocked(notifyRefunded);
const cancelMock = vi.mocked(tossClient.cancel);

const ALREADY = '이미 취소·환불 처리된 주문입니다.';

function buildOrder(): OrderWithItems {
  return {
    id: asBrand<OrderId>('order-id-1'),
    orderNo: '20261111-0001' as unknown as OrderWithItems['orderNo'],
    userId: asBrand<UserId>('user-1'),
    status: h.row.status as OrderStatus,
    totalPrice: 30000,
    shippingFee: 3000,
    shippingMethod: 'STANDARD' as unknown as OrderWithItems['shippingMethod'],
    paymentId: asBrand<PaymentKey>('tk_pay_1'),
    trackingNumber: null,
    courier: null,
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'hong@example.com' },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '06234',
      addr1: '서울시 강남구 테헤란로 123',
      addr2: '101호',
      memo: '',
    },
    refundedAmount: h.row.refundedAmount,
    pointsRedeemed: 5000,
    pointsAccrued: 280,
    couponCode: 'WELCOME10',
    createdAt: '2026-11-11T00:00:00Z',
    paidAt: '2026-11-11T01:00:00Z',
    shippedAt: null,
    items: [],
    ...h.overrides,
  } as OrderWithItems;
}

/** 부수효과(적립금·쿠폰 복원, 알림) 실행 횟수. */
function sideEffects() {
  return {
    reverse: reverseMock.mock.calls.length,
    coupon: couponMock.mock.calls.length,
    notify: notifyCancelledMock.mock.calls.length + notifyRefundedMock.mock.calls.length,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.row.status = 'PAID';
  h.row.refundedAmount = 0;
  h.overrides = {};
  cancelMock.mockImplementation(async () => ({ status: 'CANCELED' }) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('관리자 취소·환불 — 동시 요청은 한 번만 부수효과를 실행한다', () => {
  it('같은 PAID 주문 동시 취소 2회 → 하나만 성공, 적립금·쿠폰 복원·알림 각 1회', async () => {
    const results = await Promise.all([
      cancelOrderAction('order-id-1', '재고 문제'),
      cancelOrderAction('order-id-1', '재고 문제'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.error).toBe(ALREADY);
    expect(h.row.status).toBe('CANCELLED');
    expect(sideEffects()).toEqual({ reverse: 1, coupon: 1, notify: 1 });
  });

  it('미결제 CREATED 주문 동시 취소 2회 → CAS 하나만 이김(쿠폰은 미소비라 복원 없음)', async () => {
    h.row.status = 'CREATED';
    h.overrides = { paymentId: null, paidAt: null };

    const results = await Promise.all([
      cancelOrderAction('order-id-1', '고객 요청'),
      cancelOrderAction('order-id-1', '고객 요청'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.error).toBe(ALREADY);
    expect(cancelMock).not.toHaveBeenCalled();
    expect(sideEffects()).toEqual({ reverse: 1, coupon: 0, notify: 1 });
  });

  it('같은 주문에 취소와 전액환불이 동시에 오면 하나만 종결하고 부수효과는 1회', async () => {
    const results = await Promise.all([
      cancelOrderAction('order-id-1', '재고 문제'),
      refundOrderAction('order-id-1', { reason: '단순 변심' }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(['CANCELLED', 'REFUNDED']).toContain(h.row.status);
    expect(sideEffects()).toEqual({ reverse: 1, coupon: 1, notify: 1 });
  });

  it('같은 주문 동시 전액환불 2회 → 하나만 REFUNDED 전이, 부수효과 1회', async () => {
    const results = await Promise.all([
      refundOrderAction('order-id-1', { reason: '단순 변심' }),
      refundOrderAction('order-id-1', { reason: '단순 변심' }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(h.row.status).toBe('REFUNDED');
    expect(sideEffects()).toEqual({ reverse: 1, coupon: 1, notify: 1 });
  });
});

describe('관리자 취소·환불 — 이미 종결·전이 불가 상태는 Toss 전에 거부', () => {
  it.each(['CANCELLED', 'REFUNDED'])(
    '%s 주문 재취소 → Toss 미호출·부수효과 없음(예전엔 같은 상태 전이가 성공해 재실행됨)',
    async (status) => {
      h.row.status = status;
      const result = await cancelOrderAction('order-id-1', '재고 문제');

      expect(result).toEqual({ ok: false, error: ALREADY });
      expect(cancelMock).not.toHaveBeenCalled();
      expect(casMock).not.toHaveBeenCalled();
      expect(sideEffects()).toEqual({ reverse: 0, coupon: 0, notify: 0 });
    },
  );

  it('이미 REFUNDED 인 주문 재환불 → Toss 미호출·부수효과 없음', async () => {
    h.row.status = 'REFUNDED';
    const result = await refundOrderAction('order-id-1', { reason: '단순 변심' });

    expect(result).toEqual({ ok: false, error: ALREADY });
    expect(cancelMock).not.toHaveBeenCalled();
    expect(sideEffects()).toEqual({ reverse: 0, coupon: 0, notify: 0 });
  });

  it('SHIPPED 주문 취소 → 환불하지 않고 거부(예전엔 Toss 환불 후 전이 실패)', async () => {
    h.row.status = 'SHIPPED';
    const result = await cancelOrderAction('order-id-1', '재고 문제');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('취소할 수 없습니다');
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it.each(['IN_PRODUCTION', 'SHIPPED'])(
    '%s 주문 전액환불 → 환불하지 않고 거부(예전엔 Toss 환불 후 전이 실패)',
    async (status) => {
      h.row.status = status;
      const result = await refundOrderAction('order-id-1', { reason: '단순 변심' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('전액 환불할 수 없습니다');
      expect(cancelMock).not.toHaveBeenCalled();
    },
  );
});

describe('관리자 취소·환불 — 경합에서 진 요청', () => {
  it('Toss 취소가 실패했는데 그사이 다른 요청이 종결했다면 "이미 처리됨"으로 수렴', async () => {
    cancelMock.mockImplementationOnce(async () => {
      h.row.status = 'CANCELLED'; // 동시 요청이 먼저 환불·전이 완료
      throw new Error('이미 취소된 결제 입니다.');
    });

    const result = await cancelOrderAction('order-id-1', '재고 문제');

    expect(result).toEqual({ ok: false, error: ALREADY });
    expect(sideEffects()).toEqual({ reverse: 0, coupon: 0, notify: 0 });
  });

  it('Toss 취소 실패 + 상태 그대로면 환불 실패를 그대로 알린다(전이 없음)', async () => {
    cancelMock.mockRejectedValueOnce(new Error('PG down'));

    const result = await refundOrderAction('order-id-1', { reason: '단순 변심' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('결제 취소(환불) 실패: PG down');
    expect(casMock).not.toHaveBeenCalled();
    expect(h.row.status).toBe('PAID');
  });

  it('환불 후 CAS 직전에 다른 경로가 비종결 상태로 바꿨으면 부수효과 없이 구조화 로그', async () => {
    cancelMock.mockImplementationOnce(async () => {
      h.row.status = 'IN_PRODUCTION'; // 동시에 제작 시작
      return { status: 'CANCELED' } as never;
    });

    const result = await refundOrderAction('order-id-1', { reason: '단순 변심' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('주문 상태가 바뀌어');
    expect(sideEffects()).toEqual({ reverse: 0, coupon: 0, notify: 0 });
    const logged = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('"event":"admin_refund_cas_lost"');
    expect(logged).toContain('"refunded":true');
  });

  it('부분환불이 전액에 도달했지만 동시 전액환불이 먼저 REFUNDED 로 만들었으면 부수효과를 반복하지 않는다', async () => {
    h.row.refundedAmount = 10000;
    cancelMock.mockImplementationOnce(async () => {
      h.row.status = 'REFUNDED'; // 동시 fullRefund 가 먼저 전이·부수효과 실행
      return { status: 'CANCELED' } as never;
    });

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 20000,
      reason: '전량 파손',
    });

    // 이 요청의 부분환불(돈 + 누적 기록) 자체는 끝났으므로 성공.
    expect(result).toEqual({ ok: true, refundedAmount: 30000, status: 'REFUNDED' });
    expect(h.row.refundedAmount).toBe(30000);
    expect(sideEffects()).toEqual({ reverse: 0, coupon: 0, notify: 0 });
    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(warned).toContain('partial_refund_full_cas_lost');
  });
});
