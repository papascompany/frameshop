/**
 * FS-X-00 입력 스키마 검증 — coupon/inquiry (+ bundle rule refine).
 *
 * 근거: src/types/coupon.ts couponInputSchema(어드민 CRUD), src/types/inquiry.ts
 * inquiryInputSchema(/api/account/inquiries), src/types/set.ts
 * bundleRuleInputSchema(전략별 필수값 superRefine).
 */

import { describe, expect, it } from 'vitest';
import { couponInputSchema } from '@/types/coupon';
import { inquiryInputSchema } from '@/types/inquiry';
import { bundleRuleInputSchema } from '@/types/set';

describe('couponInputSchema', () => {
  it('accepts a valid fixed/percent coupon input', () => {
    expect(
      couponInputSchema.safeParse({
        code: 'WELCOME10',
        type: 'fixed',
        value: 3_000,
        minSubtotal: 30_000,
        expiresAt: '2026-12-31T23:59:59+09:00',
        usageLimit: 100,
        isActive: true,
      }).success,
    ).toBe(true);
    expect(
      couponInputSchema.safeParse({ code: 'launch-2026', type: 'percent', value: 1_000 })
        .success,
    ).toBe(true);
  });

  it('rejects percent over 10000bps, non-positive value, and bad code/date', () => {
    expect(
      couponInputSchema.safeParse({ code: 'OVER', type: 'percent', value: 10_001 }).success,
    ).toBe(false);
    expect(
      couponInputSchema.safeParse({ code: 'ZERO', type: 'fixed', value: 0 }).success,
    ).toBe(false);
    expect(
      couponInputSchema.safeParse({ code: '한글쿠폰', type: 'fixed', value: 1_000 }).success,
    ).toBe(false);
    expect(
      couponInputSchema.safeParse({
        code: 'BADDATE',
        type: 'fixed',
        value: 1_000,
        expiresAt: 'not-a-date',
      }).success,
    ).toBe(false);
  });
});

describe('inquiryInputSchema', () => {
  it('accepts a valid inquiry (optional refs omitted or uuid)', () => {
    expect(
      inquiryInputSchema.safeParse({
        contactEmail: 'user@example.com',
        subject: '배송 문의드립니다',
        body: '주문한 액자가 언제 도착하나요?',
      }).success,
    ).toBe(true);
    expect(
      inquiryInputSchema.safeParse({
        orderId: '33333333-3333-4333-8333-333333333333',
        productId: '22222222-2222-4222-8222-222222222222',
        contactEmail: 'user@example.com',
        category: '배송',
        subject: '주문 관련',
        body: '문의 내용',
      }).success,
    ).toBe(true);
  });

  it('rejects empty subject, invalid email, non-uuid refs, and overlong body', () => {
    const base = {
      contactEmail: 'user@example.com',
      subject: '제목',
      body: '내용',
    };
    expect(inquiryInputSchema.safeParse({ ...base, subject: '' }).success).toBe(false);
    expect(
      inquiryInputSchema.safeParse({ ...base, contactEmail: 'not-an-email' }).success,
    ).toBe(false);
    expect(inquiryInputSchema.safeParse({ ...base, orderId: 'order-1' }).success).toBe(false);
    expect(
      inquiryInputSchema.safeParse({ ...base, body: 'x'.repeat(2_001) }).success,
    ).toBe(false);
  });
});

describe('bundleRuleInputSchema (전략별 필수값)', () => {
  const base = {
    productId: '22222222-2222-4222-8222-222222222222',
    minSlots: 2,
    maxSlots: 6,
    allowedSizeCodes: [],
    allowedOrientations: [],
    allowSizeMix: true,
    allowOrientationMix: true,
    allowPhotoReuse: true,
  };

  it('accepts sum without discount fields and enforces strategy-specific fields', () => {
    expect(
      bundleRuleInputSchema.safeParse({ ...base, pricingStrategy: 'sum' }).success,
    ).toBe(true);
    expect(
      bundleRuleInputSchema.safeParse({
        ...base,
        pricingStrategy: 'sum_with_discount',
        discountBps: 500,
      }).success,
    ).toBe(true);
    // sum_with_discount 인데 discountBps 없음 / flat 인데 flatPrice 없음 → 거부.
    expect(
      bundleRuleInputSchema.safeParse({ ...base, pricingStrategy: 'sum_with_discount' })
        .success,
    ).toBe(false);
    expect(
      bundleRuleInputSchema.safeParse({ ...base, pricingStrategy: 'flat' }).success,
    ).toBe(false);
  });

  it('rejects maxSlots < minSlots', () => {
    expect(
      bundleRuleInputSchema.safeParse({
        ...base,
        minSlots: 4,
        maxSlots: 2,
        pricingStrategy: 'sum',
      }).success,
    ).toBe(false);
  });
});
