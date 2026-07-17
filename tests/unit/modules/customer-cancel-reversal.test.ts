/**
 * customerCancelOrder → reversePointsForOrder 위임 seam (FS-EC P1-1).
 *
 * 정책: CANCELLED 전이 **성공 후**에만 원장 정합(사용분 복원 + 적립분 회수)을
 * fire-and-forget 으로 위임한다. 전이 실패/불가·Toss 환불 실패·포인트 없는
 * 레거시 주문에서는 호출하지 않아야 한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { OrderId, UserId } from '@/types/common';

const state: {
  orderRow: Record<string, unknown>;
  updates: Array<Record<string, unknown>>;
} = {
  orderRow: {},
  updates: [],
};

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.orderRow, error: null }),
              single: async () => ({ data: state.orderRow, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: async () => {
                  state.updates.push(patch);
                  Object.assign(state.orderRow, patch);
                  return { data: state.orderRow, error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === 'order_items') {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      throw new Error(`Unmocked table: ${table}`);
    },
    rpc: async () => ({ data: null, error: { message: 'unmocked rpc' } }),
  }),
}));

vi.mock('@/lib/db/points', () => ({
  accruePointsForOrder: vi.fn(async () => ({ ok: true, accrued: 0 })),
  getPointsSummary: vi.fn(async () => ({ balance: 0, available: false })),
  redeemPoints: vi.fn(async () => ({ ok: true, balance: 0 })),
  refundRedeemedPoints: vi.fn(async () => ({ ok: true, balance: 0 })),
  reversePointsForOrder: vi.fn(async () => ({
    ok: true,
    restored: 0,
    reclaimed: 0,
  })),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isPointsAvailable: vi.fn(async () => true),
  isSurchargeAvailable: vi.fn(async () => true),
  isReceiptAvailable: vi.fn(async () => true),
  isPartialRefundAvailable: vi.fn(async () => true),
  isConfirmAvailable: vi.fn(async () => true),
}));

vi.mock('@/lib/db/shipping', () => ({
  getShippingMethods: vi.fn(async () => []),
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

// FS-X-FIX-A P1-1: cancel/refund restore the coupon usage slot only for orders
// that had been PAID (coupon consumed at PAID). Mocked so this seam test never
// touches the coupons table.
vi.mock('@/lib/db/coupons', () => ({
  releaseCouponByOrder: vi.fn(async () => {}),
  validateCoupon: vi.fn(),
}));

import { customerCancelOrder } from '@/lib/db/order';
import { reversePointsForOrder } from '@/lib/db/points';
import { releaseCouponByOrder } from '@/lib/db/coupons';
import { tossClient } from '@/lib/payment/toss';

const reverseMock = vi.mocked(reversePointsForOrder);
const releaseCouponMock = vi.mocked(releaseCouponByOrder);
const cancelMock = vi.mocked(tossClient.cancel);

const ORDER_ID = asBrand<OrderId>('order-uuid-1');
const USER_ID = asBrand<UserId>('user-1');

function makeOrderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-uuid-1',
    order_no: '20260703-0001',
    user_id: 'user-1',
    status: 'PAID',
    total_price: 28_000,
    shipping_fee: 3000,
    shipping_method: 'STANDARD',
    payment_id: null,
    tracking_number: null,
    courier: null,
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'a@b.com' },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '12345',
      addr1: '서울시',
      addr2: '',
      memo: '',
    },
    points_redeemed: 5000,
    points_accrued: 280,
    created_at: new Date().toISOString(),
    paid_at: new Date().toISOString(),
    shipped_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cancelMock.mockResolvedValue({ status: 'CANCELED' } as never);
  state.orderRow = makeOrderRow();
  state.updates = [];
});

describe('customerCancelOrder — 원장 정합 위임(전이 성공 후)', () => {
  it('CANCELLED 전이 성공 후 스냅샷(points_redeemed/accrued)으로 회수를 위임한다', async () => {
    const result = await customerCancelOrder(ORDER_ID, USER_ID, '단순 변심');

    expect(result).toEqual({ ok: true });
    expect(state.orderRow.status).toBe('CANCELLED');
    expect(reverseMock).toHaveBeenCalledTimes(1);
    expect(reverseMock).toHaveBeenCalledWith(ORDER_ID, USER_ID, {
      redeemed: 5000,
      accrued: 280,
    });
  });

  it('포인트 스냅샷이 없는 레거시 주문(031 미적용 행)은 회수를 시도하지 않는다', async () => {
    state.orderRow = makeOrderRow({
      points_redeemed: undefined,
      points_accrued: undefined,
    });

    const result = await customerCancelOrder(ORDER_ID, USER_ID);

    expect(result).toEqual({ ok: true });
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('취소 불가 상태(SHIPPED)면 전이도 회수도 없다', async () => {
    state.orderRow = makeOrderRow({ status: 'SHIPPED' });

    const result = await customerCancelOrder(ORDER_ID, USER_ID);

    expect(result.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('Toss 환불 실패 시 전이 전에 중단 — 회수도 호출하지 않는다', async () => {
    state.orderRow = makeOrderRow({ payment_id: 'tk_pay_1' });
    cancelMock.mockRejectedValue(new Error('PG down'));

    const result = await customerCancelOrder(ORDER_ID, USER_ID);

    expect(result.ok).toBe(false);
    expect(state.orderRow.status).toBe('PAID');
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('타인 주문은 소유권 거부 — 회수 없음', async () => {
    const result = await customerCancelOrder(
      ORDER_ID,
      asBrand<UserId>('attacker-1'),
    );

    expect(result.ok).toBe(false);
    expect(reverseMock).not.toHaveBeenCalled();
  });
});

describe('customerCancelOrder — 쿠폰 복원 위임 (FS-X-FIX-A P1-1)', () => {
  it('PAID 주문 취소 성공 후 스냅샷 coupon_code 로 복원을 위임한다', async () => {
    state.orderRow = makeOrderRow({ status: 'PAID', coupon_code: 'WELCOME5' });

    const result = await customerCancelOrder(ORDER_ID, USER_ID, '단순 변심');

    expect(result).toEqual({ ok: true });
    expect(state.orderRow.status).toBe('CANCELLED');
    expect(releaseCouponMock).toHaveBeenCalledTimes(1);
    expect(releaseCouponMock).toHaveBeenCalledWith('WELCOME5', USER_ID);
  });

  it('미결제(CREATED) 주문 취소는 쿠폰을 복원하지 않는다 (애초에 소비 전)', async () => {
    // CREATED 는 결제 전 — 쿠폰은 PAID 에서만 소비되므로 되돌릴 것이 없다.
    state.orderRow = makeOrderRow({
      status: 'CREATED',
      payment_id: null,
      coupon_code: 'WELCOME5',
    });

    const result = await customerCancelOrder(ORDER_ID, USER_ID);

    expect(result).toEqual({ ok: true });
    expect(state.orderRow.status).toBe('CANCELLED');
    expect(releaseCouponMock).not.toHaveBeenCalled();
  });

  it('쿠폰 없는 PAID 주문은 복원을 시도하지 않는다', async () => {
    state.orderRow = makeOrderRow({ status: 'PAID' });

    const result = await customerCancelOrder(ORDER_ID, USER_ID);

    expect(result).toEqual({ ok: true });
    expect(releaseCouponMock).not.toHaveBeenCalled();
  });
});
