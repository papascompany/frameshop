/**
 * Cart types.
 *
 * Sources: docs/specs/cart.md, PLAN.md §6 `cart_items` table.
 * HANDOFF note: `localId` is the dedup key between LocalStorage and DB. The
 * cart_items table gets a new `local_id` column (see migration 008).
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import { httpsUrl } from '../lib/validation/url';
import { selectedOptionsSchema } from './product';
import { cropTransformSchema } from './editor';
import type {
  CartItemId,
  IsoTimestamp,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from './common';
import type { SelectedOptions } from './product';
import type { CropTransform } from './editor';

// ---------- Domain types ----------

export type CartItem = {
  /** Server PK. Optional for cart items that live only in LocalStorage. */
  id?: CartItemId;
  /** Client-generated UUID. Dedup key between LocalStorage and DB. */
  localId: LocalId;
  userId: UserId | null;
  productId: ProductId;
  variantId: ProductVariantId;
  photoId: PhotoId;
  options: SelectedOptions;
  photoUrl: string;
  cropTransform: CropTransform;
  previewUrl: string;
  /** Price snapshot at the moment of "Add to cart". */
  price: number;
  /** 1..99 (clamped). */
  quantity: number;
  createdAt: IsoTimestamp;
};

export type CartSummary = {
  itemCount: number;
  totalQuantity: number;
  subtotal: number;
};

export type AddToCartInput = Omit<CartItem, 'id' | 'localId' | 'createdAt'>;

export type SyncResult = {
  added: number;
  skipped: number;
};

// ---------- Constants ----------

export const CART_LOCAL_STORAGE_KEY = 'frameshop.cart.v1';
export const CART_QUANTITY_MIN = 1;
export const CART_QUANTITY_MAX = 99;

// ---------- Zod schemas ----------

export const cartItemSchema = z.object({
  id: z.string().min(1).optional(),
  localId: z.string().uuid(),
  userId: z.string().min(1).nullable(),
  productId: z.string().min(1),
  variantId: z.string().min(1),
  photoId: z.string().min(1),
  options: selectedOptionsSchema,
  // Cart photo/preview URLs come from Supabase Storage and are rendered
  // into <img>/next/image — enforce https to defuse stored XSS (ADR-016).
  photoUrl: httpsUrl(),
  cropTransform: cropTransformSchema,
  previewUrl: httpsUrl(),
  price: z.number().int().nonnegative(),
  quantity: z.number().int().min(CART_QUANTITY_MIN).max(CART_QUANTITY_MAX),
  createdAt: z.string(),
});

export const cartSummarySchema = z.object({
  itemCount: z.number().int().nonnegative(),
  totalQuantity: z.number().int().nonnegative(),
  subtotal: z.number().int().nonnegative(),
});
