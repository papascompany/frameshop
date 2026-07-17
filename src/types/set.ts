/**
 * 세트 템플릿(set_templates) + 구성 규칙(bundle_rules) 도메인 타입.
 *
 * DB 근거: migration 036 (set_templates), 037 (bundle_rules).
 * 설계 SSOT: docs/specs/extended-product.md §4. 결정: ADR-026 (FS-X-00 계약 동결).
 *
 * - SetTemplate = 어드민이 정의하는 세트 구성 프리셋. slots jsonb 의 각 슬롯에
 *   slotPos(mm 좌표)가 있으면 벽모드, 없으면 그리드모드로 렌더한다.
 * - BundleRule = 상품 1:1 구성 검증/가격 규칙(클라+서버 공통 검증 SSOT).
 *   ADR-026: 세트가 재계산·할인 적용(createOrder)은 보류 — 이번 웨이브는
 *   폼·저장·타입까지만 구현한다.
 *
 * 이 파일은 순수 타입 + zod 스키마만 담는다(클라/서버 공용, server-only 금지).
 * 의존 방향(순환 없음): set.ts → project.ts / common. project.ts 는 set.ts 를
 * 참조하지 않는다.
 *
 * FROZEN(옵셔널/추가 전용): 2026-07-17 by Architect (FS-X-00).
 */

import { z } from 'zod';
import { orientationSchema, type Orientation } from './project';
import type {
  BundleRuleId,
  IsoTimestamp,
  ProductId,
  SetTemplateId,
} from './common';

// ---------- Enums / unions ----------

/** bundle_rules.pricing_strategy CHECK 와 1:1. */
export const PRICING_STRATEGIES = ['sum', 'sum_with_discount', 'flat'] as const;
export type PricingStrategy = (typeof PRICING_STRATEGIES)[number];

// ---------- Domain types ----------

/** 벽모드 슬롯 좌표(mm). 원점은 벽 좌상단, wMm/hMm 는 프레임 외곽 실측. */
export type SlotPosMm = {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
};

/**
 * set_templates.slots jsonb 배열의 한 항목.
 * slotPos 有 = 벽모드(WallCanvas 미니맵 좌표 배치), 無 = 그리드모드.
 */
export type SetTemplateSlot = {
  /** 0-base 슬롯 순번(표시/할당 순서). */
  slotIndex: number;
  /** variant sizeCode (product.ts SelectedOptions.sizeCode 어휘와 동일). */
  sizeCode: string;
  orientation: Orientation;
  slotPos?: SlotPosMm;
};

/** set_templates 1행 (camelCase 도메인 뷰). */
export type SetTemplate = {
  id: SetTemplateId;
  productId: ProductId;
  name: string;
  slots: SetTemplateSlot[];
  /** 벽모드 벽 치수(mm). NULL = 그리드모드(슬롯 좌표 없음). */
  wallWMm: number | null;
  wallHMm: number | null;
  /** 세트 정가(KRW, flat). NULL = 미사용(합산/할인 경로). */
  setPrice: number | null;
  /** 세트 할인(bps, 10000 = 100%). NULL = 미사용. */
  setDiscountBps: number | null;
  isActive: boolean;
  createdAt: IsoTimestamp;
};

/**
 * bundle_rules 1행 (camelCase 도메인 뷰). product 1:1.
 * allowedSizeCodes/allowedOrientations 빈 배열 = 제한 없음(전체 허용).
 */
export type BundleRule = {
  id: BundleRuleId;
  productId: ProductId;
  minSlots: number;
  maxSlots: number;
  allowedSizeCodes: string[];
  allowedOrientations: Orientation[];
  allowSizeMix: boolean;
  allowOrientationMix: boolean;
  allowPhotoReuse: boolean;
  pricingStrategy: PricingStrategy;
  /** sum_with_discount 전용(bps). 그 외 전략에선 NULL. */
  discountBps: number | null;
  /** flat 전용(KRW). 그 외 전략에선 NULL. */
  flatPrice: number | null;
  isActive: boolean;
  createdAt: IsoTimestamp;
};

// ---------- Zod schemas ----------

export const pricingStrategySchema = z.enum(PRICING_STRATEGIES);

/**
 * mm 좌표: 0 이상, 상한 100,000mm(100m) — 오입력/오버플로 가드일 뿐 정책 아님.
 * 폭/높이는 1mm 이상(0 크기 슬롯 금지).
 */
export const slotPosMmSchema = z.object({
  xMm: z.number().min(0).max(100_000),
  yMm: z.number().min(0).max(100_000),
  wMm: z.number().min(1).max(100_000),
  hMm: z.number().min(1).max(100_000),
});

export const setTemplateSlotSchema = z.object({
  slotIndex: z.number().int().nonnegative().max(9_999),
  sizeCode: z.string().min(1).max(40),
  orientation: orientationSchema,
  slotPos: slotPosMmSchema.optional(),
});

/**
 * 어드민 CRUD 입력(upsertSetTemplate). id 없음 = 생성. 슬롯 1~50개(가드레일).
 * setPrice/setDiscountBps 는 상호 배타 강제하지 않음 — 적용 전략은 bundle_rules
 * pricing_strategy 가 결정하고, 세트가 적용 자체가 ADR-026 보류 상태.
 */
export const setTemplateInputSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1).max(60),
  slots: z.array(setTemplateSlotSchema).min(1).max(50),
  wallWMm: z.number().int().min(1).max(100_000).nullable().optional(),
  wallHMm: z.number().int().min(1).max(100_000).nullable().optional(),
  setPrice: z.number().int().nonnegative().nullable().optional(),
  setDiscountBps: z.number().int().min(0).max(10_000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type SetTemplateInput = z.infer<typeof setTemplateInputSchema>;

/**
 * 어드민 CRUD 입력(upsertBundleRule). product 1:1 이므로 productId 가 upsert 키.
 * 전략별 필수값은 superRefine 으로 강제(sum_with_discount → discountBps,
 * flat → flatPrice).
 */
export const bundleRuleInputSchema = z
  .object({
    productId: z.string().uuid(),
    minSlots: z.number().int().min(1).max(50),
    maxSlots: z.number().int().min(1).max(50),
    allowedSizeCodes: z.array(z.string().min(1).max(40)).max(50),
    allowedOrientations: z.array(orientationSchema).max(2),
    allowSizeMix: z.boolean(),
    allowOrientationMix: z.boolean(),
    allowPhotoReuse: z.boolean(),
    pricingStrategy: pricingStrategySchema,
    discountBps: z.number().int().min(0).max(10_000).nullable().optional(),
    flatPrice: z.number().int().nonnegative().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.maxSlots < v.minSlots) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxSlots'],
        message: 'maxSlots must be >= minSlots',
      });
    }
    if (v.pricingStrategy === 'sum_with_discount' && v.discountBps == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountBps'],
        message: 'discountBps is required for sum_with_discount',
      });
    }
    if (v.pricingStrategy === 'flat' && v.flatPrice == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['flatPrice'],
        message: 'flatPrice is required for flat',
      });
    }
  });

export type BundleRuleInput = z.infer<typeof bundleRuleInputSchema>;
