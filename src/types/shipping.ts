/**
 * Shipping policy types (ADR-008).
 *
 * Shipping methods are admin-configurable rows in `shipping_methods`. The
 * pure `calculateShippingFee` function lives in `src/lib/shipping/calc.ts`
 * (will be created by Backend Dev) — its signature is contract-typed here.
 *
 * Sources: docs/specs/checkout.md, docs/specs/admin.md, ADR-008.
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import type { IsoTimestamp, ShippingMethodId } from './common';

// ---------- Union & config ----------

export const SHIPPING_METHODS = ['STANDARD', 'PICKUP', 'QUICK'] as const;
export type ShippingMethod = (typeof SHIPPING_METHODS)[number];

export type ShippingMethodConfig = {
  id: ShippingMethodId;
  code: ShippingMethod;
  label: string;
  fee: number;
  /** Only meaningful when `code === 'STANDARD'`. null = always charge fee. */
  freeThreshold: number | null;
  /** Pickup location note (PICKUP) or other free-form note. */
  note: string | null;
  isActive: boolean;
  sortOrder: number;
  /**
   * 제주 추가 배송비(KRW, migration 030). STANDARD 에만 의미 있고 PICKUP/QUICK 은 0.
   * FS-EC-00 옵셔널 추가(FROZEN 무파손) — mapShippingMethod 가 030 미적용 시 0 폴백.
   */
  surchargeFeeJeju?: number;
  /** 도서산간 추가 배송비(KRW, migration 030). STANDARD 전용. → 0 폴백. */
  surchargeFeeRemote?: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

/** Admin form input — id/timestamps are server-managed. */
export type ShippingMethodInput = Omit<
  ShippingMethodConfig,
  'id' | 'createdAt' | 'updatedAt'
>;

// ---------- Calculation contract ----------

/**
 * Pure function (no side effects). UT target.
 *
 * Rules (ADR-008):
 *  - PICKUP → always 0
 *  - STANDARD → if subtotal >= freeThreshold (when set) → 0, else `fee`.
 *    If `freeThreshold === null` → always `fee` (threshold disabled).
 *  - QUICK → always `fee` (no free threshold)
 *
 * Throws `InactiveShippingMethodError` if the requested method is missing
 * from `settings` or inactive.
 */
export type CalculateShippingFee = (
  method: ShippingMethod,
  subtotal: number,
  settings: readonly ShippingMethodConfig[],
) => number;

export class InactiveShippingMethodError extends Error {
  public readonly code = 'INACTIVE_METHOD' as const;
  public readonly method: ShippingMethod;

  constructor(method: ShippingMethod) {
    super(`Shipping method ${method} is inactive or not configured`);
    this.method = method;
    this.name = 'InactiveShippingMethodError';
  }
}

// ---------- Zod schemas ----------

export const shippingMethodSchema = z.enum(SHIPPING_METHODS);

export const shippingMethodInputSchema = z
  .object({
    code: shippingMethodSchema,
    label: z.string().min(1).max(40),
    fee: z.number().int().nonnegative(),
    freeThreshold: z.number().int().nonnegative().nullable(),
    note: z.string().max(500).nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    /** FS-EC-00 옵셔널 추가(030). 미지정 = 0 유지(기존 폼 무파손). */
    surchargeFeeJeju: z.number().int().nonnegative().optional(),
    surchargeFeeRemote: z.number().int().nonnegative().optional(),
  })
  .refine(
    (val) => val.code === 'STANDARD' || val.freeThreshold === null,
    {
      message: 'freeThreshold is only valid on STANDARD',
      path: ['freeThreshold'],
    },
  )
  .refine(
    (val) =>
      val.code === 'STANDARD' ||
      ((val.surchargeFeeJeju ?? 0) === 0 && (val.surchargeFeeRemote ?? 0) === 0),
    {
      message: 'surcharge fees are only valid on STANDARD',
      path: ['surchargeFeeJeju'],
    },
  );

/** Bulk update payload (admin/shipping form): all 3 rows at once. */
export const bulkShippingMethodInputSchema = z
  .array(shippingMethodInputSchema)
  .min(1)
  .max(SHIPPING_METHODS.length)
  .refine((rows) => rows.some((r) => r.isActive), {
    message: '최소 1개의 배송 방법은 활성화해야 합니다',
  });
