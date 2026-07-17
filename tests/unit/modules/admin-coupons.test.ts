/**
 * admin/coupons — 폼 변환(bps) + 서버 액션 검증 (FS-X-05, ADR-026).
 *
 * 고정하는 계약:
 *  1. couponFormToInput: percent 폼 값은 % → bps(×100 반올림), fixed 는 원
 *     그대로. 빈 만료일/한도는 null(무기한/무제한), 빈 최소금액은 0.
 *  2. 변환 결과는 couponInputSchema 를 통과한다 — percent > 100%(10000bps)는
 *     superRefine 이 거부한다.
 *  3. saveCouponAction: requireAdmin 게이트 + zod 검증 후 X-01 upsertCoupon
 *     위임. deleteCouponAction 은 DB 계층의 사용 이력 거부 메시지를 그대로
 *     돌려준다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { CouponId, UserId } from '@/types/common';
import { couponInputSchema } from '@/types/coupon';
import type { Coupon } from '@/types/coupon';

vi.mock('@/lib/db/admin', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/db/coupons', () => ({
  upsertCoupon: vi.fn(),
  toggleCouponActive: vi.fn(),
  deleteCoupon: vi.fn(),
}));

// 액션은 각 경로에서 isCouponsAvailable 로 선제 게이트한다 — 기본 true(적용됨),
// probe 게이트 테스트에서만 false 로 뒤집는다.
vi.mock('@/lib/db/feature-probe', () => ({
  isCouponsAvailable: vi.fn(async () => true),
}));

import {
  bpsToPercent,
  couponFormToInput,
  couponValueLabel,
  percentToBps,
} from '@/app/admin/coupons/CouponsClient';
import type { CouponFormState } from '@/app/admin/coupons/CouponsClient';
import {
  deleteCouponAction,
  saveCouponAction,
  toggleCouponActiveAction,
} from '@/app/admin/coupons/actions';
import { requireAdmin } from '@/lib/db/admin';
import { deleteCoupon, toggleCouponActive, upsertCoupon } from '@/lib/db/coupons';
import { isCouponsAvailable } from '@/lib/db/feature-probe';

const requireAdminMock = vi.mocked(requireAdmin);
const upsertCouponMock = vi.mocked(upsertCoupon);
const toggleCouponActiveMock = vi.mocked(toggleCouponActive);
const deleteCouponMock = vi.mocked(deleteCoupon);
const isCouponsAvailableMock = vi.mocked(isCouponsAvailable);

const COUPON_UUID = '33333333-3333-4333-8333-333333333333';

function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: asBrand<CouponId>(COUPON_UUID),
    code: 'WELCOME10',
    type: 'percent',
    value: 1000,
    minSubtotal: 0,
    expiresAt: null,
    usageLimit: null,
    usedCount: 0,
    isActive: true,
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeForm(overrides: Partial<CouponFormState> = {}): CouponFormState {
  return {
    code: 'WELCOME10',
    type: 'percent',
    value: '10',
    minSubtotal: '0',
    expiresAt: '',
    usageLimit: '',
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    id: asBrand<UserId>('admin-1'),
    email: 'admin@example.com',
    role: 'admin',
  });
  // clearAllMocks 는 구현을 초기화하지 않지만, probe 게이트 테스트가 false 로
  // 뒤집은 값이 남지 않도록 매 테스트 기본값(적용됨)을 명시 복원한다.
  isCouponsAvailableMock.mockResolvedValue(true);
});

describe('couponFormToInput — bps 변환 (순수)', () => {
  it('percent: % 입력을 bps 로 변환한다 (10% → 1000bps, 소수 % 반올림)', () => {
    expect(couponFormToInput(makeForm({ value: '10' })).value).toBe(1000);
    expect(couponFormToInput(makeForm({ value: '0.5' })).value).toBe(50);
    expect(percentToBps(100)).toBe(10_000);
    expect(bpsToPercent(1000)).toBe(10);
  });

  it('fixed: 원 단위 그대로 (변환 없음)', () => {
    const input = couponFormToInput(
      makeForm({ type: 'fixed', value: '3000' }),
    );
    expect(input.value).toBe(3000);
  });

  it('빈 만료일/한도 → null(무기한/무제한), 빈 최소금액 → 0', () => {
    const input = couponFormToInput(
      makeForm({ expiresAt: '', usageLimit: '', minSubtotal: '' }),
    );
    expect(input.expiresAt).toBeNull();
    expect(input.usageLimit).toBeNull();
    expect(input.minSubtotal).toBe(0);
  });

  it('변환 결과가 couponInputSchema 를 통과하고, 100% 초과는 거부된다', () => {
    expect(
      couponInputSchema.safeParse(couponFormToInput(makeForm({ value: '100' })))
        .success,
    ).toBe(true);
    // 150% → 15000bps > 10000 — superRefine 거부.
    const over = couponInputSchema.safeParse(
      couponFormToInput(makeForm({ value: '150' })),
    );
    expect(over.success).toBe(false);
  });

  it('couponValueLabel: fixed 는 원, percent 는 %', () => {
    expect(couponValueLabel({ type: 'fixed', value: 3000 })).toBe('3,000원');
    expect(couponValueLabel({ type: 'percent', value: 1000 })).toBe('10%');
  });
});

describe('saveCouponAction', () => {
  it('유효 입력 → upsertCoupon 위임(bps 값 그대로) + 성공 반환', async () => {
    const saved = makeCoupon();
    upsertCouponMock.mockResolvedValue({ data: saved, error: null });

    const result = await saveCouponAction(couponFormToInput(makeForm()));
    expect(result.ok).toBe(true);
    expect(upsertCouponMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WELCOME10', type: 'percent', value: 1000 }),
    );
    if (result.ok) expect(result.coupon).toEqual(saved);
  });

  it('id 가 있으면 브랜드 id 로 수정 위임한다', async () => {
    upsertCouponMock.mockResolvedValue({ data: makeCoupon(), error: null });

    const result = await saveCouponAction({
      ...couponFormToInput(makeForm()),
      id: COUPON_UUID,
    });
    expect(result.ok).toBe(true);
    expect(upsertCouponMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: COUPON_UUID }),
    );
  });

  it('zod 검증 실패(percent 100% 초과) → 거부 + DB 미호출', async () => {
    const result = await saveCouponAction(
      couponFormToInput(makeForm({ value: '150' })),
    );
    expect(result.ok).toBe(false);
    expect(upsertCouponMock).not.toHaveBeenCalled();
  });

  it('비관리자 → 거부 + DB 미호출', async () => {
    requireAdminMock.mockRejectedValue(new Error('FORBIDDEN'));
    const result = await saveCouponAction(couponFormToInput(makeForm()));
    expect(result.ok).toBe(false);
    expect(upsertCouponMock).not.toHaveBeenCalled();
  });
});

describe('probe 게이트 (P2 — 042 미적용 창)', () => {
  it('isCouponsAvailable false → 세 액션 모두 명시 안내로 거부 + DB 미호출', async () => {
    isCouponsAvailableMock.mockResolvedValue(false);

    const save = await saveCouponAction(couponFormToInput(makeForm()));
    const toggle = await toggleCouponActiveAction(COUPON_UUID, false);
    const del = await deleteCouponAction(COUPON_UUID);

    for (const r of [save, toggle, del]) {
      expect(r.ok).toBe(false);
      // raw 42P01 이 아니라 "쿠폰 기능 …" 안내로 수렴한다.
      if (!r.ok) expect(r.error).toContain('쿠폰 기능');
    }
    expect(upsertCouponMock).not.toHaveBeenCalled();
    expect(toggleCouponActiveMock).not.toHaveBeenCalled();
    expect(deleteCouponMock).not.toHaveBeenCalled();
  });
});

describe('toggleCouponActiveAction / deleteCouponAction', () => {
  it('토글: 브랜드 id + isActive 로 위임한다', async () => {
    toggleCouponActiveMock.mockResolvedValue({
      data: makeCoupon({ isActive: false }),
      error: null,
    });
    const result = await toggleCouponActiveAction(COUPON_UUID, false);
    expect(result.ok).toBe(true);
    expect(toggleCouponActiveMock).toHaveBeenCalledWith(COUPON_UUID, false);
  });

  it('삭제: 사용 이력 거부 메시지를 그대로 반환한다', async () => {
    deleteCouponMock.mockResolvedValue({
      data: null,
      error: '사용 이력이 있는 쿠폰은 삭제할 수 없습니다. 비활성화를 사용하세요.',
    });
    const result = await deleteCouponAction(COUPON_UUID);
    expect(result).toEqual({
      ok: false,
      error: '사용 이력이 있는 쿠폰은 삭제할 수 없습니다. 비활성화를 사용하세요.',
    });
  });

  it('잘못된 id(uuid 아님) → DB 미호출 거부', async () => {
    const result = await deleteCouponAction('not-a-uuid');
    expect(result.ok).toBe(false);
    expect(deleteCouponMock).not.toHaveBeenCalled();
  });
});
