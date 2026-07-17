/**
 * src/lib/db/wishlists.ts — FS-X-02.
 *
 * 멱등 계약이 핵심: 추가는 UNIQUE 충돌(23505)을 성공으로, 제거는 부재 행도
 * 성공으로 취급한다(하트 토글 더블클릭/재시도 안전). service-role 우회이므로
 * 모든 쿼리의 user_id 스코핑을 검증하고, probe(041 미적용) 시 읽기는 빈 결과,
 * 쓰기는 명시 에러를 확인한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { ProductId, UserId } from '@/types/common';

// ---------- Test doubles ----------

type FakeError = { code?: string; message: string } | null;
type QueryResponse = { data: unknown; error: FakeError };

type CallRecord = {
  op: 'select' | 'insert' | 'delete';
  table: string;
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
};

const state = {
  probe: true,
  selectRows: [] as Array<Record<string, unknown>>,
  selectError: null as FakeError,
  insertError: null as FakeError,
  deleteError: null as FakeError,
  calls: [] as CallRecord[],
};

type SelectBuilder = PromiseLike<QueryResponse> & {
  eq(col: string, val: unknown): SelectBuilder;
  in(col: string, vals: unknown[]): SelectBuilder;
  order(col: string, opts?: { ascending?: boolean }): SelectBuilder;
  limit(n: number): SelectBuilder;
};

function makeSelectBuilder(call: CallRecord): SelectBuilder {
  const builder: SelectBuilder = {
    eq(col, val) {
      call.filters[col] = val;
      return builder;
    },
    in(col, vals) {
      call.filters[col] = vals;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve({
        data: state.selectError ? null : state.selectRows,
        error: state.selectError,
      } satisfies QueryResponse).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

type DeleteBuilder = PromiseLike<{ error: FakeError }> & {
  eq(col: string, val: unknown): DeleteBuilder;
};

function makeDeleteBuilder(call: CallRecord): DeleteBuilder {
  const builder: DeleteBuilder = {
    eq(col, val) {
      call.filters[col] = val;
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve({ error: state.deleteError }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => ({
      select() {
        const call: CallRecord = { op: 'select', table, filters: {} };
        state.calls.push(call);
        return makeSelectBuilder(call);
      },
      insert(payload: Record<string, unknown>) {
        const call: CallRecord = { op: 'insert', table, payload, filters: {} };
        state.calls.push(call);
        return Promise.resolve({ error: state.insertError });
      },
      delete() {
        const call: CallRecord = { op: 'delete', table, filters: {} };
        state.calls.push(call);
        return makeDeleteBuilder(call);
      },
    }),
  }),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isWishlistAvailable: async () => state.probe,
}));

// ---------- Fixtures ----------

const USER_ID = asBrand<UserId>('user-1');
const PRODUCT_A = asBrand<ProductId>('11111111-1111-4111-8111-111111111111');
const PRODUCT_B = asBrand<ProductId>('22222222-2222-4222-8222-222222222222');

beforeEach(() => {
  state.probe = true;
  state.selectRows = [];
  state.selectError = null;
  state.insertError = null;
  state.deleteError = null;
  state.calls = [];
});

// ---------- addToWishlist ----------

describe('addToWishlist — 멱등 추가', () => {
  it('user_id + product_id 로 INSERT 한다(세션 userId 주입)', async () => {
    const { addToWishlist } = await import('@/lib/db/wishlists');

    expect(await addToWishlist(USER_ID, PRODUCT_A)).toEqual({ data: true, error: null });
    const call = state.calls.find((c) => c.op === 'insert');
    expect(call?.payload).toEqual({
      user_id: 'user-1',
      product_id: PRODUCT_A as string,
    });
  });

  it('UNIQUE 충돌(23505)은 성공으로 취급한다 — 더블클릭/재시도 안전', async () => {
    const { addToWishlist } = await import('@/lib/db/wishlists');
    state.insertError = { code: '23505', message: 'duplicate key value' };

    expect(await addToWishlist(USER_ID, PRODUCT_A)).toEqual({ data: true, error: null });
  });

  it('FK 위반(23503, 존재하지 않는 상품)은 REF_NOT_FOUND', async () => {
    const { addToWishlist } = await import('@/lib/db/wishlists');
    state.insertError = { code: '23503', message: 'violates foreign key constraint' };

    const result = await addToWishlist(USER_ID, PRODUCT_A);
    expect(result.error).toBe('REF_NOT_FOUND');
  });

  it('probe false(041 미적용)면 INSERT 없이 명시 에러', async () => {
    const { addToWishlist, WISHLIST_UNAVAILABLE } = await import('@/lib/db/wishlists');
    state.probe = false;

    const result = await addToWishlist(USER_ID, PRODUCT_A);
    expect(result.error).toBe(WISHLIST_UNAVAILABLE);
    expect(state.calls).toHaveLength(0);
  });
});

// ---------- removeFromWishlist ----------

describe('removeFromWishlist — 멱등 제거', () => {
  it('(user_id, product_id) 스코핑 DELETE — 부재 행도 성공', async () => {
    const { removeFromWishlist } = await import('@/lib/db/wishlists');

    expect(await removeFromWishlist(USER_ID, PRODUCT_A)).toEqual({
      data: true,
      error: null,
    });
    const call = state.calls.find((c) => c.op === 'delete');
    expect(call?.filters['user_id']).toBe('user-1');
    expect(call?.filters['product_id']).toBe(PRODUCT_A as string);
  });

  it('DB 에러는 값으로 반환한다', async () => {
    const { removeFromWishlist } = await import('@/lib/db/wishlists');
    state.deleteError = { message: 'delete failed (simulated)' };

    const result = await removeFromWishlist(USER_ID, PRODUCT_A);
    expect(result.data).toBeNull();
    expect(result.error).toContain('delete failed');
  });
});

// ---------- isWishlisted (배치 조회) ----------

describe('isWishlisted — 하트 하이드레이션 배치 조회', () => {
  it('productIds IN 조회로 위시된 부분집합만 돌려준다', async () => {
    const { isWishlisted } = await import('@/lib/db/wishlists');
    state.selectRows = [{ product_id: PRODUCT_A as string }];

    const { data, error } = await isWishlisted(USER_ID, [PRODUCT_A, PRODUCT_B]);
    expect(error).toBeNull();
    expect(data).toEqual([PRODUCT_A]);

    const call = state.calls.find((c) => c.op === 'select');
    expect(call?.filters['user_id']).toBe('user-1');
    expect(call?.filters['product_id']).toEqual([
      PRODUCT_A as string,
      PRODUCT_B as string,
    ]);
  });

  it('빈 입력이면 쿼리 없이 빈 배열', async () => {
    const { isWishlisted } = await import('@/lib/db/wishlists');
    expect(await isWishlisted(USER_ID, [])).toEqual({ data: [], error: null });
    expect(state.calls).toHaveLength(0);
  });

  it('probe false 면 쿼리 없이 빈 배열(하트 전부 꺼짐)', async () => {
    const { isWishlisted } = await import('@/lib/db/wishlists');
    state.probe = false;
    expect(await isWishlisted(USER_ID, [PRODUCT_A])).toEqual({ data: [], error: null });
    expect(state.calls).toHaveLength(0);
  });
});

// ---------- listWishlist ----------

describe('listWishlist — 상품 요약 조인', () => {
  it('products 조인에서 name/basePrice/썸네일을 매핑한다', async () => {
    const { listWishlist } = await import('@/lib/db/wishlists');
    state.selectRows = [
      {
        id: 'w-1',
        product_id: PRODUCT_A as string,
        created_at: '2026-07-17T00:00:00Z',
        products: {
          name: '오크 원목 액자',
          base_price: 28000,
          is_active: true,
          product_images: [
            { image_url: 'https://cdn.example.com/b.jpg', type: 'detail', sort_order: 0 },
            { image_url: 'https://cdn.example.com/a.jpg', type: 'thumbnail', sort_order: 1 },
          ],
        },
      },
    ];

    const { data, error } = await listWishlist(USER_ID);
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      id: 'w-1',
      productId: PRODUCT_A,
      product: {
        name: '오크 원목 액자',
        basePrice: 28000,
        isActive: true,
        thumbnail: 'https://cdn.example.com/a.jpg', // type=thumbnail 만 채택
      },
    });

    const call = state.calls.find((c) => c.op === 'select');
    expect(call?.filters['user_id']).toBe('user-1');
  });

  it('조인 누락 행은 product: null 로 방어한다(throw 금지)', async () => {
    const { listWishlist } = await import('@/lib/db/wishlists');
    state.selectRows = [
      {
        id: 'w-2',
        product_id: PRODUCT_B as string,
        created_at: '2026-07-17T00:00:00Z',
        products: null,
      },
    ];

    const { data } = await listWishlist(USER_ID);
    expect(data?.[0].product).toBeNull();
  });

  it('probe false 면 쿼리 없이 빈 목록', async () => {
    const { listWishlist } = await import('@/lib/db/wishlists');
    state.probe = false;
    expect(await listWishlist(USER_ID)).toEqual({ data: [], error: null });
    expect(state.calls).toHaveLength(0);
  });
});
