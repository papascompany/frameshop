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
import type { PhotoId, UserId } from '@/types/common';
import type { AddToCartInput } from '@/types/cart';
import { getServerSupabase } from '@/lib/supabase/server';
import { getOrder } from '@/lib/db/order';
import { getPhotoIdsByOriginalUrl } from '@/lib/db/photo';
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

  // order_items → AddToCartInput 변환 (선결과제 1).
  // photoId 복원: ① 스냅샷의 sourcePhotoId(주문 생성 시 동결한 원본) 우선,
  // ② 없으면(레거시 주문) 베이크 크롭 photo_url 로 photos.id 를 역조회.
  // 둘 다 실패하면(원본 사진 정리됨) 그 줄은 건너뛴다 — photoId 는 CartItem 의
  // NOT-null 필수 필드라 빈 값으로 담으면 /api/cart 검증에서 거부된다.
  const legacyUrls = order.items
    .filter((it) => !it.snapshot.sourcePhotoId)
    .map((it) => it.photoUrl);
  const idByUrl = await getPhotoIdsByOriginalUrl(legacyUrls);

  const reorderItems: AddToCartInput[] = [];
  let skipped = 0;
  for (const item of order.items) {
    const photoId: PhotoId | undefined =
      item.snapshot.sourcePhotoId ?? idByUrl.get(item.photoUrl);
    if (!photoId) {
      skipped += 1;
      continue;
    }
    reorderItems.push({
      userId: null,
      productId: item.snapshot.productId,
      variantId: item.snapshot.variantId,
      photoId,
      options: item.snapshot.options,
      photoUrl: item.photoUrl,
      cropTransform: item.cropTransform,
      previewUrl: item.photoUrl,
      price: item.snapshot.unitPrice,
      quantity: item.quantity,
    });
  }

  return NextResponse.json({ ok: true, items: reorderItems, skipped });
}
