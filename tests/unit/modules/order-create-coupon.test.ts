/**
 * createOrder — 쿠폰 통합 금전 경로 테스트 (FS-X-01, ADR-026 + FS-X-FIX-A P1-2).
 *
 * 체인 계약(수정 후): fee-mismatch → probe → validate(read-only) → 할인 확정 →
 * redeem 검증(쿠폰 반영 payable 기준) → redeem RPC → INSERT(coupon_code/
 * coupon_discount conditional-spread) → 실패 보상은 redeem 환급뿐.
 * 핵심 변경: 쿠폰 **소비(consume)는 createOrder 가 하지 않는다** — 결제 확정(PAID)
 * 시점(confirmPayment)으로 이동했다(payment-confirm.test 가 검증). createOrder 는
 * 검증 + 스냅샷 예약만 하므로, 실패 보상에 쿠폰 release 도 없다. 여기서는 그
 * "예약만" 계약(consume/release 미실행 + 스냅샷·금액)을 고정한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/types/cart';
import type { CouponValidationResult } from '@/types/coupon';
import type { CreateOrderInput } from '@/types/order';
import { asBrand } from '@/types/common';
import type {
  CouponId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from '@/types/common';

// ---------- shared call log (순서 검증용) ----------

const callLog: string[] = [];

// ---------- fake supabase (order-create-ec 미러) ----------

type PointsTxCall = {
  p_user_id: string;
  p_order_id: string | null;
  p_type: string;
  p_delta: number;
  p_description: string;
};

const state = {
  pointsBalance: 10_000,
  orderInsertFails: false,
  orderItemsInsertFails: false,
  redeemRpcFails: false,
  pointsTxCalls: [] as PointsTxCall[],
  insertedOrder: undefined as Record<string, unknown> | undefined,
  /** migration 045 `uniq_orders_active_coupon_per_user` 적용 여부(페이크 INSERT 가 재현). */
  activeCouponIndex: true,
};

/** 페이크 orders 테이블 — 대체(supersede) CAS·getOrder·045 인덱스 판정이 같은 행을 본다. */
type FakeOrderRow = Record<string, unknown> & {
  id: string;
  order_no: string;
  user_id: string | null;
  status: string;
  coupon_code: string | null;
};
let ordersDb: FakeOrderRow[] = [];

const TERMINAL_STATUSES = ['CANCELLED', 'REFUNDED'];

function makeFilterBuilder<T>(run: (filters: Record<string, unknown>) => T) {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(col: string, val: unknown) {
      filters[col] = val;
      return builder;
    },
    run: () => run(filters),
  };
  return builder;
}

function matchOrder(o: FakeOrderRow, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([k, v]) => o[k] === v);
}

const VARIANT_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const PHOTO_ID = '33333333-3333-3333-3333-333333333333';
const OWNED_PHOTO_URL = 'https://example.supabase.co/photo.jpg';

function makeChain(table: string) {
  if (table === 'product_variants') {
    return {
      select: () => ({
        in: () =>
          Promise.resolve({
            data: [
              {
                id: VARIANT_ID,
                is_active: true,
                price: 30_000,
                product_id: PRODUCT_ID,
                size_label: 'A4',
                color_label: 'Black',
                color_code: 'BLACK',
                products: { name: 'Frame A' },
              },
            ],
            error: null,
          }),
      }),
    };
  }
  if (table === 'orders') {
    return {
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            if (state.orderInsertFails) {
              return Promise.resolve({
                data: null,
                error: { message: 'orders insert failed (simulated)' },
              });
            }
            const couponCode = (row.coupon_code as string | undefined) ?? null;
            const userId = (row.user_id as string | null | undefined) ?? null;
            if (
              state.activeCouponIndex &&
              userId != null &&
              couponCode != null &&
              ordersDb.some(
                (o) =>
                  o.user_id === userId &&
                  o.coupon_code === couponCode &&
                  !TERMINAL_STATUSES.includes(o.status),
              )
            ) {
              return Promise.resolve({
                data: null,
                error: {
                  code: '23505',
                  message:
                    'duplicate key value violates unique constraint "uniq_orders_active_coupon_per_user"',
                },
              });
            }
            state.insertedOrder = row;
            const stored: FakeOrderRow = {
              id: `order-uuid-${ordersDb.length + 1}`,
              order_no: row.order_no as string,
              user_id: userId,
              status: 'CREATED',
              total_price: row.total_price,
              shipping_fee: row.shipping_fee,
              shipping_method: row.shipping_method,
              payment_id: null,
              tracking_number: null,
              courier: null,
              orderer: row.orderer,
              shipping: row.shipping,
              created_at: new Date().toISOString(),
              paid_at: null,
              shipped_at: null,
              coupon_code: couponCode,
              coupon_discount: (row.coupon_discount as number | undefined) ?? 0,
              points_redeemed: (row.points_redeemed as number | undefined) ?? 0,
            };
            ordersDb.push(stored);
            return Promise.resolve({ data: { ...stored }, error: null });
          },
        }),
      }),
      // transitionIfStatus CAS: .update(patch).eq('id').eq('status', from).select('id')
      update: (patch: Record<string, unknown>) => {
        const b = makeFilterBuilder((filters) => {
          const matched = ordersDb.filter((o) => matchOrder(o, filters));
          for (const o of matched) Object.assign(o, patch);
          return { data: matched.map((o) => ({ id: o.id })), error: null };
        });
        return {
          eq(col: string, val: unknown) {
            b.eq(col, val);
            return this;
          },
          select: () => Promise.resolve(b.run()),
        };
      },
      // getOrder: .select('*').eq(column, value).maybeSingle()
      select: () => {
        const b = makeFilterBuilder((filters) => {
          const found = ordersDb.find((o) => matchOrder(o, filters));
          return { data: found ? { ...found } : null, error: null };
        });
        return {
          eq(col: string, val: unknown) {
            b.eq(col, val);
            return this;
          },
          maybeSingle: () => Promise.resolve(b.run()),
        };
      },
    };
  }
  if (table === 'user_points_ledger') {
    // reversePointsForOrder 멱등 조회 — 기존 원장 없음.
    const chain = {
      select: () => chain,
      eq: () => chain,
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  }
  if (table === 'order_items') {
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
      insert: () =>
        Promise.resolve({
          error: state.orderItemsInsertFails
            ? { message: 'order_items insert failed (simulated)' }
            : null,
        }),
    };
  }
  if (table === 'frame_assets') {
    return {
      select: () => ({
        in: () =>
          Promise.resolve({
            data: [{ id: 'frame-uuid-1', product_id: PRODUCT_ID, color_code: 'BLACK' }],
            error: null,
          }),
      }),
    };
  }
  if (table === 'photos') {
    return {
      select: () => ({
        in: () =>
          Promise.resolve({
            data: [{ original_url: OWNED_PHOTO_URL, user_id: 'user-1', session_id: null }],
            error: null,
          }),
      }),
    };
  }
  if (table === 'user_profiles') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { points_balance: state.pointsBalance }, error: null }),
        }),
      }),
    };
  }
  throw new Error(`Unmocked table: ${table}`);
}

let orderNoSeq = 0;

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => makeChain(table),
    rpc: async (fn: string, args: unknown) => {
      if (fn === 'next_order_no') {
        orderNoSeq += 1;
        return { data: orderNoSeq, error: null };
      }
      if (fn === 'apply_points_transaction') {
        const call = args as PointsTxCall;
        state.pointsTxCalls.push(call);
        if (call.p_type === 'REDEMPTION' && state.redeemRpcFails) {
          return {
            data: null,
            error: { message: 'user_profiles_points_balance_check violated' },
          };
        }
        callLog.push(call.p_type === 'REDEMPTION' ? 'redeem' : 'refund');
        state.pointsBalance += call.p_delta;
        return { data: state.pointsBalance, error: null };
      }
      return { data: null, error: { message: `unmocked rpc ${fn}` } };
    },
  }),
}));

// ---------- probe / coupons / shipping mocks ----------

const probes = { coupons: true };
let couponProbeCalls = 0;

vi.mock('@/lib/db/feature-probe', () => ({
  isPointsAvailable: async () => true,
  isSurchargeAvailable: async () => true,
  isReceiptAvailable: async () => true,
  isPartialRefundAvailable: async () => true,
  isConfirmAvailable: async () => true,
  isProjectCartAvailable: async () => true,
  isCouponsAvailable: async () => {
    couponProbeCalls += 1;
    return probes.coupons;
  },
}));

type ValidResult = Extract<CouponValidationResult, { valid: true }>;

const COUPON_ID = asBrand<CouponId>('coupon-uuid-1');

const couponState = {
  validateResult: null as CouponValidationResult | null,
  validateCalls: [] as Array<{ code: string; subtotal: number; payable: number; userId: string | null }>,
  // FS-X-FIX-A P1-2: createOrder must NOT consume the coupon; it also must NOT run
  // any coupon compensation. releaseCouponByOrder belongs to the cancel/refund path
  // (customerCancelOrder / admin actions), never to createOrder. Tracking calls here
  // lets us assert createOrder leaves the coupon untouched (reserve-only).
  releaseCalls: [] as Array<{ code: string; userId: string | null }>,
  listCalls: [] as Array<{ userId: string; code: string }>,
};

vi.mock('@/lib/db/coupons', () => ({
  validateCoupon: async (
    code: string,
    subtotal: number,
    payable: number,
    userId: UserId | null,
  ) => {
    couponState.validateCalls.push({
      code,
      subtotal,
      payable,
      userId: userId as string | null,
    });
    return couponState.validateResult;
  },
  releaseCouponByOrder: async (code: string, userId: UserId | null) => {
    couponState.releaseCalls.push({ code, userId: userId as string | null });
    callLog.push('release');
  },
  // 보안 검토 P1-3: createOrder 의 미결제 주문 대체가 진행 중 주문을 조회한다.
  listActiveCouponOrders: async (userId: UserId, code: string) => {
    couponState.listCalls.push({ userId: userId as string, code });
    return {
      data: ordersDb
        .filter(
          (o) =>
            o.user_id === (userId as string) &&
            o.coupon_code === code.trim().toUpperCase() &&
            !TERMINAL_STATUSES.includes(o.status),
        )
        .map((o) => ({ id: o.id, orderNo: o.order_no, status: o.status })),
      error: null,
    };
  },
}));

vi.mock('@/lib/db/shipping', () => ({
  getShippingMethods: async () => [
    {
      id: 'sm-1',
      code: 'STANDARD',
      label: '일반배송',
      fee: 3000,
      freeThreshold: 50_000,
      note: null,
      isActive: true,
      sortOrder: 1,
      surchargeFeeJeju: 4000,
      surchargeFeeRemote: 6000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
}));

async function importCreateOrder() {
  const mod = await import('@/lib/db/order');
  return mod.createOrder;
}

// ---------- fixtures ----------

function validCoupon(discount: number): ValidResult {
  return {
    valid: true,
    couponId: COUPON_ID,
    code: 'WELCOME5',
    type: 'fixed',
    value: discount,
    discount,
  };
}

function makeCartItem(): CartItem {
  return {
    localId: asBrand<LocalId>('44444444-4444-4444-4444-444444444444'),
    userId: null,
    productId: asBrand<ProductId>(PRODUCT_ID),
    variantId: asBrand<ProductVariantId>(VARIANT_ID),
    photoId: asBrand<PhotoId>(PHOTO_ID),
    options: { sizeCode: 'A4', colorCode: 'BLACK', matteCode: 'none', paperCode: 'glossy' },
    photoUrl: OWNED_PHOTO_URL,
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    previewUrl: 'https://example.com/preview.jpg',
    price: 30_000,
    quantity: 1,
    createdAt: new Date().toISOString(),
  };
}

/** Baseline: subtotal 30000 + STANDARD fee 3000 = payable 33000 (mainland). */
function makeInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    cartItems: [makeCartItem()],
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'a@b.com' },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '12345',
      addr1: '서울시 강남구',
      addr2: '',
      memo: '',
    },
    shippingMethod: 'STANDARD',
    clientShippingFee: 3000,
    userId: asBrand<UserId>('user-1'),
    ...overrides,
  };
}

beforeEach(() => {
  callLog.length = 0;
  state.pointsBalance = 10_000;
  state.orderInsertFails = false;
  state.orderItemsInsertFails = false;
  state.redeemRpcFails = false;
  state.pointsTxCalls = [];
  state.insertedOrder = undefined;
  state.activeCouponIndex = true;
  ordersDb = [];
  probes.coupons = true;
  couponProbeCalls = 0;
  couponState.validateResult = validCoupon(5000);
  couponState.validateCalls = [];
  couponState.releaseCalls = [];
  couponState.listCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- 정상 경로 ----------

describe('createOrder — 쿠폰 정상 경로 (예약만, FS-X-FIX-A P1-2)', () => {
  it('쿠폰 단독: net totalPrice + 스냅샷 예약, consume/release 는 하지 않는다', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(makeInput({ couponCode: ' welcome5 ' }));

    // 30000 + 3000 − 5000 (031 계약: confirm.ts 가 이 값과 amount 를 비교).
    expect(order.totalPrice).toBe(28_000);
    expect(state.insertedOrder?.total_price).toBe(28_000);
    expect(state.insertedOrder?.coupon_code).toBe('WELCOME5');
    expect(state.insertedOrder?.coupon_discount).toBe(5000);

    // validate 는 서버 권위 값(subtotal/payable)으로 호출된다.
    expect(couponState.validateCalls).toEqual([
      { code: 'welcome5', subtotal: 30_000, payable: 33_000, userId: 'user-1' },
    ]);
    // 소비/보상은 createOrder 의 책임이 아니다 — 소비는 confirm(PAID)로 이동.
    expect(couponState.releaseCalls).toHaveLength(0);
    expect(callLog).toEqual([]);
  });

  it('쿠폰 + redeem 병행: redeem RPC 만 실행, totalPrice 는 둘 다 차감', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(
      makeInput({ couponCode: 'WELCOME5', redeemPoints: 3000 }),
    );

    // 30000 + 3000 − 5000(쿠폰) − 3000(적립금)
    expect(order.totalPrice).toBe(25_000);
    expect(state.insertedOrder?.coupon_discount).toBe(5000);
    expect(state.insertedOrder?.points_redeemed).toBe(3000);
    // consume 없음 — redeem 만 움직인다.
    expect(callLog).toEqual(['redeem']);
    expect(couponState.releaseCalls).toHaveLength(0);
  });

  it('redeem 상한은 쿠폰 반영 payable 기준으로 재계산된다 (ADR-026 §3)', async () => {
    const createOrder = await importCreateOrder();
    state.pointsBalance = 100_000;
    // payable 33000 − 쿠폰 5000 = 28000 → maxRedeemable 27900. 쿠폰이 없었다면
    // 상한 32900 으로 통과했을 요청이 쿠폰 반영 후에는 거부돼야 한다.
    const promise = createOrder(
      makeInput({ couponCode: 'WELCOME5', redeemPoints: 28_000 }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'POINTS_INSUFFICIENT' });
    // 돈이 움직이기 전에 거부 — redeem 미실행.
    expect(state.pointsTxCalls).toHaveLength(0);
    expect(state.insertedOrder).toBeUndefined();
  });
});

// ---------- 거부 경로 ----------

describe('createOrder — 쿠폰 거부 경로', () => {
  it('probe false(042 미적용)면 couponCode 요청을 COUPON_INVALID 로 거부한다', async () => {
    const createOrder = await importCreateOrder();
    probes.coupons = false;
    const promise = createOrder(makeInput({ couponCode: 'WELCOME5' }));
    await expect(promise).rejects.toMatchObject({ code: 'COUPON_INVALID' });
    expect(couponState.validateCalls).toHaveLength(0);
    expect(state.insertedOrder).toBeUndefined();
  });

  it('validate 실패 코드가 그대로 전파된다 (COUPON_EXHAUSTED)', async () => {
    const createOrder = await importCreateOrder();
    couponState.validateResult = { valid: false, errorCode: 'COUPON_EXHAUSTED' };
    const promise = createOrder(makeInput({ couponCode: 'WELCOME5' }));
    await expect(promise).rejects.toMatchObject({ code: 'COUPON_EXHAUSTED' });
    expect(state.insertedOrder).toBeUndefined();
  });
});

// ---------- 보상 경로 (쿠폰 미개입) ----------

describe('createOrder — 실패 보상은 redeem 환급뿐 (쿠폰 release 없음)', () => {
  it('redeem RPC 실패 시 쿠폰은 건드리지 않는다 (아직 소비 전)', async () => {
    const createOrder = await importCreateOrder();
    state.redeemRpcFails = true;
    const promise = createOrder(
      makeInput({ couponCode: 'WELCOME5', redeemPoints: 3000 }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'POINTS_INSUFFICIENT' });
    // 쿠폰은 confirm 에서만 소비되므로, createOrder 실패엔 release 할 것이 없다.
    expect(couponState.releaseCalls).toHaveLength(0);
    expect(state.insertedOrder).toBeUndefined();
  });

  it('주문 INSERT 실패 시 redeem 만 환급, 쿠폰 release 없음', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const createOrder = await importCreateOrder();
    state.orderInsertFails = true;

    const promise = createOrder(
      makeInput({ couponCode: 'WELCOME5', redeemPoints: 3000 }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'SEQUENCE_FAILED' });

    // redeem 만 획득했으므로 redeem 만 환급 — consume/release 는 없다.
    expect(callLog).toEqual(['redeem', 'refund']);
    expect(state.pointsBalance).toBe(10_000); // 환급 완료
    expect(couponState.releaseCalls).toHaveLength(0);
    errSpy.mockRestore();
  });

  it('order_items INSERT 실패(죽은 주문)에도 redeem 만 환급된다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const createOrder = await importCreateOrder();
    state.orderItemsInsertFails = true;

    const promise = createOrder(
      makeInput({ couponCode: 'WELCOME5', redeemPoints: 3000 }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'SEQUENCE_FAILED' });
    expect(callLog).toEqual(['redeem', 'refund']);
    expect(state.pointsBalance).toBe(10_000);
    expect(couponState.releaseCalls).toHaveLength(0);
    errSpy.mockRestore();
  });
});

// ---------- 레거시 무파손 ----------

describe('createOrder — 무쿠폰 레거시 회귀 0', () => {
  it('couponCode 미지정이면 쿠폰 경로가 전혀 실행되지 않고 INSERT 컬럼 집합이 불변', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(makeInput());

    expect(order.totalPrice).toBe(33_000);
    expect(couponProbeCalls).toBe(0);
    expect(couponState.validateCalls).toHaveLength(0);
    expect(couponState.releaseCalls).toHaveLength(0);
    // 042 미적용 DB 에서도 성공하는 레거시 컬럼 집합 스냅샷.
    expect(Object.keys(state.insertedOrder ?? {}).sort()).toEqual(
      [
        'order_no',
        'orderer',
        'shipping',
        'shipping_fee',
        'shipping_method',
        'status',
        'total_price',
        'user_id',
      ].sort(),
    );
  });
});

// ---------- 회원·쿠폰별 진행 중 주문 1건 (보안 검토 P1-3) ----------

describe('createOrder — 같은 쿠폰의 진행 중 주문 1건 (보안 검토 P1-3)', () => {
  it('병렬 주문 2건 → 두 번째 거부: 045 인덱스 23505 를 COUPON_ALREADY_USED 로 바꾸고 적립금을 환급한다', async () => {
    const createOrder = await importCreateOrder();

    const results = await Promise.allSettled([
      createOrder(makeInput({ couponCode: 'WELCOME5', redeemPoints: 1000 })),
      createOrder(makeInput({ couponCode: 'WELCOME5', redeemPoints: 1000 })),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'COUPON_ALREADY_USED' });
    // 진행 중 주문은 정확히 1건, 진 요청의 적립금은 환급(10000 − 1000).
    expect(ordersDb.filter((o) => !TERMINAL_STATUSES.includes(o.status))).toHaveLength(1);
    expect(state.pointsBalance).toBe(9000);
  });

  it('재결제(순차 재주문): 같은 쿠폰의 이전 미결제 주문을 CANCELLED 로 대체하고 그 적립금을 복원한다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const createOrder = await importCreateOrder();

    const first = await createOrder(makeInput({ couponCode: 'WELCOME5', redeemPoints: 2000 }));
    expect(state.pointsBalance).toBe(8000);

    // 결제창을 닫고 /checkout 에서 다시 결제 → 새 주문.
    const second = await createOrder(makeInput({ couponCode: 'WELCOME5', redeemPoints: 2000 }));

    expect(ordersDb.find((o) => o.id === (first.id as string))?.status).toBe('CANCELLED');
    expect(ordersDb.find((o) => o.id === (second.id as string))?.status).toBe('CREATED');
    // 이전 주문 사용분 복원(ADJUSTMENT +2000) 후 새 주문이 다시 2000 사용.
    expect(state.pointsTxCalls).toContainEqual(
      expect.objectContaining({ p_type: 'ADJUSTMENT', p_delta: 2000, p_order_id: first.id }),
    );
    expect(state.pointsBalance).toBe(8000);
    expect(couponState.listCalls).toEqual([
      { userId: 'user-1', code: 'WELCOME5' },
      { userId: 'user-1', code: 'WELCOME5' },
    ]);
    warnSpy.mockRestore();
  });

  it('결제완료 계열 주문은 대체하지 않는다 — 검증 직후 결제된 경합이면 INSERT 가 거부된다', async () => {
    const createOrder = await importCreateOrder();
    ordersDb.push({
      id: 'order-paid',
      order_no: '20261112-0099',
      user_id: 'user-1',
      status: 'PAID',
      coupon_code: 'WELCOME5',
    });

    const promise = createOrder(makeInput({ couponCode: 'WELCOME5' }));

    await expect(promise).rejects.toMatchObject({ code: 'COUPON_ALREADY_USED' });
    expect(ordersDb.find((o) => o.id === 'order-paid')?.status).toBe('PAID');
  });

  it('비회원 주문은 대체 대상 조회를 하지 않는다(전체 한도는 결제 직전 확인이 담당)', async () => {
    const createOrder = await importCreateOrder();
    // 사진 소유권 검사는 이 테스트 관심사가 아니다 — photoUrl 없는 라인으로 건너뛴다.
    const order = await createOrder(
      makeInput({
        couponCode: 'WELCOME5',
        userId: null,
        cartItems: [{ ...makeCartItem(), photoUrl: '' }],
      }),
    );
    expect(order.totalPrice).toBe(28_000);
    expect(couponState.listCalls).toHaveLength(0);
  });
});
