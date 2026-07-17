/**
 * POST /api/coupons/validate — 체크아웃 쿠폰 사전 검증 (FS-X-01, ADR-026).
 *
 * Body: { code, subtotal, payable? } — subtotal/payable 은 표시용 할인 계산
 * 기준(클라이언트 값). 여기서의 판정은 UX 프리뷰일 뿐이고, 청구 금액은
 * createOrder 가 서버 권위 값으로 재검증·재계산한다(표시≠청구 구조 차단).
 *
 * 코드 열거 방지(ADR-026 §8): coupons 는 RLS 정책 없음(service-role 전용)이라
 * 이 라우트가 유일한 공개 검증 창구다. 부재/비활성/만료/최소금액 미달은 전부
 * COUPON_INVALID 단일 표현으로 수렴하고(존재 여부 비구분), 레이트리밋으로
 * 무차별 대입을 조인다. 042 미적용(probe false)도 동일하게 COUPON_INVALID.
 *
 * Response: { ok: true, valid: true, code, type, value, discount }
 *         | { ok: true, valid: false, errorCode }
 *         | { ok: false, code } (BAD_ORIGIN/RATE_LIMITED/BAD_JSON/BAD_INPUT)
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { couponApplyInputSchema } from '@/types/coupon';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { validateCoupon } from '@/lib/db/coupons';
import { isCouponsAvailable } from '@/lib/db/feature-probe';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { checkRate } from '@/lib/ratelimit';
import { getClientIp } from '@/lib/security/client-ip';

/**
 * couponApplyInputSchema(FROZEN, code 만) + 표시용 금액 확장. payable 미지정
 * 시 subtotal 로 폴백 — payable ≥ subtotal 이므로 할인 상한이 실제보다 작게
 * 잡힐 수만 있다(과소 표시는 안전 방향, 청구는 createOrder 가 확정).
 */
const bodySchema = couponApplyInputSchema.extend({
  subtotal: z.number().int().nonnegative(),
  payable: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }

  // 회원이면 userId 기준, 아니면 IP 기준으로 코드 대입 시도를 조인다.
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ? asBrand<UserId>(userData.user.id) : null;

  const rateKey = (userId as string | null) ?? getClientIp(request);
  const rate = await checkRate('coupon_validate', rateKey, {
    max: 10,
    windowMs: 60_000,
  });
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
    return NextResponse.json({ ok: false, code: 'BAD_JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 422 },
    );
  }

  // Probe 게이트(042 미적용 창): 기능 부재도 단일 COUPON_INVALID 표현 —
  // 42703/42P01 을 클라이언트에 노출하지 않는다.
  if (!(await isCouponsAvailable())) {
    return NextResponse.json({
      ok: true,
      valid: false,
      errorCode: 'COUPON_INVALID',
    });
  }

  const { code, subtotal, payable } = parsed.data;
  const result = await validateCoupon(code, subtotal, payable ?? subtotal, userId);

  if (!result.valid) {
    return NextResponse.json({
      ok: true,
      valid: false,
      errorCode: result.errorCode,
    });
  }

  // type/value 를 함께 내려 클라이언트가 금액 변동(배송비 등) 시
  // calcCouponDiscount(공용 순수 함수)로 표시 할인액을 재계산할 수 있게 한다.
  return NextResponse.json({
    ok: true,
    valid: true,
    code: result.code,
    type: result.type,
    value: result.value,
    discount: result.discount,
  });
}
