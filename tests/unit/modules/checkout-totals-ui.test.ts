/**
 * FS-EC-01 UT — 체크아웃 합계 순수 헬퍼.
 *
 *  - computeSurchargeFee: zip 권역 판정 + 배송방법별 추가배송비 표시 계산
 *    (backend 재계산과 같은 공용 함수 `@/lib/shipping/surcharge` 소비 확인).
 *  - clampRedeem: 적립금 입력 clamp (잔액·최소결제액 100원 상한).
 *  - computeCheckoutTotals: 상품합계 + 배송비 + 추가배송비 − 적립금 = 최종액.
 */

import { describe, expect, it } from 'vitest';
import {
  clampRedeem,
  computeCheckoutTotals,
  computeSurchargeFee,
} from '@/app/(shop)/checkout/checkout-totals';
import type { SurchargeMethodConfig } from '@/app/(shop)/checkout/checkout-totals';

const STANDARD: SurchargeMethodConfig = {
  code: 'STANDARD',
  surchargeFeeJeju: 3000,
  surchargeFeeRemote: 5000,
};

describe('computeSurchargeFee (표시 계산)', () => {
  it('제주 우편번호(63xxx) + STANDARD → 제주 추가비', () => {
    expect(computeSurchargeFee('63001', STANDARD)).toBe(3000);
    expect(computeSurchargeFee('63644', STANDARD)).toBe(3000);
  });

  it('도서산간 우편번호(울릉·백령) + STANDARD → 도서산간 추가비', () => {
    expect(computeSurchargeFee('40200', STANDARD)).toBe(5000);
    expect(computeSurchargeFee('23004', STANDARD)).toBe(5000);
  });

  it('내륙/빈 zip → 0 (PICKUP 의 빈 zip 포함)', () => {
    expect(computeSurchargeFee('06236', STANDARD)).toBe(0);
    expect(computeSurchargeFee('', STANDARD)).toBe(0);
  });

  it('PICKUP/QUICK 은 항상 0 (030 규칙)', () => {
    expect(
      computeSurchargeFee('63001', { ...STANDARD, code: 'PICKUP' }),
    ).toBe(0);
    expect(
      computeSurchargeFee('63001', { ...STANDARD, code: 'QUICK' }),
    ).toBe(0);
  });

  it('설정 미로드(null)/030 미적용(필드 부재) → 0 (graceful)', () => {
    expect(computeSurchargeFee('63001', null)).toBe(0);
    expect(computeSurchargeFee('63001', { code: 'STANDARD' })).toBe(0);
  });
});

describe('clampRedeem (적립금 입력 clamp)', () => {
  it('상한 내 입력은 그대로 (소수는 내림)', () => {
    expect(clampRedeem(500, 1_000, 10_000)).toBe(500);
    expect(clampRedeem(500.9, 1_000, 10_000)).toBe(500);
  });

  it('잔액을 초과하면 잔액으로 clamp', () => {
    expect(clampRedeem(99_999, 1_000, 10_000)).toBe(1_000);
  });

  it('최소 결제액 100원이 남도록 payable − 100 으로 clamp', () => {
    expect(clampRedeem(10_000, 50_000, 10_000)).toBe(9_900);
    // payable 이 100원 이하면 사용 불가
    expect(clampRedeem(50, 50_000, 100)).toBe(0);
  });

  it('비정상 입력(0/음수/NaN/Infinity) → 0', () => {
    expect(clampRedeem(0, 1_000, 10_000)).toBe(0);
    expect(clampRedeem(-5, 1_000, 10_000)).toBe(0);
    expect(clampRedeem(Number.NaN, 1_000, 10_000)).toBe(0);
    expect(clampRedeem(Number.POSITIVE_INFINITY, 1_000, 10_000)).toBe(0);
  });
});

describe('computeCheckoutTotals (합계 계약 §6)', () => {
  it('상품합계 + 배송비 + 추가배송비 − 적립금 = 최종 결제액', () => {
    const totals = computeCheckoutTotals({
      subtotal: 30_000,
      shippingFee: 3_000,
      surchargeFee: 3_000,
      desiredRedeem: 40_000,
      points: { balance: 5_000, available: true },
    });
    expect(totals.payable).toBe(36_000);
    expect(totals.redeemApplied).toBe(5_000); // 잔액 상한
    expect(totals.total).toBe(31_000);
  });

  it('잔액이 커도 최소 결제액 100원이 남는다', () => {
    const totals = computeCheckoutTotals({
      subtotal: 30_000,
      shippingFee: 3_000,
      surchargeFee: 3_000,
      desiredRedeem: 100_000,
      points: { balance: 100_000, available: true },
    });
    expect(totals.redeemApplied).toBe(35_900);
    expect(totals.total).toBe(100);
  });

  it('포인트 미가용(비로그인/031 미적용)이면 redeem 은 항상 0', () => {
    const totals = computeCheckoutTotals({
      subtotal: 30_000,
      shippingFee: 3_000,
      surchargeFee: 0,
      desiredRedeem: 5_000,
      points: { balance: 0, available: false },
    });
    expect(totals.redeemApplied).toBe(0);
    expect(totals.total).toBe(33_000);
  });

  it('payable 이 줄면 파생 계산이 자동 재-clamp (배송방법 변경 시나리오)', () => {
    // STANDARD(36,000) 에서 5,000P 사용 중 → PICKUP(5,000) 으로 변경
    const totals = computeCheckoutTotals({
      subtotal: 5_000,
      shippingFee: 0,
      surchargeFee: 0,
      desiredRedeem: 5_000,
      points: { balance: 5_000, available: true },
    });
    expect(totals.redeemApplied).toBe(4_900);
    expect(totals.total).toBe(100);
  });
});
