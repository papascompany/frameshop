/**
 * User address book (배송지 주소록) types + validation.
 *
 * Phase B-1. Backs migration 032_user_addresses. The row shape mirrors
 * orders.shipping (ShippingAddress) so a saved address can populate checkout
 * without reshaping: recipient_name/phone/zip/addr1/addr2/memo.
 *
 * phone/zip regexes are intentionally kept identical to ordererSchema /
 * shippingAddressSchema in types/order.ts so a saved address always validates
 * at checkout under the same rules.
 */

import { z } from 'zod';
import type { IsoTimestamp, UserId } from './common';

declare const __addressBrand: unique symbol;
/** Branded primary key for a saved user address (plain string at runtime). */
export type UserAddressId = string & { readonly [__addressBrand]: 'UserAddressId' };

export type UserAddress = {
  id: UserAddressId;
  userId: UserId;
  /** Free-form label ('집' / '회사' 등). May be empty. */
  label: string;
  recipientName: string;
  phone: string;
  zip: string;
  addr1: string;
  addr2: string;
  memo: string;
  isDefault: boolean;
  createdAt: IsoTimestamp;
};

/**
 * Input for create/update. label/addr2/memo/isDefault are optional; the
 * required fields and the phone/zip regexes match shippingAddressSchema so the
 * address is checkout-ready. Optional string fields default to '' at the DB
 * layer (columns are NOT NULL DEFAULT '').
 */
export const addressInputSchema = z.object({
  label: z.string().max(30).optional(),
  recipientName: z.string().min(1).max(30),
  phone: z.string().regex(/^01[0-9]-\d{3,4}-\d{4}$/),
  zip: z.string().regex(/^\d{5}$/),
  addr1: z.string().min(1).max(100),
  addr2: z.string().max(80).optional(),
  memo: z.string().max(200).optional(),
  isDefault: z.boolean().optional(),
});

export type AddressInput = z.infer<typeof addressInputSchema>;
