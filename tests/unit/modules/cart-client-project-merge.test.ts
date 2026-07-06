/**
 * getCart 로그인 경로의 묶음 필드 병합 (FS-P1 Final P0-001).
 *
 * probe false(034/035 미적용 — 현 프로덕션) DB 는 평면 items 만 반환하므로,
 * getCart 가 localStorage 미러의 projectId/projectSeq/orientation 을 localId 로
 * 병합해야 체크아웃 → createOrder 의 variant_snapshot 동결(ADR-025 Decision 6)이
 * 성립한다. 고정하는 계약: 병합 성립(서버 값 우선), 교차 기기(미러 부재) 한계,
 * probe true 시 DB 값 우선, 비로그인 경로 회귀 0.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type {
  CartProjectId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from '@/types/common';
import type { CartItem } from '@/types/cart';
import { clearLocalCart, writeLocalCart } from '@/lib/cart/storage';

const authState = { authed: true };

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({
        data: { session: authState.authed ? { user: { id: 'user-1' } } : null },
      }),
    },
  }),
}));

import { getCart, mergeProjectFieldsFromMirror } from '@/lib/cart/client';

// RFC 4122 v4 형식 — 미러는 readLocalCart 의 zod 파싱(uuid 강화)을 통과해야 한다.
const LOCAL_A = asBrand<LocalId>('11111111-1111-4111-8111-111111111111');
const LOCAL_B = asBrand<LocalId>('22222222-2222-4222-8222-222222222222');
const PRODUCT = asBrand<ProductId>('33333333-3333-4333-8333-333333333333');
/** 클라 로컬 그룹 키(projectLocalId) — 담기 시점에 생성된 값. */
const PROJECT_LOCAL = asBrand<CartProjectId>(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
);
/** 서버 cart_projects 헤더 PK — probe true 일 때 DB 가 반환하는 값. */
const HEADER_PK = asBrand<CartProjectId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    localId: LOCAL_A,
    userId: asBrand<UserId>('user-1'),
    productId: PRODUCT,
    variantId: asBrand<ProductVariantId>('v-1'),
    photoId: asBrand<PhotoId>('ph-1'),
    options: {
      sizeCode: '4x6',
      colorCode: 'black',
      matteCode: 'none',
      paperCode: 'glossy',
    },
    photoUrl: 'https://example.com/photo.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    previewUrl: 'https://example.com/preview.png',
    price: 30000,
    quantity: 1,
    createdAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

function stubCartFetch(items: CartItem[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true, items }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  clearLocalCart();
  authState.authed = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearLocalCart();
});

describe('getCart — 로그인 + probe false (평면 DB) 병합', () => {
  it('미러의 묶음 필드를 localId 로 주입하되 가격/수량 등 서버 값이 우선한다', async () => {
    // 담기 시점 미러: A 는 묶음 라인, B 는 단품.
    writeLocalCart([
      makeItem({
        localId: LOCAL_A,
        projectId: PROJECT_LOCAL,
        projectSeq: 0,
        orientation: 'landscape',
        price: 25000, // stale — 서버 값이 이겨야 한다.
        quantity: 1,
      }),
      makeItem({ localId: LOCAL_B }),
    ]);
    // DB(probe false): 같은 라인들이 평면으로 반환된다.
    stubCartFetch([
      makeItem({ localId: LOCAL_A, price: 30000, quantity: 2 }),
      makeItem({ localId: LOCAL_B }),
    ]);

    const items = await getCart();

    expect(items).toHaveLength(2);
    expect(items[0].projectId as string | undefined).toBe(
      PROJECT_LOCAL as string,
    );
    expect(items[0].projectSeq).toBe(0);
    expect(items[0].orientation).toBe('landscape');
    // 서버 값 우선 유지 — 미러의 stale 가격/수량으로 되돌리지 않는다.
    expect(items[0].price).toBe(30000);
    expect(items[0].quantity).toBe(2);
    // 단품 라인은 필드 자체가 생기지 않는다(기존 shape 문자 그대로).
    expect('projectId' in items[1]).toBe(false);
  });

  it('교차 기기(미러 부재): 병합 불가 — 평면 그대로 반환한다(문서화된 한계)', async () => {
    // 다른 기기에서 담아 localStorage 미러가 없는 상황.
    stubCartFetch([makeItem({ localId: LOCAL_A })]);

    const items = await getCart();

    expect(items).toHaveLength(1);
    expect('projectId' in items[0]).toBe(false);
  });

  it('probe true: DB 가 projectId(서버 헤더 PK)를 반환하면 DB 값이 우선한다', async () => {
    // 미러에는 클라 로컬 그룹 키 — 서버 PK 와 다른 값.
    writeLocalCart([
      makeItem({
        localId: LOCAL_A,
        projectId: PROJECT_LOCAL,
        projectSeq: 5,
        orientation: 'landscape',
      }),
    ]);
    stubCartFetch([
      makeItem({
        localId: LOCAL_A,
        projectId: HEADER_PK,
        projectSeq: 1,
        orientation: 'portrait',
      }),
    ]);

    const items = await getCart();

    expect(items[0].projectId as string | undefined).toBe(HEADER_PK as string);
    expect(items[0].projectSeq).toBe(1);
    expect(items[0].orientation).toBe('portrait');
  });

  it('비로그인 경로 회귀 0: fetch 없이 localStorage 를 그대로 반환한다', async () => {
    authState.authed = false;
    const mirror = [makeItem({ projectId: PROJECT_LOCAL, projectSeq: 0 })];
    writeLocalCart(mirror);
    const fetchMock = stubCartFetch([]);

    const items = await getCart();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(items).toHaveLength(1);
    expect(items[0].projectId as string | undefined).toBe(
      PROJECT_LOCAL as string,
    );
  });
});

describe('mergeProjectFieldsFromMirror — 순수 병합 규칙', () => {
  it('미러 항목에 projectId 가 없으면 아무 것도 주입하지 않는다', () => {
    const db = [makeItem({ localId: LOCAL_A })];
    const mirror = [makeItem({ localId: LOCAL_A, projectSeq: 3 })];

    const out = mergeProjectFieldsFromMirror(db, mirror);

    // projectId 없는 미러의 잔여 필드(projectSeq)는 고아가 되므로 주입 금지.
    expect('projectId' in out[0]).toBe(false);
    expect('projectSeq' in out[0]).toBe(false);
  });
});
