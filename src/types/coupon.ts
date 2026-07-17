/**
 * 쿠폰(coupons / coupon_redemptions) 도메인 타입.
 *
 * DB 근거: migration 042. 결정: ADR-026 (FS-X-00 계약 동결 — 쿠폰 정책 전문).
 *
 * 정책 요지(ADR-026):
 * - type: 'fixed'(value = KRW 정액) | 'percent'(value = bps, subtotal 기준).
 * - 할인 순서: subtotal + shipping + surcharge − 쿠폰할인 − 적립금 = totalPrice
 *   (net 저장, 031 계약 유지). 할인 상한 = payable(음수 방지).
 * - 전체 usage_limit 는 조건부 UPDATE 원자 차감, 회원 1인 1회는
 *   coupon_redemptions UNIQUE(coupon_id, user_id). 비회원은 미기록(전체 한도만).
 * - coupons SELECT 는 service-role 전용(코드 열거 방지) — 검증은 서버 API 경유.
 *
 * 순수 계산(calcCouponDiscount/normalizeCouponCode)은 src/lib/coupon/calc.ts.
 * 이 파일은 순수 타입 + zod 스키마만 담는다(클라/서버 공용, server-only 금지).
 *
 * FROZEN(옵셔널/추가 전용): 2026-07-17 by Architect (FS-X-00).
 */

import { z } from 'zod';
import type { CouponId, IsoTimestamp } from './common';

// ---------- Enums / unions ----------

/** coupons.type CHECK 와 1:1. */
export const COUPON_TYPES = ['fixed', 'percent'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/**
 * 쿠폰 검증 실패 코드(ADR-026 — /api 422 매핑).
 * - COUPON_INVALID: 부재/비활성/만료/최소금액 미달
 * - COUPON_EXHAUSTED: 전체 사용 한도 소진
 * - COUPON_ALREADY_USED: 회원 재사용(1인 1회 위반)
 */
export const COUPON_ERROR_CODES = [
  'COUPON_INVALID',
  'COUPON_EXHAUSTED',
  'COUPON_ALREADY_USED',
] as const;
export type CouponErrorCode = (typeof COUPON_ERROR_CODES)[number];

// ---------- Domain types ----------

/** coupons 1행 (camelCase 도메인 뷰). */
export type Coupon = {
  id: CouponId;
  /** 대문자 정규화 코드(normalizeCouponCode 적용 후 저장 — DB CHECK 동일). */
  code: string;
  type: CouponType;
  /** fixed = KRW(원), percent = bps(10000 = 100%). 항상 > 0. */
  value: number;
  /** 적용 최소 주문 상품합계(KRW). 0 = 제한 없음. */
  minSubtotal: number;
  /** NULL = 무기한. */
  expiresAt: IsoTimestamp | null;
  /** 전체 사용 한도. NULL = 무제한. */
  usageLimit: number | null;
  /** 사용 누계(조건부 UPDATE 원자 차감 대상). */
  usedCount: number;
  isActive: boolean;
  createdAt: IsoTimestamp;
};

/**
 * 서버 쿠폰 검증 결과(validate API·createOrder 공용 계약).
 * valid=true 면 discount 는 calcCouponDiscount 로 계산된 확정 할인액(KRW).
 */
export type CouponValidationResult =
  | {
      valid: true;
      couponId: CouponId;
      /** 정규화된 코드 — orders.coupon_code 스냅샷에 그대로 기록. */
      code: string;
      type: CouponType;
      value: number;
      /** 확정 할인액(KRW, 0 < discount <= payable). */
      discount: number;
    }
  | {
      valid: false;
      errorCode: CouponErrorCode;
    };

// ---------- Zod schemas ----------

export const couponTypeSchema = z.enum(COUPON_TYPES);
export const couponErrorCodeSchema = z.enum(COUPON_ERROR_CODES);

/**
 * 어드민 CRUD 입력(admin/coupons actions). code 는 영숫자·하이픈·언더스코어
 * 2~30자 — 서버가 normalizeCouponCode(trim+대문자)로 정규화 후 저장한다
 * (DB CHECK `code = upper(btrim(code))` 와 정합). percent 는 value <= 10000
 * (100% 초과 금지)을 superRefine 으로 강제.
 */
export const couponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, '영문/숫자/하이픈/언더스코어만 사용할 수 있습니다'),
    type: couponTypeSchema,
    value: z.number().int().positive(),
    minSubtotal: z.number().int().nonnegative().optional(),
    /** ISO 파싱 가능한 날짜 문자열(어드민 폼의 date/datetime 입력 수용). */
    expiresAt: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), {
        message: '날짜 형식이 올바르지 않습니다',
      })
      .nullable()
      .optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'percent' && v.value > 10_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'percent 쿠폰의 value 는 10000bps(100%)를 넘을 수 없습니다',
      });
    }
  });

export type CouponInput = z.infer<typeof couponInputSchema>;

/** 체크아웃 쿠폰 적용 입력(/api/coupons/validate). 정규화 전 원문 코드. */
export const couponApplyInputSchema = z.object({
  code: z.string().trim().min(2).max(30),
});

export type CouponApplyInput = z.infer<typeof couponApplyInputSchema>;
