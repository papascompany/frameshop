/**
 * createOrder unit tests — P0-01 regression guard.
 *
 * Verifies the server refuses to honor a tampered `cartItems[].price` and
 * snapshot fields are filled from authoritative DB values.
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

type VariantRow = {
  id: string;
  is_active: boolean;
  price: number;
  product_id: string;
  size_label: string;
  color_label: string;
  color_code: string;
  products: { name: string };
};

type PhotoRow = { original_url: string; user_id: string | null; session_id: string | null };

type FakeState = {
  variants: VariantRow[];
  frameAssets: Array<{ id: string; product_id: string; color_code: string }>;
  photos: PhotoRow[];
  insertedOrder?: Record<string, unknown>;
  insertedItems?: Array<Record<string, unknown>>;
};

const state: FakeState = { variants: [], frameAssets: [], photos: [] };

function makeChain(table: string) {
  // Minimal Supabase query-builder mock — supports the exact call shapes
  // used by createOrder + generateOrderNo.
  if (table === 'product_variants') {
    return {
      select: () => ({
        in: (_col: string, _ids: string[]) =>
          Promise.resolve({ data: state.variants, error: null }),
      }),
    };
  }
  if (table === 'order_sequences') {
    // No longer accessed directly — generateOrderNo now calls rpc('next_order_no').
    // Kept for any legacy test using direct table access.
    throw new Error('order_sequences accessed directly; generateOrderNo should use rpc');
  }
  if (table === 'orders') {
    return {
      insert: (row: Record<string, unknown>) => {
        state.insertedOrder = row;
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
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
                  created_at: new Date().toISOString(),
                  paid_at: null,
                  shipped_at: null,
                },
                error: null,
              }),
          }),
        };
      },
    };
  }
  if (table === 'order_items') {
    return {
      insert: (rows: Array<Record<string, unknown>>) => {
        state.insertedItems = rows;
        return Promise.resolve({ error: null });
      },
    };
  }
  if (table === 'frame_assets') {
    return {
      select: () => ({
        in: (_col: string, _ids: string[]) =>
          Promise.resolve({
            data: state.frameAssets,
            error: null,
          }),
      }),
    };
  }
  if (table === 'photos') {
    return {
      select: (_cols: string) => ({
        in: (_col: string, urls: string[]) =>
          Promise.resolve({
            data: state.photos.filter((p) => urls.includes(p.original_url)),
            error: null,
          }),
      }),
    };
  }
  if (table === 'shipping_methods') {
    return {
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: 'sm-1',
                  code: 'STANDARD',
                  label: '일반배송',
                  fee: 3000,
                  free_threshold: 50000,
                  note: null,
                  is_active: true,
                  sort_order: 1,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ],
              error: null,
            }),
        }),
      }),
    };
  }
  throw new Error(`Unmocked table: ${table}`);
}

let rpcCallCount = 0;

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => makeChain(table),
    rpc: async (fn: string, _args: unknown) => {
      if (fn === 'next_order_no') {
        rpcCallCount += 1;
        return { data: rpcCallCount, error: null };
      }
      return { data: null, error: { message: `unmocked rpc ${fn}` } };
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: (table: string) => makeChain(table),
  }),
}));

// `getShippingMethods` is wrapped in `unstable_cache`, which requires Next's
// incremental-cache request context that vitest does not provide (it throws
// "Invariant: incrementalCache missing"). Mock the db module directly so the
// createOrder unit test exercises fee logic without the cache machinery.
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
}));

// Dynamic import after mocks are registered.
async function importCreateOrder() {
  const mod = await import('@/lib/db/order');
  return mod.createOrder;
}

// ---------- Fixtures ----------

const VARIANT_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const PHOTO_ID = '33333333-3333-3333-3333-333333333333';

function makeCartItem(price: number, photoUrl = OWNED_PHOTO_URL): CartItem {
  return {
    localId: asBrand<LocalId>('44444444-4444-4444-4444-444444444444'),
    userId: null,
    productId: asBrand<ProductId>(PRODUCT_ID),
    variantId: asBrand<ProductVariantId>(VARIANT_ID),
    photoId: asBrand<PhotoId>(PHOTO_ID),
    options: { sizeCode: 'A4', colorCode: 'BLACK', matteCode: 'none', paperCode: 'glossy' },
    photoUrl,
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    previewUrl: 'https://example.com/preview.jpg',
    price,
    quantity: 1,
    createdAt: new Date().toISOString(),
  };
}

function makeInput(price: number): CreateOrderInput {
  return {
    cartItems: [makeCartItem(price)],
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
  };
}

const OWNED_PHOTO_URL = 'https://example.supabase.co/photo.jpg';

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
  // Default: one photo owned by user-1 (P0-03 ownership checks).
  state.photos = [
    { original_url: OWNED_PHOTO_URL, user_id: 'user-1', session_id: null },
  ];
  delete state.insertedOrder;
  delete state.insertedItems;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- Tests ----------

describe('createOrder — P0-01 (price tampering)', () => {
  it('throws PRICE_MISMATCH when client price disagrees with DB', async () => {
    const createOrder = await importCreateOrder();
    // Client sends `price: 1` while DB says 30000.
    await expect(createOrder(makeInput(1))).rejects.toMatchObject({
      code: 'PRICE_MISMATCH',
    });
    await expect(createOrder(makeInput(1))).rejects.toBeInstanceOf(
      CreateOrderError,
    );
  });

  it('accepts when client price matches DB', async () => {
    const createOrder = await importCreateOrder();
    const order = await createOrder(makeInput(30000));
    // total = 30000 (subtotal from DB) + 3000 shipping
    expect(order.totalPrice).toBe(33000);
    expect(state.insertedOrder?.total_price).toBe(33000);
  });

  it('fills OrderItemSnapshot from DB columns, not client', async () => {
    const createOrder = await importCreateOrder();
    await createOrder(makeInput(30000));
    expect(state.insertedItems).toHaveLength(1);
    const snapshot = state.insertedItems?.[0]?.variant_snapshot as {
      productName: string;
      sizeLabel: string;
      colorLabel: string;
      unitPrice: number;
    };
    expect(snapshot.productName).toBe('Frame A');
    expect(snapshot.sizeLabel).toBe('A4');
    expect(snapshot.colorLabel).toBe('Black');
    expect(snapshot.unitPrice).toBe(30000);
    // The order_items.price column is also the DB value, not the client's.
    expect(state.insertedItems?.[0]?.price).toBe(30000);
  });

  it('freezes sourcePhotoId from the cart item (선결과제 1)', async () => {
    const createOrder = await importCreateOrder();
    await createOrder(makeInput(30000));
    const snapshot = state.insertedItems?.[0]?.variant_snapshot as {
      sourcePhotoId?: string;
      bleedMm?: number;
    };
    // The cart line's photoId (the ORIGINAL photo) is frozen into the snapshot so
    // reorder/re-edit can reconstruct the line; photo_url stays the baked crop.
    expect(snapshot.sourcePhotoId).toBe(PHOTO_ID);
    expect(state.insertedItems?.[0]?.photo_url).toBe(OWNED_PHOTO_URL);
  });
});

describe('createOrder — P0-03 (photo ownership)', () => {
  it('throws PHOTO_OWNERSHIP when photo belongs to a different user', async () => {
    const createOrder = await importCreateOrder();
    // Photo URL exists in DB but is owned by user-2, not user-1.
    const foreignUrl = 'https://example.supabase.co/other-user-photo.jpg';
    state.photos = [
      { original_url: foreignUrl, user_id: 'user-2', session_id: null },
    ];
    const input = { ...makeInput(30000), cartItems: [makeCartItem(30000, foreignUrl)] };
    await expect(createOrder(input)).rejects.toMatchObject({ code: 'PHOTO_OWNERSHIP' });
    await expect(createOrder(input)).rejects.toBeInstanceOf(CreateOrderError);
    // Order must NOT have been written to DB.
    expect(state.insertedOrder).toBeUndefined();
  });

  it('throws PHOTO_OWNERSHIP when photo is not in photos table at all', async () => {
    const createOrder = await importCreateOrder();
    state.photos = []; // empty — no photos in DB
    const input = { ...makeInput(30000), cartItems: [makeCartItem(30000, 'https://example.supabase.co/unknown.jpg')] };
    await expect(createOrder(input)).rejects.toMatchObject({ code: 'PHOTO_OWNERSHIP' });
  });

  it('accepts when photo is owned by the calling user', async () => {
    const createOrder = await importCreateOrder();
    // Default state.photos has OWNED_PHOTO_URL → user-1, and input has userId: 'user-1'.
    const order = await createOrder(makeInput(30000));
    expect(order.totalPrice).toBe(33000);
    expect(state.insertedItems?.[0]?.photo_url).toBe(OWNED_PHOTO_URL);
  });

  it('accepts anonymous photo when session_id matches', async () => {
    const createOrder = await importCreateOrder();
    const anonUrl = 'https://example.supabase.co/anon-photo.jpg';
    state.photos = [{ original_url: anonUrl, user_id: null, session_id: 'sess-abc' }];
    const input: CreateOrderInput = {
      ...makeInput(30000),
      userId: null,
      sessionId: 'sess-abc',
      cartItems: [makeCartItem(30000, anonUrl)],
    };
    const order = await createOrder(input);
    expect(order.totalPrice).toBe(33000);
  });
});
