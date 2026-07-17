/**
 * /api/account/inquiries + /api/account/wishlist 라우트 — FS-X-02.
 *
 * addresses 라우트 선례의 봉투 계약을 검증한다:
 * 401(UNAUTHENTICATED) / 403(BAD_ORIGIN) / 422(BAD_INPUT) / 429(RATE_LIMITED)
 * / 503(UNAVAILABLE — probe 창). 레이트리미터는 실물(in-memory)을 쓰고 테스트
 * 간 _resetRateLimit 으로 격리한다. contactEmail 폴백(입력 or 세션 이메일)도
 * 여기서 못박는다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { InquiryId, ProductId, UserId } from '@/types/common';
import type { Inquiry } from '@/types/inquiry';

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

vi.mock('@/lib/db/inquiries', () => ({
  INQUIRIES_UNAVAILABLE: 'INQUIRIES_UNAVAILABLE',
  listMyInquiries: vi.fn(),
  createInquiry: vi.fn(),
}));

vi.mock('@/lib/db/wishlists', () => ({
  WISHLIST_UNAVAILABLE: 'WISHLIST_UNAVAILABLE',
  listWishlist: vi.fn(),
  addToWishlist: vi.fn(),
  removeFromWishlist: vi.fn(),
  isWishlisted: vi.fn(),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isInquiriesAvailable: vi.fn(async () => true),
  isWishlistAvailable: vi.fn(async () => true),
}));

import { GET as inquiriesGET, POST as inquiriesPOST } from '@/app/api/account/inquiries/route';
import {
  DELETE as wishlistDELETE,
  GET as wishlistGET,
  POST as wishlistPOST,
} from '@/app/api/account/wishlist/route';
import { getServerSupabase } from '@/lib/supabase/server';
import { createInquiry, listMyInquiries } from '@/lib/db/inquiries';
import {
  addToWishlist,
  isWishlisted,
  listWishlist,
  removeFromWishlist,
} from '@/lib/db/wishlists';
import { isInquiriesAvailable, isWishlistAvailable } from '@/lib/db/feature-probe';
import { _resetRateLimit } from '@/lib/ratelimit';

const getServerSupabaseMock = vi.mocked(getServerSupabase);
const listMyInquiriesMock = vi.mocked(listMyInquiries);
const createInquiryMock = vi.mocked(createInquiry);
const listWishlistMock = vi.mocked(listWishlist);
const addToWishlistMock = vi.mocked(addToWishlist);
const removeFromWishlistMock = vi.mocked(removeFromWishlist);
const isWishlistedMock = vi.mocked(isWishlisted);
const isInquiriesAvailableMock = vi.mocked(isInquiriesAvailable);
const isWishlistAvailableMock = vi.mocked(isWishlistAvailable);

// ---------- helpers / fixtures ----------

function authAs(user: { id: string; email?: string } | null): void {
  getServerSupabaseMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>);
}

function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';

function makeInquiry(): Inquiry {
  return {
    id: asBrand<InquiryId>('inq-1'),
    userId: asBrand<UserId>('user-1'),
    orderId: null,
    productId: null,
    contactEmail: 'me@example.com',
    category: null,
    subject: '배송 문의',
    body: '언제 오나요?',
    status: 'OPEN',
    adminReply: null,
    answeredAt: null,
    createdAt: '2026-07-17T00:00:00Z',
  };
}

const VALID_INQUIRY_BODY = {
  subject: '배송 문의',
  body: '언제 오나요?',
  contactEmail: 'me@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimit();
  authAs({ id: 'user-1', email: 'session@example.com' });
  isInquiriesAvailableMock.mockResolvedValue(true);
  isWishlistAvailableMock.mockResolvedValue(true);
  listMyInquiriesMock.mockResolvedValue({ data: [makeInquiry()], error: null });
  createInquiryMock.mockResolvedValue({ data: makeInquiry(), error: null });
  listWishlistMock.mockResolvedValue({ data: [], error: null });
  addToWishlistMock.mockResolvedValue({ data: true, error: null });
  removeFromWishlistMock.mockResolvedValue({ data: true, error: null });
  isWishlistedMock.mockResolvedValue({
    data: [asBrand<ProductId>(PRODUCT_A)],
    error: null,
  });
});

// ---------- /api/account/inquiries ----------

describe('GET /api/account/inquiries', () => {
  it('비로그인 → 401 UNAUTHENTICATED', async () => {
    authAs(null);
    const res = await inquiriesGET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('로그인 → 내 목록 { ok, available, inquiries }', async () => {
    const res = await inquiriesGET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; available: boolean; inquiries: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.available).toBe(true);
    expect(json.inquiries).toHaveLength(1);
    expect(listMyInquiriesMock).toHaveBeenCalledWith('user-1');
  });

  it('probe false(040 미적용) → 200 { available:false, inquiries:[] } + 쿼리 미실행', async () => {
    isInquiriesAvailableMock.mockResolvedValue(false);
    const res = await inquiriesGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, available: false, inquiries: [] });
    expect(listMyInquiriesMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/inquiries', () => {
  const URL_ = 'http://localhost:3000/api/account/inquiries';

  it('크로스 오리진 → 403 BAD_ORIGIN', async () => {
    const res = await inquiriesPOST(
      jsonRequest(URL_, 'POST', VALID_INQUIRY_BODY, { origin: 'https://evil.example.com' }),
    );
    expect(res.status).toBe(403);
    expect(createInquiryMock).not.toHaveBeenCalled();
  });

  it('비로그인 → 401', async () => {
    authAs(null);
    const res = await inquiriesPOST(jsonRequest(URL_, 'POST', VALID_INQUIRY_BODY));
    expect(res.status).toBe(401);
  });

  it('subject 누락 → 422 BAD_INPUT', async () => {
    const res = await inquiriesPOST(
      jsonRequest(URL_, 'POST', { body: '내용만 있음', contactEmail: 'me@example.com' }),
    );
    expect(res.status).toBe(422);
    expect(createInquiryMock).not.toHaveBeenCalled();
  });

  it('contactEmail 미지정 시 세션 이메일로 폴백 주입한다', async () => {
    const res = await inquiriesPOST(
      jsonRequest(URL_, 'POST', { subject: '문의', body: '내용' }),
    );
    expect(res.status).toBe(201);
    const [, input] = createInquiryMock.mock.calls[0];
    expect(input.contactEmail).toBe('session@example.com');
  });

  it('회원이 타 이메일을 보내도 세션 이메일로 덮어쓴다 (Sec P2 — 사칭 차단)', async () => {
    const res = await inquiriesPOST(
      jsonRequest(URL_, 'POST', {
        subject: '문의',
        body: '내용',
        contactEmail: 'attacker@evil.example.com',
      }),
    );
    expect(res.status).toBe(201);
    const [, input] = createInquiryMock.mock.calls[0];
    // 입력값(attacker@…)이 아니라 검증된 세션 이메일로 저장돼야 한다.
    expect(input.contactEmail).toBe('session@example.com');
  });

  it('contactEmail 도 세션 이메일도 없으면 422 (스키마 필수)', async () => {
    authAs({ id: 'user-1' }); // email 없는 세션
    const res = await inquiriesPOST(
      jsonRequest(URL_, 'POST', { subject: '문의', body: '내용' }),
    );
    expect(res.status).toBe(422);
  });

  it('시간당 5회 초과(6번째) → 429 + Retry-After', async () => {
    for (let i = 0; i < 5; i += 1) {
      const ok = await inquiriesPOST(jsonRequest(URL_, 'POST', VALID_INQUIRY_BODY));
      expect(ok.status).toBe(201);
    }
    const res = await inquiriesPOST(jsonRequest(URL_, 'POST', VALID_INQUIRY_BODY));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(createInquiryMock).toHaveBeenCalledTimes(5);
  });

  it('probe 창(INQUIRIES_UNAVAILABLE) → 503 UNAVAILABLE', async () => {
    createInquiryMock.mockResolvedValue({ data: null, error: 'INQUIRIES_UNAVAILABLE' });
    const res = await inquiriesPOST(jsonRequest(URL_, 'POST', VALID_INQUIRY_BODY));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  });

  it('FK 위반(REF_NOT_FOUND) → 422', async () => {
    createInquiryMock.mockResolvedValue({ data: null, error: 'REF_NOT_FOUND' });
    const res = await inquiriesPOST(jsonRequest(URL_, 'POST', VALID_INQUIRY_BODY));
    expect(res.status).toBe(422);
  });
});

// ---------- /api/account/wishlist ----------

describe('GET /api/account/wishlist', () => {
  const URL_ = 'http://localhost:3000/api/account/wishlist';

  it('비로그인 → 401', async () => {
    authAs(null);
    const res = await wishlistGET(new Request(URL_));
    expect(res.status).toBe(401);
  });

  it('productIds 쿼리 → 배치 위시 상태 { ok, wishlisted }', async () => {
    const res = await wishlistGET(
      new Request(`${URL_}?productIds=${PRODUCT_A},${PRODUCT_B}`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, wishlisted: [PRODUCT_A] });
    const [uid, ids] = isWishlistedMock.mock.calls[0];
    expect(uid).toBe('user-1');
    expect(ids).toEqual([PRODUCT_A, PRODUCT_B]);
  });

  it('productIds 에 uuid 아닌 값 → 422', async () => {
    const res = await wishlistGET(new Request(`${URL_}?productIds=not-a-uuid`));
    expect(res.status).toBe(422);
    expect(isWishlistedMock).not.toHaveBeenCalled();
  });

  it('쿼리 없으면 내 목록 { ok, available, items }', async () => {
    const res = await wishlistGET(new Request(URL_));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, available: true, items: [] });
    expect(listWishlistMock).toHaveBeenCalledWith('user-1');
  });

  it('probe false → 200 { available:false, items:[] }', async () => {
    isWishlistAvailableMock.mockResolvedValue(false);
    const res = await wishlistGET(new Request(URL_));
    expect(await res.json()).toEqual({ ok: true, available: false, items: [] });
    expect(listWishlistMock).not.toHaveBeenCalled();
  });
});

describe('POST/DELETE /api/account/wishlist', () => {
  const URL_ = 'http://localhost:3000/api/account/wishlist';

  it('POST 추가 → 201 { ok } (세션 userId 스코핑)', async () => {
    const res = await wishlistPOST(jsonRequest(URL_, 'POST', { productId: PRODUCT_A }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(addToWishlistMock).toHaveBeenCalledWith('user-1', PRODUCT_A);
  });

  it('POST 크로스 오리진 → 403', async () => {
    const res = await wishlistPOST(
      jsonRequest(URL_, 'POST', { productId: PRODUCT_A }, { origin: 'https://evil.example.com' }),
    );
    expect(res.status).toBe(403);
    expect(addToWishlistMock).not.toHaveBeenCalled();
  });

  it('POST uuid 아닌 productId → 422', async () => {
    const res = await wishlistPOST(jsonRequest(URL_, 'POST', { productId: 'abc' }));
    expect(res.status).toBe(422);
    expect(addToWishlistMock).not.toHaveBeenCalled();
  });

  it('POST probe 창(WISHLIST_UNAVAILABLE) → 503', async () => {
    addToWishlistMock.mockResolvedValue({ data: null, error: 'WISHLIST_UNAVAILABLE' });
    const res = await wishlistPOST(jsonRequest(URL_, 'POST', { productId: PRODUCT_A }));
    expect(res.status).toBe(503);
  });

  it('DELETE 제거(body productId) → { ok } 멱등', async () => {
    const res = await wishlistDELETE(
      jsonRequest(URL_, 'DELETE', { productId: PRODUCT_A }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(removeFromWishlistMock).toHaveBeenCalledWith('user-1', PRODUCT_A);
  });

  it('분당 30회 초과(31번째) → 429 (POST/DELETE 공유 버킷)', async () => {
    for (let i = 0; i < 30; i += 1) {
      const ok = await wishlistPOST(jsonRequest(URL_, 'POST', { productId: PRODUCT_A }));
      expect(ok.status).toBe(201);
    }
    const res = await wishlistDELETE(
      jsonRequest(URL_, 'DELETE', { productId: PRODUCT_A }),
    );
    expect(res.status).toBe(429);
    expect(removeFromWishlistMock).not.toHaveBeenCalled();
  });
});
