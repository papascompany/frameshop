/**
 * calcCouponDiscount / normalizeCouponCode — 쿠폰 순수 계산 (FS-X-00, ADR-026).
 *
 * 정책: fixed = min(value, cap), percent = min(floor(subtotal × value / 10000),
 * cap), 음수/비유한/비정상 입력은 0. 상한 cap = max(0, payable −
 * POINTS_MIN_PAYABLE) — 쿠폰만으로 0원 결제가 되는 것을 막아 최소 결제액을
 * 남긴다(FS-X-FIX-A P1-3, 적립금 maxRedeemable 과 동일 정책).
 */

import { describe, expect, it } from 'vitest';
import { calcCouponDiscount, normalizeCouponCode } from '@/lib/coupon/calc';

describe('calcCouponDiscount — fixed', () => {
  it('discounts the fixed value when payable covers it', () => {
    expect(calcCouponDiscount({ type: 'fixed', value: 3_000 }, 50_000, 53_000)).toBe(3_000);
  });

  it('is capped by payable − 최소결제액 (leaves POINTS_MIN_PAYABLE)', () => {
    // cap = payable(13,000) − 100 = 12,900. value 30,000 이 상한을 넘어 12,900.
    expect(calcCouponDiscount({ type: 'fixed', value: 30_000 }, 10_000, 13_000)).toBe(12_900);
    // cap = 10,000 − 100 = 9,900. value 10,000 이 상한을 넘어 9,900.
    expect(calcCouponDiscount({ type: 'fixed', value: 10_000 }, 10_000, 10_000)).toBe(9_900);
  });
});

describe('calcCouponDiscount — percent (bps, subtotal 기준)', () => {
  it('discounts floor(subtotal × bps / 10000)', () => {
    // 10% of 45,000 = 4,500 (payable 은 배송비 포함이라 더 큼 — 상한 미도달).
    expect(calcCouponDiscount({ type: 'percent', value: 1_000 }, 45_000, 48_000)).toBe(4_500);
    // floor: 1% of 9,999 = 99.99 → 99.
    expect(calcCouponDiscount({ type: 'percent', value: 100 }, 9_999, 12_999)).toBe(99);
  });

  it('is capped by payable − 최소결제액 even when the subtotal-based discount is larger', () => {
    // 50% of 100,000 = 50,000 이지만 cap = payable(20,000) − 100 = 19,900 까지만.
    expect(calcCouponDiscount({ type: 'percent', value: 5_000 }, 100_000, 20_000)).toBe(19_900);
  });
});

describe('calcCouponDiscount — 최소결제액 보장 (FS-X-FIX-A P1-3)', () => {
  it('fixed: 소액 주문에서도 payable − discount >= 100 (0원 결제 방지)', () => {
    // payable 3,000 · fixed 50,000 → cap 2,900 → discount 2,900 → 잔액 100.
    const discount = calcCouponDiscount({ type: 'fixed', value: 50_000 }, 3_000, 3_000);
    expect(discount).toBe(2_900);
    expect(3_000 - discount).toBeGreaterThanOrEqual(100);
  });

  it('percent: 소액 주문에서도 payable − discount >= 100 (0원 결제 방지)', () => {
    // payable 5,000 · 100% → subtotal 기준 5,000 이지만 cap 4,900 → 잔액 100.
    const discount = calcCouponDiscount({ type: 'percent', value: 10_000 }, 5_000, 5_000);
    expect(discount).toBe(4_900);
    expect(5_000 - discount).toBeGreaterThanOrEqual(100);
  });

  it('payable 이 최소결제액 이하이면 할인 0 (cap 0)', () => {
    expect(calcCouponDiscount({ type: 'fixed', value: 5_000 }, 100, 100)).toBe(0);
    expect(calcCouponDiscount({ type: 'fixed', value: 5_000 }, 50, 50)).toBe(0);
  });
});

describe('calcCouponDiscount — 비정상 입력은 0 (fail-safe)', () => {
  it('returns 0 for non-positive or non-finite coupon value', () => {
    expect(calcCouponDiscount({ type: 'fixed', value: 0 }, 10_000, 13_000)).toBe(0);
    expect(calcCouponDiscount({ type: 'fixed', value: -500 }, 10_000, 13_000)).toBe(0);
    expect(calcCouponDiscount({ type: 'percent', value: Number.NaN }, 10_000, 13_000)).toBe(0);
    expect(
      calcCouponDiscount({ type: 'fixed', value: Number.POSITIVE_INFINITY }, 10_000, 13_000),
    ).toBe(0);
  });

  it('returns 0 for zero/negative payable and clamps negative subtotal to 0', () => {
    expect(calcCouponDiscount({ type: 'fixed', value: 3_000 }, 10_000, 0)).toBe(0);
    expect(calcCouponDiscount({ type: 'percent', value: 1_000 }, 10_000, -5_000)).toBe(0);
    expect(calcCouponDiscount({ type: 'percent', value: 1_000 }, -10_000, 13_000)).toBe(0);
    expect(calcCouponDiscount({ type: 'percent', value: 1_000 }, Number.NaN, 13_000)).toBe(0);
  });
});

describe('normalizeCouponCode', () => {
  it('trims whitespace and uppercases', () => {
    expect(normalizeCouponCode('  welcome10 ')).toBe('WELCOME10');
    expect(normalizeCouponCode('Launch-2026')).toBe('LAUNCH-2026');
    expect(normalizeCouponCode('ALREADY')).toBe('ALREADY');
  });
});
