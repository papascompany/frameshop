/**
 * Checkout form types.
 *
 * Sources: docs/specs/checkout.md, ADR-008.
 *
 * FROZEN: 2026-05-12 by Architect.
 * FS-EC-00 (2026-07-03): 옵셔널 추가만 — redeemPoints / receipt* / agree*.
 *   기존 CheckoutClient 는 `useState<CheckoutFormData>` 리터럴로 폼을 만들므로
 *   신규 필드는 전부 옵셔널이어야 컴파일이 깨지지 않는다(FROZEN 무파손).
 *   약관 동의(agreePrivacy/agreePurchase)는 base 스키마가 아니라 별도의
 *   `checkoutAgreementsSchema` 로 강제한다(상위 검증 방식) — 새 체크아웃 UI 는
 *   submit 시 `checkoutFormSchema` + `checkoutAgreementsSchema` 를 **둘 다**
 *   통과시켜야 한다. base 에 refine 으로 넣으면 기존 폼/픽스처가 즉시 깨진다.
 */

import { z } from 'zod';
import { ordererSchema, CASH_RECEIPT_TYPES } from './order';
import { shippingMethodSchema } from './shipping';
import type { CashReceiptType, Orderer, ShippingAddress } from './order';
import type { ShippingMethod } from './shipping';

// ---------- Form data ----------

export type CheckoutFormData = {
  orderer: Orderer;
  shipping: ShippingAddress & {
    /** UI toggle: "same as orderer" copy. */
    sameAsOrderer: boolean;
  };
  shippingMethod: ShippingMethod;
  /**
   * FS-EC-00 optional additions — 전부 옵셔널(기존 폼 리터럴 무파손).
   * 미지정은 "기능 미사용/미노출"과 동일하게 취급한다.
   */
  /** 사용할 적립금(1 point = 1 KRW). 미지정/0 = 미사용. */
  redeemPoints?: number;
  /** 현금영수증 신청 토글. true 면 receiptType/receiptInfo 가 유효해야 한다. */
  receiptRequested?: boolean;
  receiptType?: CashReceiptType;
  /** 식별번호(숫자·하이픈, 8~20자) — receiptRequested 일 때만 검증. */
  receiptInfo?: string;
  /** 개인정보 수집·이용 동의 — checkoutAgreementsSchema 가 true 를 강제. */
  agreePrivacy?: boolean;
  /** 구매조건 확인·결제 진행 동의 — checkoutAgreementsSchema 가 true 를 강제. */
  agreePurchase?: boolean;
};

export type CheckoutValidation =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

// ---------- Postcode search (Phase 1 mock, Phase 2 Kakao) ----------

export type PostcodeResult = {
  zip: string;
  addr1: string;
};

// ---------- Zod schemas ----------

/**
 * PICKUP exempts shipping-address validation. Two parallel shipping schemas
 * (`pickup` vs `delivery`) are then discriminated by `shippingMethod` in
 * `superRefine` below.
 */
const shippingDeliverySchema = z.object({
  sameAsOrderer: z.boolean(),
  name: z.string().min(1).max(30),
  phone: z.string().regex(/^01[0-9]-\d{3,4}-\d{4}$/),
  zip: z.string().regex(/^\d{5}$/),
  addr1: z.string().min(1).max(100),
  addr2: z.string().max(80),
  memo: z.string().max(200),
});

const shippingPickupSchema = z.object({
  sameAsOrderer: z.boolean(),
  name: z.string().min(1).max(30),
  phone: z.string().regex(/^01[0-9]-\d{3,4}-\d{4}$/),
  zip: z.string().max(5), // empty allowed for PICKUP
  addr1: z.string().max(100),
  addr2: z.string().max(80),
  memo: z.string().max(200),
});

const shippingSchema = z.union([shippingDeliverySchema, shippingPickupSchema]);

/** 현금영수증 식별번호(숫자·하이픈만) — order.ts cashReceiptRequestSchema 와 동일 규칙. */
const RECEIPT_INFO_REGEX = /^[0-9-]+$/;

export const checkoutFormSchema = z
  .object({
    orderer: ordererSchema,
    shipping: shippingSchema,
    shippingMethod: shippingMethodSchema,
    // FS-EC-00 — 전부 optional: 레거시 폼 데이터(필드 부재)가 그대로 통과한다.
    redeemPoints: z.number().int().nonnegative().optional(),
    receiptRequested: z.boolean().optional(),
    receiptType: z.enum(CASH_RECEIPT_TYPES).optional(),
    receiptInfo: z.string().max(20).optional(),
    agreePrivacy: z.boolean().optional(),
    agreePurchase: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.shippingMethod !== 'PICKUP') {
      if (data.shipping.zip.length === 0 || !/^\d{5}$/.test(data.shipping.zip)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shipping', 'zip'],
          message: '우편번호 5자리를 입력해주세요',
        });
      }
      if (data.shipping.addr1.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shipping', 'addr1'],
          message: '주소를 입력해주세요',
        });
      }
    }
    // 현금영수증: 신청(true)일 때만 type/info 를 강제한다(미신청 폼 무파손).
    if (data.receiptRequested === true) {
      if (data.receiptType === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['receiptType'],
          message: '현금영수증 유형을 선택해주세요',
        });
      }
      const info = data.receiptInfo ?? '';
      if (info.length < 8 || info.length > 20 || !RECEIPT_INFO_REGEX.test(info)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['receiptInfo'],
          message: '숫자와 하이픈만 8~20자로 입력해주세요',
        });
      } else if (info.replace(/[^0-9]/g, '').length < 8) {
        // FS-EC P2-3: order.ts cashReceiptRequestSchema 와 동일 규칙 — 전부
        // 하이픈("--------") 등 숫자 8자리 미만 입력 차단.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['receiptInfo'],
          message: '숫자를 8자리 이상 입력해주세요',
        });
      }
    }
  });

export type ValidatedCheckoutForm = z.infer<typeof checkoutFormSchema>;

/**
 * 약관 동의 강제 스키마(상위 검증). 새 체크아웃 UI(구현 에이전트)는 submit 시
 * `checkoutFormSchema` 와 함께 이 스키마도 통과시켜야 한다. base 와 분리한 이유:
 * 기존 폼 리터럴/픽스처(agree 필드 부재)를 깨지 않기 위함(FS-EC-00 결정).
 */
export const checkoutAgreementsSchema = z
  .object({
    agreePrivacy: z.boolean().optional(),
    agreePurchase: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.agreePrivacy !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agreePrivacy'],
        message: '개인정보 수집·이용에 동의해주세요',
      });
    }
    if (data.agreePurchase !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agreePurchase'],
        message: '구매조건 확인 및 결제 진행에 동의해주세요',
      });
    }
  });

export const postcodeResultSchema = z.object({
  zip: z.string().regex(/^\d{5}$/),
  addr1: z.string().min(1).max(100),
});
