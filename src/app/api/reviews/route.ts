/**
 * POST /api/reviews
 *
 * 리뷰 작성 — 인증 필요, 본인 주문인지 확인.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { uuidLike } from '@/types/common';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { createReview, getOrderReview } from '@/lib/db/reviews';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const reviewSchema = z.object({
  orderId: uuidLike,
  productId: uuidLike.optional().nullable(),
  rating: z.number().int().min(1).max(5),
  body: z.string().max(2000).optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
});

export async function POST(request: NextRequest) {
  // HIGH-001 FIX: CSRF guard — reject cross-origin POST requests.
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }

  // 인증 확인
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // Throttle review creation per user (anti-spam / reputation flooding).
  const rate = await checkRate('review_create', user.id, { max: 5, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: '리뷰 작성이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const { orderId, productId, rating, reviewBody, photoUrl } = {
    ...parsed.data,
    reviewBody: parsed.data.body,
  };

  // 본인 주문인지 확인 (service role로 조회)
  const svcSupabase = getServiceRoleSupabase();
  const { data: order } = await svcSupabase
    .from('orders')
    .select('id, user_id, status')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ ok: false, error: '주문을 찾을 수 없습니다.' }, { status: 404 });
  }

  if (order.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: '본인 주문에만 리뷰를 작성할 수 있습니다.' },
      { status: 403 },
    );
  }

  if (order.status !== 'DELIVERED') {
    return NextResponse.json(
      { ok: false, error: '배송 완료 후 리뷰를 작성할 수 있습니다.' },
      { status: 422 },
    );
  }

  // 중복 리뷰 체크
  const existing = await getOrderReview(orderId);
  if (existing) {
    return NextResponse.json(
      { ok: false, error: '이미 리뷰를 작성하셨습니다.' },
      { status: 409 },
    );
  }

  try {
    const review = await createReview({
      orderId,
      userId: user.id,
      productId: productId ?? null,
      rating,
      body: reviewBody ?? null,
      photoUrl: photoUrl ?? null,
    });
    return NextResponse.json({ ok: true, review }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '리뷰 작성 실패' },
      { status: 500 },
    );
  }
}
