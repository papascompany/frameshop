/**
 * 체크아웃 합계 — 쿠폰 확장 (FS-X-04, ADR-026 §3).
 *
 * 고정하는 계약:
 *  - subtotal + shipping + surcharge − 쿠폰할인 − 적립금 = total.
 *  - 쿠폰할인은 공용 순수 함수(calcCouponDiscount)와 동일: fixed = min(value,
 *    payable), percent = min(floor(subtotal × bps / 10000), payable).
 *  - redeem 상한(maxRedeemable)은 쿠폰 반영 **후** payable 기준으로 재계산.
 *  - coupon 미지정 = 기존 FS-EC-01 계약 그대로(회귀 0).
 */

import { describe, expect, it } from 'vitest';
import { computeCheckoutTotals } from '@/app/(shop)/checkout/checkout-totals';

const POINTS_OFF = { balance: 0, available: false };

describe('computeCheckoutTotals — 쿠폰 (ADR-026 §3)', () => {
  it('fixed 쿠폰: payable 에서 정액 차감', () => {
    const totals = computeCheckoutTotals({
      subtotal: 30_000,
      shippingFee: 3_000,
      surchargeFee: 0,
      desiredRedeem: 0,
      points: POINTS_OFF,
      coupon: { type: 'fixed', value: 5_000 },
    });
    expect(totals.payable).toBe(33_000);
    expect(totals.couponDiscount).toBe(5_000);
    expect(totals.payableAfterCoupon).toBe(28_000);
    expect(totals.total).toBe(28_000);
  });

  it('percent 쿠폰: subtotal 기준 bps 계산(배송비에는 미적용)', () => {
    const totals = computeCheckoutTotals({
      subtotal: 30_000,
      shippingFee: 3_000,
      surchargeFee: 3_000,
      desiredRedeem: 0,
      points: POINTS_OFF,
      coupon: { type: 'percent', value: 1_000 }, // 10%
    });
    // floor(30000 × 1000 / 10000) = 3000 — 배송비 6000원은 계산 기준에서 제외.
    expect(totals.couponDiscount).toBe(3_000);
    expect(totals.total).toBe(33_000);
  });

  it('fixed 쿠폰 할인은 payable − 최소결제액 상한으로 클램프(0원 결제 방지, P1-3)', () => {
    const totals = computeCheckoutTotals({
      subtotal: 3_000,
      shippingFee: 0,
      surchargeFee: 0,
      desiredRedeem: 0,
      points: POINTS_OFF,
      coupon: { type: 'fixed', value: 50_000 },
    });
    // cap = payable(3,000) − 100 = 2,900 → 최소 결제액 100 이 남는다.
    expect(totals.couponDiscount).toBe(2_900);
    expect(totals.total).toBe(100);
  });

  it('쿠폰 + 적립금 병행: redeem 상한이 쿠폰 반영 payable 기준으로 재계산된다', () => {
    // payable 36,000 − 쿠폰 6,000 = 30,000 → 최소결제 100원 → redeem 최대 29,900.
    const totals = computeCheckoutTotals({
      subtotal: 30_000,
      shippingFee: 3_000,
      surchargeFee: 3_000,
      desiredRedeem: 100_000,
      points: { balance: 100_000, available: true },
      coupon: { type: 'fixed', value: 6_000 },
    });
    expect(totals.couponDiscount).toBe(6_000);
    expect(totals.payableAfterCoupon).toBe(30_000);
    expect(totals.redeemApplied).toBe(29_900); // 쿠폰 미반영이면 35,900 이었을 값
    expect(totals.total).toBe(100);
  });

  it('쿠폰이 payable 을 (최소결제액 남기고) 소진하면 redeem 은 0 (병행 경계)', () => {
    const totals = computeCheckoutTotals({
      subtotal: 5_000,
      shippingFee: 0,
      surchargeFee: 0,
      desiredRedeem: 1_000,
      points: { balance: 1_000, available: true },
      coupon: { type: 'fixed', value: 5_000 },
    });
    // cap = 5,000 − 100 = 4,900 → payableAfterCoupon 100 → redeem 상한 0.
    expect(totals.couponDiscount).toBe(4_900);
    expect(totals.redeemApplied).toBe(0);
    expect(totals.total).toBe(100);
  });

  it('coupon 미지정/null 은 기존 FS-EC-01 계약 그대로 (couponDiscount 0)', () => {
    const legacy = computeCheckoutTotals({
      subtotal: 30_000,
      shippingFee: 3_000,
      surchargeFee: 3_000,
      desiredRedeem: 40_000,
      points: { balance: 5_000, available: true },
    });
    expect(legacy.couponDiscount).toBe(0);
    expect(legacy.payableAfterCoupon).toBe(legacy.payable);
    expect(legacy.payable).toBe(36_000);
    expect(legacy.redeemApplied).toBe(5_000);
    expect(legacy.total).toBe(31_000);

    const explicitNull = computeCheckoutTotals({
      subtotal: 30_000,
      shippingFee: 3_000,
      surchargeFee: 3_000,
      desiredRedeem: 40_000,
      points: { balance: 5_000, available: true },
      coupon: null,
    });
    expect(explicitNull).toEqual(legacy);
  });
});
