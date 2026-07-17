/**
 * /api/account/wishlist — 위시리스트, 로그인 전용 (FS-X-02, ADR-026).
 *  GET    → ?productIds=uuid,uuid… 지정 시 배치 상태 조회 { ok, wishlisted },
 *           미지정 시 내 위시 목록 { ok, available, items }(상품 요약 조인).
 *  POST   → 추가(body { productId }) — UNIQUE 충돌은 성공(멱등 토글).
 *  DELETE → 제거(body { productId }) — 부재 행도 성공(멱등).
 *
 * Auth is required for all: the DB layer (service-role) BYPASSES RLS, so every
 * query is scoped by the verified session user_id — never a client-supplied id.
 * Mutations are additionally gated by the same-origin guard + a per-user write
 * throttle, mirroring the addresses routes.
 *
 * graceful 계약: migration 041 미적용이면 GET 은 빈 결과(200), 쓰기는 503
 * UNAVAILABLE — 42P01 이 클라로 새지 않는다.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { wishlistInputSchema } from '@/types/wishlist';
import { asBrand } from '@/types/common';
import type { ProductId, UserId } from '@/types/common';
import {
  addToWishlist,
  isWishlisted,
  listWishlist,
  removeFromWishlist,
  WISHLIST_UNAVAILABLE,
} from '@/lib/db/wishlists';
import { isWishlistAvailable } from '@/lib/db/feature-probe';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

/** 카탈로그 한 페이지(≤100) 하이드레이션이 상한 — 무한 IN 목록 방지. */
const productIdsQuerySchema = z.array(z.string().uuid()).min(1).max(100);

async function getUserId(): Promise<UserId | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ? asBrand<UserId>(data.user.id) : null;
}

/** Per-user wishlist-mutation throttle (shared by POST/DELETE). null = allowed. */
async function wishlistRateLimited(userId: UserId): Promise<Response | null> {
  const rate = await checkRate('wishlist_write', userId as string, {
    max: 30,
    windowMs: 60_000,
  });
  if (rate.ok) return null;
  return NextResponse.json(
    { ok: false, code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
  );
}

/** 뮤테이션 body 에서 productId 를 검증해 뽑는다. 실패 시 에러 Response. */
async function parseProductId(
  request: Request,
): Promise<{ productId: ProductId } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: NextResponse.json({ ok: false, code: 'BAD_JSON' }, { status: 400 }),
    };
  }
  const parsed = wishlistInputSchema.safeParse(body);
  if (!parsed.success) {
    return {
      response: NextResponse.json(
        { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
        { status: 422 },
      ),
    };
  }
  return { productId: asBrand<ProductId>(parsed.data.productId) };
}

function mapWriteError(error: string | null): Response {
  if (error === WISHLIST_UNAVAILABLE) {
    return NextResponse.json({ ok: false, code: 'UNAVAILABLE' }, { status: 503 });
  }
  if (error === 'REF_NOT_FOUND') {
    return NextResponse.json({ ok: false, code: 'BAD_INPUT' }, { status: 422 });
  }
  return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 });
}

export async function GET(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const raw = new URL(request.url).searchParams.get('productIds');
  if (raw !== null) {
    // 배치 상태 조회 — 카탈로그/상세 하트 하이드레이션용.
    const parsed = productIdsQuerySchema.safeParse(
      raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
        { status: 422 },
      );
    }
    const { data, error } = await isWishlisted(
      userId,
      parsed.data.map((id) => asBrand<ProductId>(id)),
    );
    if (error) {
      return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, wishlisted: data });
  }

  const available = await isWishlistAvailable().catch(() => false);
  if (!available) {
    return NextResponse.json({ ok: true, available: false, items: [] });
  }
  const { data, error } = await listWishlist(userId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, available: true, items: data });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const limited = await wishlistRateLimited(userId);
  if (limited) return limited;

  const input = await parseProductId(request);
  if ('response' in input) return input.response;

  const { error } = await addToWishlist(userId, input.productId);
  if (error) return mapWriteError(error);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const limited = await wishlistRateLimited(userId);
  if (limited) return limited;

  const input = await parseProductId(request);
  if ('response' in input) return input.response;

  const { error } = await removeFromWishlist(userId, input.productId);
  if (error) return mapWriteError(error);
  return NextResponse.json({ ok: true });
}
