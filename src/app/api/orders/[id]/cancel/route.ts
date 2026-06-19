/**
 * POST /api/orders/[id]/cancel — 고객 본인 주문취소 신청 (Phase B-1).
 *
 * 배송 전(CREATED / PAID) 주문만 취소 가능. 결제가 있으면 Toss 환불 후
 * CANCELLED 로 전환된다. 모든 소유권/상태 검증은 L1 customerCancelOrder 에서
 * 수행하므로 이 핸들러는 인증·동일출처·레이트리밋 게이트만 책임진다.
 *
 * [id] 는 order id 또는 orderNo 둘 다 허용 (getOrder 가 양쪽을 받음).
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asBrand } from '@/types/common';
import type { OrderId, UserId } from '@/types/common';
import { customerCancelOrder } from '@/lib/db/order';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

/** Optional cancel reason. Defaults applied downstream when absent/blank. */
const bodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }

  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const rawUserId = userData.user?.id ?? null;
  if (!rawUserId) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const userId = asBrand<UserId>(rawUserId);

  // Per-user throttle so the cancel + PG-refund path can't be hammered.
  const rate = await checkRate('order_cancel', userId as string, { max: 10, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', message: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  // Reason is optional; an unparseable/empty body is treated as "no reason".
  let reason: string | undefined;
  try {
    const raw = await request.json();
    const parsed = bodySchema.safeParse(raw);
    reason = parsed.success ? parsed.data.reason : undefined;
  } catch {
    reason = undefined;
  }

  const { id } = await context.params;
  const result = await customerCancelOrder(asBrand<OrderId>(id), userId, reason);
  if (!result.ok) {
    // Ownership/state failures from L1 are client errors (403). Without a
    // distinct code we default to 403 — never leak a 500 for an expected
    // "not allowed" outcome.
    return NextResponse.json(
      { ok: false, code: 'CANCEL_FAILED', message: result.error },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
