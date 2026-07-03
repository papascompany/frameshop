/**
 * refundOrderAction 부분환불(FS-EC-03) 단위 테스트.
 *
 * 핵심 정합:
 * - 서버 검증: 0 < cancelAmount ≤ totalPrice − refundedAmount (경계 3종).
 * - Toss cancel 성공 후에만 refunded_amount 누적 UPDATE(낙관적 잠금).
 * - 누적 == totalPrice → REFUNDED 전이 + notifyRefunded. 부분 상태는 상태 무변경.
 * - 038 미적용(probe false): 부분환불 명시 에러 + 전액환불 기존 동작 무변경.
 * - UPDATE 실패는 은폐하지 않는다(구조화 로그 + 수동 보정 안내).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderWithItems } from '@/types/order';
import { asBrand } from '@/types/common';
import type { OrderId, PaymentKey, UserId } from '@/types/common';

const h = vi.hoisted(() => ({
  updateCalls: [] as Array<{
    table: string;
    patch: Record<string, unknown>;
    eqs: Array<[string, unknown]>;
  }>,
  updateResponse: {
    data: [{ id: 'order-id-1' }] as Array<{ id: string }> | null,
    error: null as { message: string } | null,
  },
}));

vi.mock('@/lib/db/admin', () => ({
  requireAdmin: vi.fn(async () => ({
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
  })),
}));

vi.mock('@/lib/db/order', () => ({
  getOrder: vi.fn(),
  transitionTo: vi.fn(async () => ({})),
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
  isReceiptAvailable: vi.fn(async () => true),
  isPointsAvailable: vi.fn(async () => true),
  isSurchargeAvailable: vi.fn(async () => true),
  isConfirmAvailable: vi.fn(async () => true),
}));

// FS-EC P1-1: 환불 액션 → 원장 정합 위임 seam 검증용.
vi.mock('@/lib/db/points', () => ({
  reversePointsForOrder: vi.fn(async () => ({
    ok: true,
    restored: 0,
    reclaimed: 0,
  })),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        const call = { table, patch, eqs: [] as Array<[string, unknown]> };
        h.updateCalls.push(call);
        const builder = {
          eq(col: string, val: unknown) {
            call.eqs.push([col, val]);
            return builder;
          },
          select: () => Promise.resolve(h.updateResponse),
        };
        return builder;
      },
    }),
  }),
}));

import { cancelOrderAction, refundOrderAction } from '@/app/admin/orders/actions';
import { getOrder, transitionTo } from '@/lib/db/order';
import { reversePointsForOrder } from '@/lib/db/points';
import { notifyRefunded } from '@/lib/notify';
import { tossClient } from '@/lib/payment/toss';
import { isPartialRefundAvailable } from '@/lib/db/feature-probe';

const getOrderMock = vi.mocked(getOrder);
const transitionToMock = vi.mocked(transitionTo);
const reverseMock = vi.mocked(reversePointsForOrder);
const notifyRefundedMock = vi.mocked(notifyRefunded);
const cancelMock = vi.mocked(tossClient.cancel);
const probeMock = vi.mocked(isPartialRefundAvailable);

function makeOrder(overrides: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    id: asBrand<OrderId>('order-id-1'),
    orderNo: '20260703-0001' as unknown as OrderWithItems['orderNo'],
    userId: null,
    status: 'PAID',
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
    refundedAmount: 0,
    createdAt: '2026-07-03T00:00:00Z',
    paidAt: '2026-07-03T01:00:00Z',
    shippedAt: null,
    items: [],
    ...overrides,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.updateCalls.length = 0;
  h.updateResponse = { data: [{ id: 'order-id-1' }], error: null };
  probeMock.mockResolvedValue(true);
  cancelMock.mockResolvedValue({ status: 'CANCELED' } as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('부분환불 — 038 미적용(graceful degradation)', () => {
  it('probe false 면 명시 에러를 반환하고 Toss 를 호출하지 않는다', async () => {
    probeMock.mockResolvedValue(false);

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 1000,
      reason: '단순 변심',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('038');
    expect(cancelMock).not.toHaveBeenCalled();
    expect(h.updateCalls).toHaveLength(0);
  });

  it('전액환불(cancelAmount 미지정)은 probe 와 무관하게 기존 동작 그대로다', async () => {
    probeMock.mockResolvedValue(false);
    getOrderMock.mockResolvedValue(makeOrder());

    const result = await refundOrderAction('order-id-1', { reason: '단순 변심' });

    expect(result.ok).toBe(true);
    // 기존 전액환불 경로는 probe 자체를 조회하지 않는다.
    expect(probeMock).not.toHaveBeenCalled();
    // Toss 전액 취소: cancelAmount 없이 호출.
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock.mock.calls[0][0]).not.toHaveProperty('cancelAmount');
    // 기존 REFUNDED 전이 + 고객 알림 유지.
    expect(transitionToMock).toHaveBeenCalledWith(
      asBrand<OrderId>('order-id-1'),
      'REFUNDED',
      { reason: '단순 변심' },
    );
    expect(notifyRefundedMock).toHaveBeenCalledTimes(1);
    // refunded_amount 는 건드리지 않는다(무변경).
    expect(h.updateCalls).toHaveLength(0);
  });
});

describe('부분환불 — 금액 경계 검증(서버 권위)', () => {
  it('cancelAmount = 0 이면 거부하고 Toss 를 호출하지 않는다', async () => {
    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 0,
      reason: '테스트',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('1원 이상');
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('정수가 아닌 cancelAmount 는 거부한다', async () => {
    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 100.5,
      reason: '테스트',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('정수');
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('잔여 금액(totalPrice − refundedAmount) 초과는 거부한다', async () => {
    getOrderMock.mockResolvedValue(makeOrder({ refundedAmount: 10000 }));

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 20001, // 잔여 20000 초과
      reason: '테스트',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('잔여');
    expect(cancelMock).not.toHaveBeenCalled();
    expect(h.updateCalls).toHaveLength(0);
  });
});

describe('부분환불 — 정상 경로', () => {
  it('Toss 부분취소 성공 후 refunded_amount 를 낙관적 잠금으로 누적한다(상태 무변경)', async () => {
    getOrderMock.mockResolvedValue(makeOrder({ refundedAmount: 10000 }));

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 5000,
      reason: '부분 파손',
    });

    expect(cancelMock).toHaveBeenCalledWith({
      paymentKey: asBrand<PaymentKey>('tk_pay_1'),
      cancelReason: '부분 파손',
      cancelAmount: 5000,
    });
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0].table).toBe('orders');
    expect(h.updateCalls[0].patch).toEqual({ refunded_amount: 15000 });
    // 낙관적 잠금: id + 이전 누적액 일치 조건.
    expect(h.updateCalls[0].eqs).toEqual([
      ['id', 'order-id-1'],
      ['refunded_amount', 10000],
    ]);
    // 부분 상태 — 상태기계 전이 없음, 알림 없음.
    expect(transitionToMock).not.toHaveBeenCalled();
    expect(notifyRefundedMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, refundedAmount: 15000, status: 'PAID' });
  });

  it('누적이 totalPrice 에 도달하면 REFUNDED 전이 + notifyRefunded', async () => {
    getOrderMock.mockResolvedValue(makeOrder({ refundedAmount: 10000 }));

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 20000,
      reason: '전량 파손',
    });

    expect(h.updateCalls[0].patch).toEqual({ refunded_amount: 30000 });
    expect(transitionToMock).toHaveBeenCalledWith(
      asBrand<OrderId>('order-id-1'),
      'REFUNDED',
      { reason: '전량 파손' },
    );
    expect(notifyRefundedMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, refundedAmount: 30000, status: 'REFUNDED' });
  });

  it('전액 도달이라도 REFUNDED 전이가 불가한 상태(IN_PRODUCTION)면 상태를 유지하고 기록만 남긴다', async () => {
    getOrderMock.mockResolvedValue(
      makeOrder({ status: 'IN_PRODUCTION', refundedAmount: 0 }),
    );

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 30000,
      reason: '전량 파손',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('IN_PRODUCTION');
    expect(transitionToMock).not.toHaveBeenCalled();
    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(warned).toContain('partial_refund_full_no_transition');
  });
});

describe('부분환불 — 실패 은폐 금지', () => {
  it('Toss 성공 후 누적 UPDATE 실패 시 구조화 로그 + 수동 보정 안내 에러', async () => {
    getOrderMock.mockResolvedValue(makeOrder({ refundedAmount: 10000 }));
    h.updateResponse = { data: [], error: null }; // 낙관적 잠금 불일치(0 rows)

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 5000,
      reason: '부분 파손',
    });

    // Toss 환불은 이미 집행됨 — 실패를 성공으로 둔갑시키지 않는다.
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('수동 보정');
    expect(result.error).toContain('15,000');
    const logged = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('partial_refund_update_failed');
    // 기록이 안 됐으므로 상태 전이도 하지 않는다.
    expect(transitionToMock).not.toHaveBeenCalled();
  });

  it('환불 사유가 비어 있으면 거부한다', async () => {
    const result = await refundOrderAction('order-id-1', { cancelAmount: 1000 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('사유');
    expect(cancelMock).not.toHaveBeenCalled();
  });
});

describe('환불 — 적립금 원장 정합 위임(FS-EC P1-1)', () => {
  const pointsOrder = (overrides: Partial<OrderWithItems> = {}): OrderWithItems =>
    makeOrder({
      userId: asBrand<UserId>('user-1'),
      pointsRedeemed: 5000,
      pointsAccrued: 280,
      ...overrides,
    });

  it('부분환불(누적 < 전액)은 원장 무조정 — reversePointsForOrder 미호출', async () => {
    getOrderMock.mockResolvedValue(pointsOrder({ refundedAmount: 0 }));

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 5000, // 잔여 30000 중 일부
      reason: '부분 파손',
    });

    expect(result.ok).toBe(true);
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('부분환불 누적==전액 → REFUNDED 전이 성공 후 사용분/적립분 회수를 위임한다', async () => {
    getOrderMock.mockResolvedValue(pointsOrder({ refundedAmount: 10000 }));

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 20000, // 누적 30000 == totalPrice
      reason: '전량 파손',
    });

    expect(result.status).toBe('REFUNDED');
    expect(transitionToMock).toHaveBeenCalledTimes(1);
    expect(reverseMock).toHaveBeenCalledTimes(1);
    expect(reverseMock).toHaveBeenCalledWith(
      asBrand<OrderId>('order-id-1'),
      asBrand<UserId>('user-1'),
      { redeemed: 5000, accrued: 280 },
    );
  });

  it('전액 도달이라도 REFUNDED 전이가 불가한 상태(IN_PRODUCTION)면 회수하지 않는다', async () => {
    getOrderMock.mockResolvedValue(
      pointsOrder({ status: 'IN_PRODUCTION', refundedAmount: 0 }),
    );

    const result = await refundOrderAction('order-id-1', {
      cancelAmount: 30000,
      reason: '전량 파손',
    });

    expect(result.ok).toBe(true);
    // 정책: 전이 "성공 후"에만 원장 정합.
    expect(transitionToMock).not.toHaveBeenCalled();
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('전액환불(fullRefund)도 REFUNDED 전이 후 회수를 위임한다', async () => {
    getOrderMock.mockResolvedValue(pointsOrder());

    const result = await refundOrderAction('order-id-1', { reason: '단순 변심' });

    expect(result.ok).toBe(true);
    expect(reverseMock).toHaveBeenCalledWith(
      asBrand<OrderId>('order-id-1'),
      asBrand<UserId>('user-1'),
      { redeemed: 5000, accrued: 280 },
    );
  });

  it('게스트 주문(userId null)은 포인트 개념이 없어 회수를 시도하지 않는다', async () => {
    getOrderMock.mockResolvedValue(
      makeOrder({ pointsRedeemed: 0, pointsAccrued: 0 }),
    );

    const result = await refundOrderAction('order-id-1', { reason: '단순 변심' });

    expect(result.ok).toBe(true);
    expect(reverseMock).not.toHaveBeenCalled();
  });
});

describe('관리자 취소(cancelOrderAction) — 적립금 원장 정합 위임(FS-EC P1-1 후속)', () => {
  const pointsOrder = (overrides: Partial<OrderWithItems> = {}): OrderWithItems =>
    makeOrder({
      userId: asBrand<UserId>('user-1'),
      pointsRedeemed: 5000,
      pointsAccrued: 280,
      ...overrides,
    });

  it('CANCELLED 전이 성공 후 사용분/적립분 회수를 위임한다', async () => {
    getOrderMock.mockResolvedValue(pointsOrder());

    const result = await cancelOrderAction('order-id-1', '재고 문제');

    expect(result.ok).toBe(true);
    // Toss 환불 → CANCELLED 전이 → 그 후에만 원장 정합.
    expect(transitionToMock).toHaveBeenCalledWith(
      asBrand<OrderId>('order-id-1'),
      'CANCELLED',
      { reason: '재고 문제' },
    );
    expect(reverseMock).toHaveBeenCalledTimes(1);
    expect(reverseMock).toHaveBeenCalledWith(
      asBrand<OrderId>('order-id-1'),
      asBrand<UserId>('user-1'),
      { redeemed: 5000, accrued: 280 },
    );
  });

  it('전이 실패 시 회수를 호출하지 않는다(전이 성공 후에만 정합)', async () => {
    getOrderMock.mockResolvedValue(pointsOrder());
    transitionToMock.mockRejectedValueOnce(
      new Error('Invalid transition: SHIPPED → CANCELLED'),
    );

    const result = await cancelOrderAction('order-id-1', '재고 문제');

    expect(result.ok).toBe(false);
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('Toss 환불 실패 시 전이 전에 중단 — 회수도 호출하지 않는다', async () => {
    getOrderMock.mockResolvedValue(pointsOrder());
    cancelMock.mockRejectedValueOnce(new Error('PG down'));

    const result = await cancelOrderAction('order-id-1', '재고 문제');

    expect(result.ok).toBe(false);
    expect(transitionToMock).not.toHaveBeenCalled();
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('게스트 주문(userId null)·포인트 없는 주문은 회수를 시도하지 않는다', async () => {
    getOrderMock.mockResolvedValue(
      makeOrder({ pointsRedeemed: 0, pointsAccrued: 0 }),
    );

    const result = await cancelOrderAction('order-id-1', '재고 문제');

    expect(result.ok).toBe(true);
    expect(reverseMock).not.toHaveBeenCalled();
  });
});
