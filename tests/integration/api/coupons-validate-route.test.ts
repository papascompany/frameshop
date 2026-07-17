/**
 * POST /api/coupons/validate 계약 테스트 (FS-X-01, ADR-026).
 *
 * 고정하는 계약: zod 입력 검증(couponApplyInputSchema 확장), 레이트리밋 429,
 * probe false(042 미적용) → COUPON_INVALID 단일 표현(validateCoupon 미호출 —
 * 42703 노출 금지), 회원 userId/비회원 null 전달, payable 미지정 시 subtotal
 * 폴백, valid/invalid 응답 봉투.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CouponValidationResult } from '@/types/coupon';
import { asBrand } from '@/types/common';
import type { CouponId } from '@/types/common';

const mockState: {
  user: { id: string } | null;
  rateOk: boolean;
  probeAvailable: boolean;
  validateResult: CouponValidationResult;
} = {
  user: null,
  rateOk: true,
  probeAvailable: true,
  validateResult: { valid: false, errorCode: 'COUPON_INVALID' },
};

vi.mock('@/lib/db/coupons', () => ({
  validateCoupon: vi.fn(async () => mockState.validateResult),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isCouponsAvailable: async () => mockState.probeAvailable,
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockState.user } }),
    },
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRate: vi.fn(async () =>
    mockState.rateOk ? { ok: true, remaining: 9 } : { ok: false, retryAfterSec: 30 },
  ),
}));

import { POST } from '@/app/api/coupons/validate/route';
import { validateCoupon } from '@/lib/db/coupons';
import { checkRate } from '@/lib/ratelimit';

const validateMock = vi.mocked(validateCoupon);
const checkRateMock = vi.mocked(checkRate);

async function call(body: unknown): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  // 테스트 환경(NODE_ENV !== 'production')에서는 Origin 부재가 same-origin 통과.
  const req = new Request('http://localhost/api/coupons/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const VALID: CouponValidationResult = {
  valid: true,
  couponId: asBrand<CouponId>('coupon-uuid-1'),
  code: 'WELCOME5',
  type: 'fixed',
  value: 5000,
  discount: 5000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.user = null;
  mockState.rateOk = true;
  mockState.probeAvailable = true;
  mockState.validateResult = { valid: false, errorCode: 'COUPON_INVALID' };
});

describe('POST /api/coupons/validate', () => {
  it('유효 쿠폰: valid=true + code/type/value/discount 를 내려준다', async () => {
    mockState.validateResult = VALID;
    const { status, body } = await call({ code: 'welcome5', subtotal: 30_000, payable: 33_000 });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      valid: true,
      code: 'WELCOME5',
      type: 'fixed',
      value: 5000,
      discount: 5000,
    });
    // couponId(내부 uuid)는 응답에 노출하지 않는다.
    expect('couponId' in body).toBe(false);
    expect(validateMock).toHaveBeenCalledWith('welcome5', 30_000, 33_000, null);
  });

  it('회원이면 세션 userId 로 검증한다(1인 1회 사전 판정)', async () => {
    mockState.user = { id: 'user-1' };
    mockState.validateResult = VALID;
    await call({ code: 'WELCOME5', subtotal: 30_000, payable: 33_000 });

    expect(validateMock).toHaveBeenCalledWith('WELCOME5', 30_000, 33_000, 'user-1');
    // 레이트리밋 키도 userId 우선.
    expect(checkRateMock).toHaveBeenCalledWith('coupon_validate', 'user-1', {
      max: 10,
      windowMs: 60_000,
    });
  });

  it('payable 미지정이면 subtotal 로 폴백한다(과소 표시 안전 방향)', async () => {
    mockState.validateResult = VALID;
    await call({ code: 'WELCOME5', subtotal: 30_000 });
    expect(validateMock).toHaveBeenCalledWith('WELCOME5', 30_000, 30_000, null);
  });

  it('무효 쿠폰: valid=false + errorCode (HTTP 200 — 요청 자체는 성공)', async () => {
    const { status, body } = await call({ code: 'NOPE99', subtotal: 30_000 });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, valid: false, errorCode: 'COUPON_INVALID' });
  });

  it('probe false(042 미적용)면 validateCoupon 을 호출하지 않고 COUPON_INVALID', async () => {
    mockState.probeAvailable = false;
    const { status, body } = await call({ code: 'WELCOME5', subtotal: 30_000 });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, valid: false, errorCode: 'COUPON_INVALID' });
    expect(validateMock).not.toHaveBeenCalled();
  });

  it('레이트리밋 초과 → 429 + Retry-After (코드 무차별 대입 차단)', async () => {
    mockState.rateOk = false;
    const req = new Request('http://localhost/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'WELCOME5', subtotal: 30_000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('subtotal 누락/짧은 코드는 422 BAD_INPUT', async () => {
    const noSubtotal = await call({ code: 'WELCOME5' });
    expect(noSubtotal.status).toBe(422);
    expect(noSubtotal.body).toMatchObject({ ok: false, code: 'BAD_INPUT' });

    const shortCode = await call({ code: 'A', subtotal: 30_000 });
    expect(shortCode.status).toBe(422);
  });

  it('JSON 파싱 실패는 400 BAD_JSON', async () => {
    const req = new Request('http://localhost/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
