/**
 * createOrder — FS-P1-02 확장형 묶음 동결 (ADR-025).
 *
 * Covers: projectId 그룹핑(그룹당 서버 project_group_id 1회 발급), variant_snapshot
 * jsonb 동결(orientation/projectSeq/groupLabel — 035 미적용에서도 보존), 035 적용 시
 * conditional-spread 컬럼 포함(혼재 주문의 단품 행은 NULL 로 균일 키), 미적용 시
 * 컬럼 생략, 그리고 레거시 단품 주문의 INSERT 컬럼 집합 무변경(probe 무호출).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/types/cart';
import type { CreateOrderInput, OrderItemSnapshot } from '@/types/order';
import { asBrand } from '@/types/common';
import type {
  CartProjectId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from '@/types/common';

// ---------- Test doubles ----------

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
  insertedItems?: Array<Record<string, unknown>>;
};

const state: FakeState = {
  variants: [],
  frameAssets: [],
  photos: [],
};

const probes = { projectCart: true };
let projectCartProbeCalls = 0;

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
      }),
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
  throw new Error(`Unmocked table: ${table}`);
}

let orderNoSeq = 0;

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => makeChain(table),
    rpc: async (fn: string) => {
      if (fn === 'next_order_no') {
        orderNoSeq += 1;
        return { data: orderNoSeq, error: null };
      }
      return { data: null, error: { message: `unmocked rpc ${fn}` } };
    },
  }),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isPointsAvailable: async () => true,
  isSurchargeAvailable: async () => true,
  isReceiptAvailable: async () => true,
  isPartialRefundAvailable: async () => true,
  isConfirmAvailable: async () => true,
  isProjectCartAvailable: async () => {
    projectCartProbeCalls += 1;
    return probes.projectCart;
  },
}));

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
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
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
    ...overrides,
  };
}

/** 묶음 A 2줄(혼합 방향) + 묶음 B 1줄 + 단품 1줄 — CTO 케이스 4(혼재) 축약형. */
function makeMixedCartItems(): CartItem[] {
  return [
    makeCartItem({
      projectId: asBrand<CartProjectId>(PROJECT_A),
      projectSeq: 0,
      orientation: 'portrait',
    }),
    makeCartItem({
      projectId: asBrand<CartProjectId>(PROJECT_A),
      projectSeq: 1,
      orientation: 'landscape',
    }),
    makeCartItem({
      projectId: asBrand<CartProjectId>(PROJECT_B),
      projectSeq: 0,
      orientation: 'portrait',
    }),
    makeCartItem(), // 단품 — project 필드 없음
  ];
}

function makeInput(cartItems: CartItem[]): CreateOrderInput {
  return {
    cartItems,
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
    userId: asBrand<UserId>('user-1'),
  };
}

function snapshotOf(row: Record<string, unknown>): OrderItemSnapshot {
  return row.variant_snapshot as OrderItemSnapshot;
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
  delete state.insertedItems;
  probes.projectCart = true;
  projectCartProbeCalls = 0;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------- 그룹핑 + 035 적용(conditional-spread) ----------

describe('createOrder — 확장형 묶음 그룹핑 (ADR-025, 035 적용)', () => {
  it('mints ONE server group id per project and keeps singles NULL (mixed order)', async () => {
    const createOrder = await importCreateOrder();
    await createOrder(makeInput(makeMixedCartItems()));

    const rows = state.insertedItems!;
    expect(rows).toHaveLength(4);

    const [a1, a2, b1, single] = rows;
    // 묶음 A: 두 줄이 같은 server-minted UUID 를 공유한다.
    expect(a1.project_group_id).toMatch(UUID_V4);
    expect(a2.project_group_id).toBe(a1.project_group_id);
    // 묶음 B: A 와 다른 group id.
    expect(b1.project_group_id).toMatch(UUID_V4);
    expect(b1.project_group_id).not.toBe(a1.project_group_id);
    // 서버가 새로 발급 — 클라 로컬 키가 그대로 저장되지 않는다.
    expect(a1.project_group_id).not.toBe(PROJECT_A);
    expect(b1.project_group_id).not.toBe(PROJECT_B);
    // 단품 행: 균일 키 집합(PostgREST 벌크 insert)이되 값은 NULL.
    expect('project_group_id' in single).toBe(true);
    expect(single.project_group_id).toBeNull();
    expect(single.project_seq).toBeNull();
    expect(single.orientation).toBeNull();
    // seq/orientation 컬럼은 카트 라인 값 그대로.
    expect([a1.project_seq, a2.project_seq, b1.project_seq]).toEqual([0, 1, 0]);
    expect([a1.orientation, a2.orientation, b1.orientation]).toEqual([
      'portrait',
      'landscape',
      'portrait',
    ]);
  });

  it('freezes orientation/projectSeq/groupLabel into variant_snapshot; singles stay unmarked', async () => {
    const createOrder = await importCreateOrder();
    await createOrder(makeInput(makeMixedCartItems()));

    const [a1, a2, b1, single] = state.insertedItems!;
    expect(snapshotOf(a1)).toMatchObject({
      groupLabel: '묶음 1',
      projectSeq: 0,
      orientation: 'portrait',
    });
    expect(snapshotOf(a2)).toMatchObject({
      groupLabel: '묶음 1',
      projectSeq: 1,
      orientation: 'landscape',
    });
    expect(snapshotOf(b1)).toMatchObject({ groupLabel: '묶음 2', projectSeq: 0 });
    // 단품 스냅샷엔 묶음 필드 미기록 (ADR-025: 단품/레거시 행엔 없음).
    const singleSnap = snapshotOf(single) as unknown as Record<string, unknown>;
    expect('groupLabel' in singleSnap).toBe(false);
    expect('projectSeq' in singleSnap).toBe(false);
    expect('orientation' in singleSnap).toBe(false);
    // 기존 스냅샷 필드는 그대로 동결된다.
    expect(snapshotOf(a1).unitPrice).toBe(30000);
    expect(snapshotOf(a1).sizeLabel).toBe('A4');
  });

  it('numbers groupLabel by first appearance order in the cart', async () => {
    const createOrder = await importCreateOrder();
    // B 가 먼저 등장 → B = 묶음 1, A = 묶음 2.
    await createOrder(
      makeInput([
        makeCartItem({
          projectId: asBrand<CartProjectId>(PROJECT_B),
          projectSeq: 0,
          orientation: 'landscape',
        }),
        makeCartItem({
          projectId: asBrand<CartProjectId>(PROJECT_A),
          projectSeq: 0,
          orientation: 'portrait',
        }),
      ]),
    );
    const [b1, a1] = state.insertedItems!;
    expect(snapshotOf(b1).groupLabel).toBe('묶음 1');
    expect(snapshotOf(a1).groupLabel).toBe('묶음 2');
  });
});

// ---------- 035 미적용(probe false) ----------

describe('createOrder — 035 미적용 graceful (probe false)', () => {
  it('omits the 035 columns entirely but STILL freezes the snapshot', async () => {
    const createOrder = await importCreateOrder();
    probes.projectCart = false;

    await createOrder(makeInput(makeMixedCartItems()));

    const rows = state.insertedItems!;
    for (const row of rows) {
      // 컬럼 부재 DB 에서 INSERT 가 실패하지 않도록 키 자체가 없어야 한다.
      expect('project_group_id' in row).toBe(false);
      expect('project_seq' in row).toBe(false);
      expect('orientation' in row).toBe(false);
    }
    // 묶음 정보는 jsonb 스냅샷에 보존 — 폴백에서도 유실 0 (ADR-025 계약).
    expect(snapshotOf(rows[0])).toMatchObject({
      groupLabel: '묶음 1',
      projectSeq: 0,
      orientation: 'portrait',
    });
    expect(snapshotOf(rows[2]).groupLabel).toBe('묶음 2');
    expect(projectCartProbeCalls).toBe(1);
  });
});

// ---------- 레거시 단품 회귀 0 ----------

describe('createOrder — 레거시 단품 경로 회귀 0', () => {
  it('keeps the exact legacy order_items INSERT column set and never probes', async () => {
    const createOrder = await importCreateOrder();
    await createOrder(makeInput([makeCartItem()]));

    const rows = state.insertedItems!;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        'order_id',
        'variant_snapshot',
        'photo_url',
        'crop_transform',
        'print_file_url',
        'frame_asset_id',
        'stage_size',
        'quantity',
        'price',
      ].sort(),
    );
    // 단품 전용 주문은 035 probe 를 아예 호출하지 않는다 (현행 경로 문자 그대로).
    expect(projectCartProbeCalls).toBe(0);
    // 스냅샷에도 묶음 필드가 없다.
    const snap = snapshotOf(rows[0]) as unknown as Record<string, unknown>;
    expect('groupLabel' in snap).toBe(false);
    expect('orientation' in snap).toBe(false);
  });
});
