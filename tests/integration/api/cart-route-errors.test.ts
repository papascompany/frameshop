/**
 * POST /api/cart 에러 정제 매핑 (FS-P1 security P1-001).
 *
 * upsertCartItem 의 DB 예외가 raw 메시지 그대로 무처리 500 으로 새지 않고,
 * 형식/범위/FK 위반(22P02/22003/23503 류)은 400, 그 외는 일반화 500 으로
 * 매핑됨을 고정한다. 강화된 zod 는 비uuid projectId 를 DB 도달 전에 거부한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRate: vi.fn(async () => ({ ok: true, remaining: 59 })),
}));

vi.mock('@/lib/db/cart', () => ({
  listCartForUser: vi.fn(),
  upsertCartItem: vi.fn(),
}));

import { POST } from '@/app/api/cart/route';
import { upsertCartItem } from '@/lib/db/cart';

const upsertMock = vi.mocked(upsertCartItem);

function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    localId: '11111111-1111-4111-8111-111111111111',
    userId: null,
    productId: '33333333-3333-4333-8333-333333333333',
    variantId: 'v-1',
    photoId: 'ph-1',
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

async function call(body: Record<string, unknown>): Promise<{
  status: number;
  body: { ok: boolean; code?: string; message?: string };
  raw: string;
}> {
  // 테스트 환경(NODE_ENV !== 'production')에서는 Origin/Sec-Fetch-Site 부재가
  // same-origin 으로 통과한다(isSameOrigin 계약).
  const req = new Request('http://localhost/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const raw = await res.text();
  return {
    status: res.status,
    body: JSON.parse(raw) as { ok: boolean; code?: string; message?: string },
    raw,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertMock.mockResolvedValue(undefined);
  // 정제 매핑은 상세를 서버 로그에만 남긴다 — 테스트 출력 오염 방지.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/cart — DB 에러 정제 매핑 (P1-001)', () => {
  it('형식 위반(22P02 류) 예외 → 400 INVALID_REFERENCE, raw 메시지 미노출', async () => {
    upsertMock.mockRejectedValue(
      new Error('upsertCartProject select: invalid input syntax for type uuid: "x"'),
    );

    const { status, body, raw } = await call(makeBody());

    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false, code: 'INVALID_REFERENCE' });
    expect(raw).not.toContain('invalid input syntax');
  });

  it('그 외 DB 예외 → 500 CART_WRITE_FAILED 일반화, raw 메시지 미노출', async () => {
    upsertMock.mockRejectedValue(
      new Error('upsertCartItem: TLS handshake timeout at 10.0.0.3'),
    );

    const { status, body, raw } = await call(makeBody());

    expect(status).toBe(500);
    expect(body).toMatchObject({ ok: false, code: 'CART_WRITE_FAILED' });
    expect(raw).not.toContain('TLS handshake');
    expect(raw).not.toContain('10.0.0.3');
  });

  it('비uuid projectId 는 DB 도달 전에 422 BAD_INPUT 으로 거부된다', async () => {
    const { status, body } = await call(makeBody({ projectId: 'x' }));

    expect(status).toBe(422);
    expect(body).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('정상 항목은 여전히 200 — 강화 회귀 0', async () => {
    const { status, body } = await call(
      makeBody({
        projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        projectSeq: 1,
        orientation: 'landscape',
      }),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
});
