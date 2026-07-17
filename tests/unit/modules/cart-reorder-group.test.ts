/**
 * POST /api/cart/reorder — 세트(묶음) 복원 (FS-X-05, ADR-025 §P3).
 *
 * 고정하는 계약:
 *  1. 같은 snapshot.groupLabel 라인들은 하나의 **새 uuid** projectId 를 공유한다
 *     (그룹 간 상이 · 호출마다 새로 발급 — 재주문 간 충돌 없음).
 *  2. projectSeq 는 스냅샷 projectSeq 우선, 없으면 그룹 내 등장 순번(0-based).
 *  3. orientation 은 스냅샷에 있을 때만 전달된다.
 *  4. 단품/레거시(groupLabel 없음)는 현행 평면 복원 그대로 — project 키 자체가
 *     실리지 않는다(회귀 0).
 *  5. 그룹 일부 라인의 원본 사진 소실은 그 라인만 skip — 나머지는 그룹 유지.
 *  6. 복원 항목은 cartItemSchema(projectId uuid 요구)를 통과한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type {
  OrderId,
  OrderItemId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from '@/types/common';
import { cartItemSchema } from '@/types/cart';
import type { OrderItem, OrderItemSnapshot, OrderWithItems } from '@/types/order';

const mockState: {
  user: { id: string } | null;
  order: OrderWithItems | null;
} = {
  user: null,
  order: null,
};

vi.mock('@/lib/security/same-origin', () => ({
  isSameOrigin: () => true,
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRate: async () => ({ ok: true }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockState.user } }),
    },
  }),
}));

vi.mock('@/lib/db/order', () => ({
  getOrder: async () => mockState.order,
}));

vi.mock('@/lib/db/photo', () => ({
  getPhotoIdsByOriginalUrl: async () => new Map<string, PhotoId>(),
}));

import { POST } from '@/app/api/cart/reorder/route';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReorderLine = {
  productId: string;
  variantId: string;
  photoId: string;
  photoUrl: string;
  previewUrl: string;
  cropTransform: { x: number; y: number; scale: number; rotation: number };
  options: OrderItemSnapshot['options'];
  price: number;
  quantity: number;
  userId: null;
  projectId?: string;
  projectSeq?: number;
  orientation?: string;
};

type ReorderResponse = { ok: boolean; items?: ReorderLine[]; skipped?: number };

let seq = 0;

function makeItem(
  snapshotOverrides: Partial<OrderItemSnapshot> = {},
  itemOverrides: Partial<Omit<OrderItem, 'snapshot'>> = {},
): OrderItem {
  seq += 1;
  return {
    id: asBrand<OrderItemId>(`oi-${seq}`),
    orderId: asBrand<OrderId>('order-1'),
    snapshot: {
      productId: asBrand<ProductId>('22222222-2222-4222-8222-222222222222'),
      variantId: asBrand<ProductVariantId>('v-1'),
      productName: '베이직 액자',
      options: {
        sizeCode: '4x6',
        colorCode: 'black',
        matteCode: 'none',
        paperCode: 'glossy',
      },
      sizeLabel: '4x6',
      colorLabel: '블랙',
      unitPrice: 5000,
      sourcePhotoId: asBrand<PhotoId>(`photo-${seq}`),
      ...snapshotOverrides,
    },
    photoUrl: 'https://example.com/baked.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    printFileUrl: null,
    quantity: 1,
    price: 5000,
    ...itemOverrides,
  };
}

function makeOrder(items: OrderItem[]): OrderWithItems {
  return {
    id: asBrand<OrderId>('order-1'),
    orderNo: asBrand<import('@/types/common').OrderNo>('FS-20260717-0001'),
    userId: asBrand<UserId>('user-1'),
    status: 'DELIVERED',
    totalPrice: items.reduce((s, i) => s + i.price * i.quantity, 0),
    shippingFee: 3000,
    shippingMethod: 'STANDARD',
    paymentId: null,
    trackingNumber: null,
    courier: null,
    orderer: { name: '김테스트', phone: '010-1234-5678', email: 't@example.com' },
    shipping: {
      name: '김테스트',
      phone: '010-1234-5678',
      zip: '06236',
      addr1: '서울시',
      addr2: '',
      memo: '',
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    paidAt: null,
    shippedAt: null,
    items,
  };
}

async function call(): Promise<{ status: number; body: ReorderResponse }> {
  const res = await POST(
    new Request('http://localhost/api/cart/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'order-1' }),
    }),
  );
  return { status: res.status, body: (await res.json()) as ReorderResponse };
}

beforeEach(() => {
  mockState.user = { id: 'user-1' };
  mockState.order = null;
});

describe('POST /api/cart/reorder — 세트 복원', () => {
  it('같은 groupLabel 라인들이 하나의 새 uuid projectId 를 공유한다', async () => {
    mockState.order = makeOrder([
      makeItem({ groupLabel: '묶음 1', projectSeq: 0 }),
      makeItem({ groupLabel: '묶음 1', projectSeq: 1 }),
      makeItem({ groupLabel: '묶음 2', projectSeq: 0 }),
    ]);

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const items = body.items!;
    expect(items).toHaveLength(3);

    // 그룹 1: 두 라인이 같은 uuid 공유 — groupLabel 문자열이 아니라 새 uuid.
    expect(items[0].projectId).toBeDefined();
    expect(items[0].projectId).toMatch(UUID_RE);
    expect(items[1].projectId).toBe(items[0].projectId);

    // 그룹 2: 그룹 간에는 서로 다른 uuid.
    expect(items[2].projectId).toMatch(UUID_RE);
    expect(items[2].projectId).not.toBe(items[0].projectId);
  });

  it('호출마다 새 projectId 를 발급한다 (재주문 간 충돌 없음)', async () => {
    mockState.order = makeOrder([
      makeItem({ groupLabel: '묶음 1', projectSeq: 0 }),
    ]);
    const first = await call();
    const second = await call();
    expect(first.body.items![0].projectId).toMatch(UUID_RE);
    expect(second.body.items![0].projectId).toMatch(UUID_RE);
    expect(second.body.items![0].projectId).not.toBe(
      first.body.items![0].projectId,
    );
  });

  it('projectSeq 는 스냅샷 우선, 없으면 그룹 내 등장 순번(0-based) 폴백', async () => {
    mockState.order = makeOrder([
      // 스냅샷 projectSeq 보존(역순으로 저장돼 있어도 그대로).
      makeItem({ groupLabel: '묶음 1', projectSeq: 5 }),
      // 스냅샷에 projectSeq 없음(레거시) → 그룹 내 순번 폴백.
      makeItem({ groupLabel: '묶음 1' }),
      makeItem({ groupLabel: '묶음 1' }),
    ]);

    const { body } = await call();
    const items = body.items!;
    expect(items[0].projectSeq).toBe(5);
    expect(items[1].projectSeq).toBe(1);
    expect(items[2].projectSeq).toBe(2);
  });

  it('orientation 은 스냅샷에 있을 때만 전달된다', async () => {
    mockState.order = makeOrder([
      makeItem({ groupLabel: '묶음 1', projectSeq: 0, orientation: 'landscape' }),
      makeItem({ groupLabel: '묶음 1', projectSeq: 1 }),
    ]);

    const { body } = await call();
    const items = body.items!;
    expect(items[0].orientation).toBe('landscape');
    expect('orientation' in items[1]).toBe(false);
  });

  it('단품/레거시(groupLabel 없음)는 평면 복원 그대로 — project 키 미포함(회귀)', async () => {
    mockState.order = makeOrder([makeItem(), makeItem()]);

    const { body } = await call();
    expect(body.skipped).toBe(0);
    for (const line of body.items!) {
      expect('projectId' in line).toBe(false);
      expect('projectSeq' in line).toBe(false);
      expect('orientation' in line).toBe(false);
    }
  });

  it('그룹 일부 라인 사진 소실 → 그 라인만 skip, 나머지는 그룹 유지', async () => {
    const lost = makeItem({ groupLabel: '묶음 1', projectSeq: 1 });
    delete (lost.snapshot as { sourcePhotoId?: unknown }).sourcePhotoId;
    mockState.order = makeOrder([
      makeItem({ groupLabel: '묶음 1', projectSeq: 0 }),
      lost,
      makeItem({ groupLabel: '묶음 1', projectSeq: 2 }),
    ]);

    const { body } = await call();
    expect(body.skipped).toBe(1);
    const items = body.items!;
    expect(items).toHaveLength(2);
    expect(items[0].projectId).toMatch(UUID_RE);
    expect(items[1].projectId).toBe(items[0].projectId);
    expect(items.map((i) => i.projectSeq)).toEqual([0, 2]);
  });

  it('복원 항목은 cartItemSchema(projectId uuid)를 통과한다', async () => {
    mockState.order = makeOrder([
      makeItem({ groupLabel: '묶음 1', projectSeq: 0, orientation: 'portrait' }),
    ]);

    const { body } = await call();
    const line = body.items![0];
    // 클라이언트 addToCart 가 부여하는 필드만 더해 IO 경계 스키마로 검증.
    const parsed = cartItemSchema.safeParse({
      ...line,
      localId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('타인 주문은 403 (소유자 검증 회귀)', async () => {
    mockState.user = { id: 'attacker' };
    mockState.order = makeOrder([makeItem({ groupLabel: '묶음 1' })]);

    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
  });
});
