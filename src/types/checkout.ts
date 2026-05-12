/**
 * Checkout form types.
 *
 * Sources: docs/specs/checkout.md, ADR-008.
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import { ordererSchema } from './order';
import { shippingMethodSchema } from './shipping';
import type { Orderer, ShippingAddress } from './order';
import type { ShippingMethod } from './shipping';

// ---------- Form data ----------

export type CheckoutFormData = {
  orderer: Orderer;
  shipping: ShippingAddress & {
    /** UI toggle: "same as orderer" copy. */
    sameAsOrderer: boolean;
  };
  shippingMethod: ShippingMethod;
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

export const checkoutFormSchema = z
  .object({
    orderer: ordererSchema,
    shipping: shippingSchema,
    shippingMethod: shippingMethodSchema,
  })
  .superRefine((data, ctx) => {
    if (data.shippingMethod === 'PICKUP') return;
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
  });

export type ValidatedCheckoutForm = z.infer<typeof checkoutFormSchema>;

export const postcodeResultSchema = z.object({
  zip: z.string().regex(/^\d{5}$/),
  addr1: z.string().min(1).max(100),
});
