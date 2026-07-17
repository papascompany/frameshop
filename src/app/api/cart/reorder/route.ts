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
import type { CartProjectId, PhotoId, UserId } from '@/types/common';
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

  // FS-X-05 (ADR-025 §P3): 세트(묶음) 복원. 그룹 키는 snapshot.groupLabel —
  // 주문 스냅샷에 동결된 유일한 durable 그룹 키(035 무관)다. CartItem zod 는
  // projectId 에 uuid 를 요구하므로 표시 라벨('묶음 1')을 키로 실을 수 없다 —
  // 그룹당 새 projectLocalId(uuid)를 발급해 라인들이 다시 한 묶음으로 담긴다.
  // 새 uuid 는 클라이언트 로컬 그룹 키일 뿐이며(createOrder 가 서버 group id 를
  // 다시 발급), 주문마다 새로 발급되므로 재주문 간 충돌이 없다.
  const projectIdByLabel = new Map<string, CartProjectId>();
  // 스냅샷에 projectSeq 가 없는 레거시 묶음 라인의 폴백 순번(그룹 내 0-based).
  const nextSeqByLabel = new Map<string, number>();

  const reorderItems: AddToCartInput[] = [];
  let skipped = 0;
  for (const item of order.items) {
    const photoId: PhotoId | undefined =
      item.snapshot.sourcePhotoId ?? idByUrl.get(item.photoUrl);
    if (!photoId) {
      skipped += 1;
      continue;
    }
    const base: AddToCartInput = {
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
    };

    const rawLabel = item.snapshot.groupLabel;
    const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    if (label === '') {
      // 단품/레거시(groupLabel 없음) — 현행 평면 복원 그대로(회귀 없음).
      reorderItems.push(base);
      continue;
    }

    let projectId = projectIdByLabel.get(label);
    if (!projectId) {
      projectId = asBrand<CartProjectId>(crypto.randomUUID());
      projectIdByLabel.set(label, projectId);
    }
    const fallbackSeq = nextSeqByLabel.get(label) ?? 0;
    nextSeqByLabel.set(label, fallbackSeq + 1);

    reorderItems.push({
      ...base,
      projectId,
      // 스냅샷 projectSeq 우선(라인 표시 순서 보존), 없으면 그룹 내 등장 순번.
      projectSeq: item.snapshot.projectSeq ?? fallbackSeq,
      // 방향은 스냅샷에 있을 때만 전달(단품과 동일하게 키 자체를 생략).
      ...(item.snapshot.orientation != null
        ? { orientation: item.snapshot.orientation }
        : {}),
    });
  }

  return NextResponse.json({ ok: true, items: reorderItems, skipped });
}
