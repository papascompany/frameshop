/**
 * POST /api/reviews — 주문당 리뷰 1개(046) 경합 처리.
 *
 * 고정하는 계약:
 *  1. 사전 조회를 통과했지만 INSERT 가 UNIQUE(23505)로 거부되면 → 409, 사전 조회와 같은 문구.
 *  2. 그 외 DB 오류는 500 이고, 응답에 DB 오류 원문을 싣지 않는다(서버 로그로만).
 *  3. createReview 의 23505 → DuplicateReviewError 매핑(DB 계층).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

const state = {
  insertError: null as { code?: string; message: string } | null,
};

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock('@/lib/security/same-origin', () => ({ isSameOrigin: () => true }));
vi.mock('@/lib/ratelimit', () => ({ checkRate: async () => ({ ok: true }) }));
vi.mock('@/lib/supabase/anon', () => ({ getAnonSupabase: () => ({}) }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () =>
            state.insertError
              ? { data: null, error: state.insertError }
              : {
                  data: {
                    id: 'r-1',
                    order_id: ORDER_ID,
                    user_id: USER_ID,
                    product_id: null,
                    rating: 5,
                    body: null,
                    photo_url: null,
                    is_public: true,
                    created_at: '2026-11-19T00:00:00Z',
                  },
                  error: null,
                },
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'orders'
              ? { data: { id: ORDER_ID, user_id: USER_ID, status: 'DELIVERED' }, error: null }
              : { data: null, error: null }, // reviews: 사전 조회 통과(아직 없음)
        }),
      }),
    }),
  }),
}));

import { POST } from '@/app/api/reviews/route';
import { createReview, DuplicateReviewError } from '@/lib/db/reviews';

function req(): NextRequest {
  return new Request('http://localhost/api/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: ORDER_ID, rating: 5 }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  state.insertError = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/reviews — 주문당 1개', () => {
  it('정상 작성 → 201', async () => {
    const res = await POST(req());
    expect(res.status).toBe(201);
  });

  it('사전 조회 통과 후 UNIQUE 위반(동시 요청) → 409, 사전 조회와 같은 문구', async () => {
    state.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "reviews_order_uniq"' };
    const res = await POST(req());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ ok: false, error: '이미 리뷰를 작성하셨습니다.' });
  });

  it('그 외 DB 오류 → 500, 응답에 DB 원문 없음', async () => {
    state.insertError = { code: '42501', message: 'new row violates row-level security policy for table "reviews"' };
    const res = await POST(req());
    expect(res.status).toBe(500);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).not.toContain('reviews');
    expect(json.error).not.toContain('policy');
  });
});

describe('createReview — 23505 매핑', () => {
  it('UNIQUE 위반은 DuplicateReviewError', async () => {
    state.insertError = { code: '23505', message: 'dup' };
    await expect(
      createReview({ orderId: ORDER_ID, userId: USER_ID, productId: null, rating: 5, body: null, photoUrl: null }),
    ).rejects.toBeInstanceOf(DuplicateReviewError);
  });

  it('다른 오류는 일반 Error', async () => {
    state.insertError = { code: '42501', message: 'rls' };
    const p = createReview({ orderId: ORDER_ID, userId: USER_ID, productId: null, rating: 5, body: null, photoUrl: null });
    await expect(p).rejects.toThrow('createReview failed');
    await expect(p).rejects.not.toBeInstanceOf(DuplicateReviewError);
  });
});
