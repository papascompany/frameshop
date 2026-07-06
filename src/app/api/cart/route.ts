/**
 * /api/cart — authed cart sync.
 *  GET   → list user's cart items
 *  POST  → upsert single cart item (body: CartItem JSON)
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { cartItemSchema } from '@/types/cart';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import type { CartItem } from '@/types/cart';
import { listCartForUser, upsertCartItem } from '@/lib/db/cart';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

async function getUserId(): Promise<UserId | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ? asBrand<UserId>(data.user.id) : null;
}

export async function GET(): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const items = await listCartForUser(userId);
  return NextResponse.json({ ok: true, items });
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
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const rate = await checkRate('cart_write', userId as string, { max: 60, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_JSON' },
      { status: 400 },
    );
  }
  const parsed = cartItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 422 },
    );
  }
  // Owner override is forced server-side: ignore client's userId.
  const item = { ...parsed.data, userId: userId } as CartItem;
  try {
    await upsertCartItem(item);
  } catch (err) {
    // FS-P1 security P1-001: DB 오류를 raw 그대로 클라이언트에 흘리지 않는다.
    // zod 강화(uuid/.max)로 정상 클라이언트는 여기 닿지 않지만, 변조 입력의
    // 형식·범위·FK 위반(22P02/22003/23503)은 400 으로 정제하고 그 외에는 상세를
    // 서버 로그에만 남긴 채 일반화된 500 을 반환한다.
    const detail = err instanceof Error ? err.message : String(err);
    const badReference =
      /22P02|22003|23503|invalid input syntax|out of range|foreign key/i.test(
        detail,
      );
    console.error(
      JSON.stringify({ event: 'cart_upsert_failed', userId, detail }),
    );
    return NextResponse.json(
      badReference
        ? { ok: false, code: 'INVALID_REFERENCE' }
        : { ok: false, code: 'CART_WRITE_FAILED' },
      { status: badReference ? 400 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
