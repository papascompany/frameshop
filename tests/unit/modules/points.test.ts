/**
 * calcEarnPoints / maxRedeemable — 적립금 순수 함수 (FS-EC-00).
 *
 * 근거: migration 031 (1 point = 1 KRW, 정수), src/types/points.ts 정책 상수
 * (POINTS_EARN_RATE_BPS = 100 → 1%, POINTS_MIN_PAYABLE = 100).
 */

import { describe, expect, it } from 'vitest';
import {
  POINTS_EARN_RATE_BPS,
  POINTS_MIN_PAYABLE,
  calcEarnPoints,
  maxRedeemable,
} from '@/types/points';

describe('policy constants', () => {
  it('earn rate is 1% (100 bps) and min payable is 100 KRW', () => {
    expect(POINTS_EARN_RATE_BPS).toBe(100);
    expect(POINTS_MIN_PAYABLE).toBe(100);
  });
});

describe('calcEarnPoints', () => {
  it('earns 1% of the paid total', () => {
    expect(calcEarnPoints(10_000)).toBe(100);
    expect(calcEarnPoints(45_000)).toBe(450);
  });

  it('floors fractional points (never rounds up)', () => {
    expect(calcEarnPoints(9_999)).toBe(99);
    expect(calcEarnPoints(99)).toBe(0);
    expect(calcEarnPoints(101)).toBe(1);
  });

  it('returns 0 for zero/negative/non-finite input', () => {
    expect(calcEarnPoints(0)).toBe(0);
    expect(calcEarnPoints(-5_000)).toBe(0);
    expect(calcEarnPoints(Number.NaN)).toBe(0);
    expect(calcEarnPoints(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('maxRedeemable', () => {
  it('is capped by the balance when the balance is the smaller bound', () => {
    expect(maxRedeemable(500, 10_000)).toBe(500);
  });

  it('is capped by payable minus the minimum payable amount', () => {
    // 잔액이 커도 결제액 100원은 남겨야 한다(0원 결제 방지).
    expect(maxRedeemable(50_000, 10_000)).toBe(9_900);
    expect(maxRedeemable(10_000, 10_000)).toBe(9_900);
  });

  it('returns 0 when payable is at or below the minimum payable', () => {
    expect(maxRedeemable(5_000, 100)).toBe(0);
    expect(maxRedeemable(5_000, 50)).toBe(0);
    expect(maxRedeemable(5_000, 0)).toBe(0);
  });

  it('returns 0 for zero balance or non-finite input', () => {
    expect(maxRedeemable(0, 10_000)).toBe(0);
    expect(maxRedeemable(Number.NaN, 10_000)).toBe(0);
    expect(maxRedeemable(1_000, Number.NaN)).toBe(0);
  });
});
