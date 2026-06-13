/**
 * POST /api/cart/reorder
 *
 * Body: { orderId: string }
 *
 * 해당 주문의 order_items를 CartItem 형식으로 변환하여 반환한다.
 * 클라이언트는 이를 받아 addToCart를 반복 호출하면 된다.
 *
 * 보안: 요청한 사용자가 해당 주문의 소유자인지 확인 후 반환.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { getServerSupabase } from '@/lib/supabase/server';
import { getOrder } from '@/lib/db/order';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

async function getUserId(): Promise<UserId | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ? asBrand<UserId>(data.user.id) : null;
}

export async function POST(request: Request): Promise<Response> {
  // HIGH-001 FIX: CSRF guard — reject cross-origin POST requests.
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN' },
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

  const rate = await checkRate('cart_reorder', userId as string, { max: 20, windowMs: 60_000 });
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
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).orderId !== 'string'
  ) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }

  const orderId = (body as { orderId: string }).orderId;

  const order = await getOrder(orderId);
  if (!order) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  }

  // 소유자 확인 — 다른 유저의 주문 아이템을 재주문하는 것을 방지.
  if (order.userId !== userId) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  // order_items → AddToCartInput 형식으로 변환.
  // photoId는 스냅샷에 없으므로 photoUrl로 대체 (CartItem 스키마에서 required).
  // 기존 snapshot에서 복원 가능한 필드만 담는다.
  const reorderItems = order.items.map((item) => ({
    productId: item.snapshot.productId,
    variantId: item.snapshot.variantId,
    photoId: null, // 원본 photoId는 스냅샷 미포함 — 클라이언트가 처리
    photoUrl: item.photoUrl,
    cropTransform: item.cropTransform,
    previewUrl: item.photoUrl, // 재주문 시 미리보기 = 원본 사진
    price: item.snapshot.unitPrice,
    quantity: item.quantity,
    options: item.snapshot.options,
    snapshot: item.snapshot,
    printFileUrl: item.printFileUrl,
  }));

  return NextResponse.json({ ok: true, items: reorderItems });
}
