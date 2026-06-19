/**
 * POST /api/orders/[id]/confirm — 고객 구매확정 (Phase B-1).
 *
 * 배송완료(DELIVERED) 주문만 확정 가능. confirmed_at 을 now() 로 set 하며,
 * 이미 확정된 주문이면 멱등적으로 ok 를 돌려준다. 소유권/상태 검증은 L1
 * confirmPurchase 가 수행하므로 이 핸들러는 인증·동일출처·레이트리밋만 책임진다.
 *
 * [id] 는 order id 또는 orderNo 둘 다 허용 (getOrder 가 양쪽을 받음).
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { asBrand } from '@/types/common';
import type { OrderId, UserId } from '@/types/common';
import { confirmPurchase } from '@/lib/db/order';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';

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

  const rate = await checkRate('order_confirm', userId as string, { max: 10, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', message: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  const { id } = await context.params;
  const result = await confirmPurchase(asBrand<OrderId>(id), userId);
  if (!result.ok) {
    // Ownership/state failures from L1 are expected client errors → 403,
    // not a 500. confirmPurchase is idempotent on already-confirmed orders.
    return NextResponse.json(
      { ok: false, code: 'CONFIRM_FAILED', message: result.error },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
