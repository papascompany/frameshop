/**
 * createOrder — FS-EC-02 money-path tests (적립금 redeem · 제주/도서산간
 * surcharge · 현금영수증).
 *
 * Covers the package §4 traps: fail-closed redeem (unavailable/insufficient),
 * compensation refund when the order INSERT fails AFTER the deduction,
 * server-authoritative surcharge (STANDARD only), receipt fail-closed, and the
 * migration-unapplied INSERT shape (no new columns for a default order).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/types/cart';
import type { CreateOrderInput } from '@/types/order';
import { CreateOrderError } from '@/types/order';
import { asBrand } from '@/types/common';
import type {
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from '@/types/common';

// ---------- Test doubles ----------

type PointsTxCall = {
  p_user_id: string;
  p_order_id: string | null;
  p_type: string;
  p_delta: number;
  p_description: string;
};

type FakeState = {
  variants: Array<{
    id: string;
    is_active: boolean;
    price: number;
    product_id: string;
    size_label: string;
    color_label: string;
    color_code: string;
    products: { name: string };
  }>;
  frameAssets: Array<{ id: string; product_id: string; color_code: string }>;
  photos: Array<{ original_url: string; user_id: string | null; session_id: string | null }>;
  pointsBalance: number;
  orderInsertFails: boolean;
  orderItemsInsertFails: boolean;
  redeemRpcFails: boolean;
  pointsTxCalls: PointsTxCall[];
  insertedOrder?: Record<string, unknown>;
  insertedItems?: Array<Record<string, unknown>>;
};

const state: FakeState = {
  variants: [],
  frameAssets: [],
  photos: [],
  pointsBalance: 0,
  orderInsertFails: false,
  orderItemsInsertFails: false,
  redeemRpcFails: false,
  pointsTxCalls: [],
};

const probes = { points: true, surcharge: true, receipt: true };

function makeChain(table: string) {
  if (table === 'product_variants') {
    return {
      select: () => ({
        in: () => Promise.resolve({ data: state.variants, error: null }),
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
            state.insertedOrder = row;
            return Promise.resolve({
              data: {
                id: 'order-uuid-1',
                order_no: row.order_no,
                user_id: row.user_id ?? null,
                status: 'CREATED',
                total_price: row.total_price,
                shipping_fee: row.shipping_fee,
                shipping_method: row.shipping_method,
                payment_id: null,
                tracking_number: null,
                courier: null,
                orderer: row.orderer,
                shipping: row.shipping,
                // Echo the conditional-spread columns like a migrated DB would.
                ...(row.points_redeemed != null
                  ? { points_redeemed: row.points_redeemed }
                  : {}),
                ...(row.surcharge_fee != null
                  ? { surcharge_fee: row.surcharge_fee }
                  : {}),
                ...(row.receipt_type != null
                  ? { receipt_type: row.receipt_type, receipt_info: row.receipt_info }
                  : {}),
                created_at: new Date().toISOString(),
                paid_at: null,
                shipped_at: null,
              },
              error: null,
            });
          },
        }),
      }),
    };
  }
  if (table === 'order_items') {
    return {
      insert: (rows: Array<Record<string, unknown>>) => {
        if (state.orderItemsInsertFails) {
          return Promise.resolve({
            error: { message: 'order_items insert failed (simulated)' },
          });
        }
        state.insertedItems = rows;
        return Promise.resolve({ error: null });
      },
    };
  }
  if (table === 'frame_assets') {
    return {
      select: () => ({
        in: () => Promise.resolve({ data: state.frameAssets, error: null }),
      }),
    };
  }
  if (table === 'photos') {
    return {
      select: () => ({
        in: (_col: string, urls: string[]) =>
          Promise.resolve({
            data: state.photos.filter((p) => urls.includes(p.original_url)),
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
            Promise.resolve({
              data: { points_balance: state.pointsBalance },
              error: null,
            }),
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
          // Mirrors the DB CHECK(points_balance >= 0) abort on overdraw.
          return {
            data: null,
            error: { message: 'user_profiles_points_balance_check violated' },
          };
        }
        state.pointsBalance += call.p_delta;
        return { data: state.pointsBalance, error: null };
      }
      return { data: null, error: { message: `unmocked rpc ${fn}` } };
    },
  }),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isPointsAvailable: async () => probes.points,
  isSurchargeAvailable: async () => probes.surcharge,
  isReceiptAvailable: async () => probes.receipt,
  isPartialRefundAvailable: async () => true,
  isConfirmAvailable: async () => true,
}));

// getShippingMethods is wrapped in unstable_cache (needs Next request context)
// — mock the db module. STANDARD carries surcharge config; PICKUP never does.
vi.mock('@/lib/db/shipping', () => ({
  getShippingMethods: async () => [
    {
      id: 'sm-1',
      code: 'STANDARD',
      label: '일반배송',
      fee: 3000,
      freeThreshold: 50000,
      note: null,
      isActive: true,
      sortOrder: 1,
      surchargeFeeJeju: 4000,
      surchargeFeeRemote: 6000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'sm-2',
      code: 'PICKUP',
      label: '방문수령',
      fee: 0,
      freeThreshold: null,
      note: null,
      isActive: true,
      sortOrder: 2,
      surchargeFeeJeju: 0,
      surchargeFeeRemote: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
}));

async function importCreateOrder() {
  const mod = await import('@/lib/db/order');
  return mod.createOrder;
}

// ---------- Fixtures ----------

const VARIANT_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const PHOTO_ID = '33333333-3333-3333-3333-333333333333';
const OWNED_PHOTO_URL = 'https://example.supabase.co/photo.jpg';

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
    price: 30000,
    quantity: 1,
    createdAt: new Date().toISOString(),
  };
}

/** Baseline: subtotal 30000 + STANDARD fee 3000 = 33000 (mainland, no redeem). */
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
  state.variants = [
    {
      id: VARIANT_ID,
      is_active: true,
      price: 30000,
      product_id: PRODUCT_ID,
      size_label: 'A4',
      color_label: 'Black',
      color_code: 'BLACK',
      products: { name: 'Frame A' },
    },
  ];
  state.frameAssets = [
    { id: 'frame-uuid-1', product_id: PRODUCT_ID, color_code: 'BLACK' },
  ];
  state.photos = [
    { original_url: OWNED_PHOTO_URL, user_id: 'user-1', session_id: null },
  ];
  state.pointsBalance = 10_000;
  state.orderInsertFails = false;
  state.orderItemsInsertFails = false;
  state.redeemRpcFails = false;
  state.pointsTxCalls = [];
  delete state.insertedOrder;
  delete state.insertedItems;
  probes.points = true;
  probes.surcharge = true;
  probes.receipt = true;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------- Points: redeem ----------

describe('createOrder — 적립금 redeem (FS-EC-02)', () => {
  it('deducts via REDEMPTION RPC and stores the NET total (031 contract)', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(makeInput({ redeemPoints: 5000 }));

    // total = 30000 + 3000 − 5000 (confirm.ts compares amount to this value).
    expect(order.totalPrice).toBe(28_000);
    expect(state.insertedOrder?.total_price).toBe(28_000);
    // Conditional-spread: snapshot column present because redeem > 0.
    expect(state.insertedOrder?.points_redeemed).toBe(5000);

    const redemption = state.pointsTxCalls.find((c) => c.p_type === 'REDEMPTION');
    expect(redemption).toBeDefined();
    expect(redemption?.p_delta).toBe(-5000);
    // Deducted BEFORE the order INSERT — order id can't exist yet.
    expect(redemption?.p_order_id).toBeNull();
    expect(state.pointsBalance).toBe(5000);
  });

  it('fail-closes with POINTS_UNAVAILABLE when migration 031 is unapplied', async () => {
    const createOrder = await importCreateOrder();
    probes.points = false;
    const promise = createOrder(makeInput({ redeemPoints: 1000 }));
    await expect(promise).rejects.toMatchObject({ code: 'POINTS_UNAVAILABLE' });
    // Fail-closed: NOT an implicit full-price order, and no money moved.
    expect(state.insertedOrder).toBeUndefined();
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('fail-closes with POINTS_UNAVAILABLE for anonymous redeem', async () => {
    const createOrder = await importCreateOrder();
    state.photos = [
      { original_url: OWNED_PHOTO_URL, user_id: null, session_id: 'sess-abc' },
    ];
    const promise = createOrder(
      makeInput({ userId: null, sessionId: 'sess-abc', redeemPoints: 1000 }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'POINTS_UNAVAILABLE' });
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('throws POINTS_INSUFFICIENT when redeem exceeds the balance', async () => {
    const createOrder = await importCreateOrder();
    state.pointsBalance = 1000;
    const promise = createOrder(makeInput({ redeemPoints: 5000 }));
    await expect(promise).rejects.toMatchObject({ code: 'POINTS_INSUFFICIENT' });
    await expect(
      createOrder(makeInput({ redeemPoints: 5000 })),
    ).rejects.toBeInstanceOf(CreateOrderError);
    expect(state.pointsTxCalls).toHaveLength(0);
    expect(state.insertedOrder).toBeUndefined();
  });

  it('throws POINTS_INSUFFICIENT when redeem would drop payment below 100 KRW', async () => {
    const createOrder = await importCreateOrder();
    state.pointsBalance = 100_000;
    // payable = 33000, maxRedeemable = 32900 → full-coverage redeem refused.
    const promise = createOrder(makeInput({ redeemPoints: 33_000 }));
    await expect(promise).rejects.toMatchObject({ code: 'POINTS_INSUFFICIENT' });
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('throws POINTS_INSUFFICIENT when the RPC itself rejects (double-spend race)', async () => {
    const createOrder = await importCreateOrder();
    state.redeemRpcFails = true; // CHECK(points_balance >= 0) abort
    const promise = createOrder(makeInput({ redeemPoints: 5000 }));
    await expect(promise).rejects.toMatchObject({ code: 'POINTS_INSUFFICIENT' });
    expect(state.insertedOrder).toBeUndefined();
  });
});

// ---------- Points: compensation ----------

describe('createOrder — redeem 보상 경로 (FS-EC-02)', () => {
  it('refunds the deduction (ADJUSTMENT) when the order INSERT fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const createOrder = await importCreateOrder();
    state.orderInsertFails = true;

    const promise = createOrder(makeInput({ redeemPoints: 5000 }));
    await expect(promise).rejects.toMatchObject({ code: 'SEQUENCE_FAILED' });

    expect(state.pointsTxCalls.map((c) => c.p_type)).toEqual([
      'REDEMPTION',
      'ADJUSTMENT',
    ]);
    const refund = state.pointsTxCalls[1];
    expect(refund.p_delta).toBe(5000);
    expect(refund.p_description).toBe('주문 생성 실패 환급');
    // Balance restored — customer lost nothing.
    expect(state.pointsBalance).toBe(10_000);
    errSpy.mockRestore();
  });

  it('refunds the deduction when the order_items INSERT fails (dead order)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const createOrder = await importCreateOrder();
    state.orderItemsInsertFails = true;

    const promise = createOrder(makeInput({ redeemPoints: 5000 }));
    await expect(promise).rejects.toMatchObject({ code: 'SEQUENCE_FAILED' });

    expect(state.pointsTxCalls.map((c) => c.p_type)).toEqual([
      'REDEMPTION',
      'ADJUSTMENT',
    ]);
    expect(state.pointsBalance).toBe(10_000);
    errSpy.mockRestore();
  });
});

// ---------- Surcharge ----------

describe('createOrder — 제주/도서산간 surcharge (FS-EC-02)', () => {
  it('adds the Jeju fee for STANDARD to a 63xxx zip and snapshots it', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(
      makeInput({
        // FS-EC-01 sends the fee the customer SAW: base 3000 + jeju 4000.
        clientShippingFee: 7000,
        shipping: { ...makeInput().shipping, zip: '63321' },
      }),
    );
    // 30000 + 3000 (base fee) + 4000 (jeju)
    expect(order.totalPrice).toBe(37_000);
    expect(state.insertedOrder?.total_price).toBe(37_000);
    expect(state.insertedOrder?.surcharge_fee).toBe(4000);
    // The stored shipping_fee column stays the BASE fee — surcharge_fee is its
    // own snapshot column (030); only the mismatch CHECK uses the sum.
    expect(state.insertedOrder?.shipping_fee).toBe(3000);
  });

  it('adds the remote-island fee for STANDARD to an Ulleung zip', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(
      makeInput({
        clientShippingFee: 9000, // base 3000 + remote 6000
        shipping: { ...makeInput().shipping, zip: '40200' },
      }),
    );
    expect(order.totalPrice).toBe(39_000);
    expect(state.insertedOrder?.surcharge_fee).toBe(6000);
  });

  it('rejects a clientShippingFee missing the surcharge (SHIPPING_FEE_MISMATCH)', async () => {
    const createOrder = await importCreateOrder();
    const promise = createOrder(
      makeInput({
        clientShippingFee: 3000, // base fee only — disagrees with what we charge
        shipping: { ...makeInput().shipping, zip: '63321' },
      }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'SHIPPING_FEE_MISMATCH' });
    expect(state.insertedOrder).toBeUndefined();
    expect(state.pointsTxCalls).toHaveLength(0); // rejected before money moves
  });

  it('skips the fee comparison when clientShippingFee is undefined', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(
      makeInput({
        clientShippingFee: undefined,
        shipping: { ...makeInput().shipping, zip: '63321' },
      }),
    );
    expect(order.totalPrice).toBe(37_000);
    expect(state.insertedOrder?.surcharge_fee).toBe(4000);
  });

  it('charges no surcharge for mainland and omits the column entirely', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(makeInput()); // zip 12345
    expect(order.totalPrice).toBe(33_000);
    expect(state.insertedOrder && 'surcharge_fee' in state.insertedOrder).toBe(false);
  });

  it('charges no surcharge for PICKUP even with a Jeju zip', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(
      makeInput({
        shippingMethod: 'PICKUP',
        clientShippingFee: 0,
        shipping: { ...makeInput().shipping, zip: '63321' },
      }),
    );
    expect(order.totalPrice).toBe(30_000);
    expect(state.insertedOrder && 'surcharge_fee' in state.insertedOrder).toBe(false);
  });
});

// ---------- Cash receipt ----------

describe('createOrder — 현금영수증 (FS-EC-02)', () => {
  it('fail-closes with RECEIPT_UNAVAILABLE when migration 039 is unapplied', async () => {
    const createOrder = await importCreateOrder();
    probes.receipt = false;
    const promise = createOrder(
      makeInput({ receipt: { type: 'income', info: '010-1234-5678' } }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'RECEIPT_UNAVAILABLE' });
    expect(state.insertedOrder).toBeUndefined();
    // Receipt gate runs BEFORE the points deduction — no compensation needed.
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('rejects a malformed receipt payload (server-side re-validation)', async () => {
    const createOrder = await importCreateOrder();
    const promise = createOrder(
      makeInput({ receipt: { type: 'income', info: 'not-a-number!!' } }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'RECEIPT_UNAVAILABLE' });
    expect(state.insertedOrder).toBeUndefined();
  });

  it('stores receipt_type/receipt_info via conditional-spread when available', async () => {
    const createOrder = await importCreateOrder();
    await createOrder(
      makeInput({ receipt: { type: 'proof', info: '123-45-67890' } }),
    );
    expect(state.insertedOrder?.receipt_type).toBe('proof');
    expect(state.insertedOrder?.receipt_info).toBe('123-45-67890');
  });
});

// ---------- Migration-unapplied / regression ----------

describe('createOrder — 마이그 미적용 + 기존 경로 회귀 0 (FS-EC-02)', () => {
  it('default order (no redeem, mainland, no receipt) writes NO new columns', async () => {
    const createOrder = await importCreateOrder();
    // Simulate a DB with none of 030/031/039 applied.
    probes.points = false;
    probes.surcharge = false;
    probes.receipt = false;

    const order = await createOrder(makeInput());

    // Exact legacy formula: subtotal + shippingFee. No spread keys → the INSERT
    // succeeds even where the columns don't exist.
    expect(order.totalPrice).toBe(33_000);
    expect(state.insertedOrder).toBeDefined();
    const inserted = state.insertedOrder as Record<string, unknown>;
    expect('points_redeemed' in inserted).toBe(false);
    expect('surcharge_fee' in inserted).toBe(false);
    expect('receipt_type' in inserted).toBe(false);
    expect('receipt_info' in inserted).toBe(false);
    expect(state.pointsTxCalls).toHaveLength(0);
  });

  it('keeps the exact legacy INSERT column set for a default order', async () => {
    const createOrder = await importCreateOrder();
    await createOrder(makeInput());
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
