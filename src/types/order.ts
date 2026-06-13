/**
 * Order types + state machine.
 *
 * Sources: docs/specs/order.md, PLAN.md §6 + Appendix A, ADR-008.
 * HANDOFF: OrderStatus is a discriminated-friendly union, transitions are a
 * Record<OrderStatus, OrderStatus[]>, `shippingMethod` and `shippingFee` are
 * new snapshot columns on the orders table.
 *
 * The actual `transitionTo` implementation must be a server-only module and
 * import 'server-only' (Backend Dev responsibility). This file is pure types.
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import { selectedOptionsSchema } from './product';
import {
  shippingMethodSchema,
  SHIPPING_METHODS,
} from './shipping';
import type {
  IsoTimestamp,
  OrderId,
  OrderItemId,
  OrderNo,
  PaymentKey,
  ProductId,
  ProductVariantId,
  UserId,
} from './common';
import type { SelectedOptions } from './product';
import type { CropTransform } from './editor';
import type { ShippingMethod } from './shipping';

// ---------- Status union & transitions ----------

export const ORDER_STATUSES = [
  'CREATED',
  'PAID',
  'IN_PRODUCTION',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed forward transitions. Per spec:
 *  CREATED → PAID | CANCELLED
 *  PAID → IN_PRODUCTION | CANCELLED | REFUNDED
 *  IN_PRODUCTION → SHIPPED | CANCELLED
 *  SHIPPED → DELIVERED
 *  DELIVERED → REFUNDED
 *  CANCELLED, REFUNDED: terminal
 *
 * Same-state transitions are idempotent (handled in canTransition).
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  CREATED: ['PAID', 'CANCELLED'],
  PAID: ['IN_PRODUCTION', 'CANCELLED', 'REFUNDED'],
  IN_PRODUCTION: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
} as const;

export class InvalidStateTransitionError extends Error {
  public readonly from: OrderStatus;
  public readonly to: OrderStatus;

  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Invalid transition: ${from} → ${to}`);
    this.from = from;
    this.to = to;
    this.name = 'InvalidStateTransitionError';
  }
}

// ---------- People & addresses ----------

export type Orderer = {
  name: string;
  phone: string;
  email: string;
};

export type ShippingAddress = {
  name: string;
  phone: string;
  zip: string;
  addr1: string;
  addr2: string;
  memo: string;
};

// ---------- Order + items ----------

/**
 * Snapshot of variant + selection + price embedded in `order_items`. Kept
 * separate from the live `ProductVariant` so post-order price/option edits
 * never mutate completed orders.
 */
export type OrderItemSnapshot = {
  productId: ProductId;
  variantId: ProductVariantId;
  productName: string;
  options: SelectedOptions;
  sizeLabel: string;
  colorLabel: string;
  unitPrice: number;
  /**
   * Per-product print bleed (mm), FROZEN at order creation. The client baked
   * the print crop with this value, so the render pipeline must reuse the
   * frozen value (not re-read `products.bleed_mm`, which an admin may change
   * after the order is placed). Optional for legacy orders predating this field
   * — the pipeline falls back to the live product value then.
   */
  bleedMm?: number;
};

export type OrderItem = {
  id: OrderItemId;
  orderId: OrderId;
  snapshot: OrderItemSnapshot;
  photoUrl: string;
  cropTransform: CropTransform;
  /** 300dpi print file URL (filled by Edge Function in Phase 3). Phase 1: preview reused. */
  printFileUrl: string | null;
  quantity: number;
  price: number;
};

export type Order = {
  id: OrderId;
  orderNo: OrderNo;
  userId: UserId | null;
  status: OrderStatus;
  totalPrice: number;
  shippingFee: number;
  shippingMethod: ShippingMethod;
  paymentId: PaymentKey | null;
  trackingNumber: string | null;
  courier: string | null;
  orderer: Orderer;
  shipping: ShippingAddress;
  createdAt: IsoTimestamp;
  paidAt: IsoTimestamp | null;
  shippedAt: IsoTimestamp | null;
};

/** `Order` plus its items — used by `getOrder` / admin detail pages. */
export type OrderWithItems = Order & {
  items: OrderItem[];
};

// ---------- createOrder input ----------

import type { CartItem } from './cart';

export type CreateOrderInput = {
  cartItems: CartItem[];
  orderer: Orderer;
  shipping: ShippingAddress;
  shippingMethod: ShippingMethod;
  /** Client-computed fee (display value, server re-computes for trust). */
  clientShippingFee?: number;
  userId?: UserId | null;
  /**
   * Anonymous session identifier — required when userId is null so the server
   * can verify photo ownership (P0-03). Treated like a bearer token: whoever
   * knows the sessionId "owns" photos in that session.
   */
  sessionId?: string | null;
};

export type CreateOrderErrorCode =
  | 'EMPTY_CART'
  | 'INVALID_VARIANT'
  | 'SEQUENCE_FAILED'
  | 'INVALID_SHIPPING_METHOD'
  | 'SHIPPING_FEE_MISMATCH'
  | 'PRICE_MISMATCH'
  /** One or more photos in the cart don't belong to the calling user/session. */
  | 'PHOTO_OWNERSHIP';

export class CreateOrderError extends Error {
  public readonly code: CreateOrderErrorCode;
  public readonly detail?: unknown;

  constructor(code: CreateOrderErrorCode, message?: string, detail?: unknown) {
    super(message ?? code);
    this.code = code;
    this.detail = detail;
    this.name = 'CreateOrderError';
  }
}

// ---------- Transition meta ----------

export type TransitionMeta = {
  paymentKey?: PaymentKey;
  trackingNumber?: string;
  courier?: string;
  reason?: string;
};

// ---------- Zod schemas ----------

export const ordererSchema = z.object({
  name: z.string().min(1).max(30),
  phone: z.string().regex(/^01[0-9]-\d{3,4}-\d{4}$/),
  email: z.string().email(),
});

export const shippingAddressSchema = z.object({
  name: z.string().min(1).max(30),
  phone: z.string().regex(/^01[0-9]-\d{3,4}-\d{4}$/),
  zip: z.string().regex(/^\d{5}$/),
  addr1: z.string().min(1).max(100),
  addr2: z.string().max(80),
  memo: z.string().max(200),
});

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderItemSnapshotSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  productName: z.string().min(1),
  options: selectedOptionsSchema,
  sizeLabel: z.string().min(1),
  colorLabel: z.string().min(1),
  unitPrice: z.number().int().nonnegative(),
});

export const createOrderInputSchema = z.object({
  // cartItems schema is validated by Cart module's own schema at the IO edge.
  orderer: ordererSchema,
  shipping: shippingAddressSchema,
  shippingMethod: z.enum(SHIPPING_METHODS),
  clientShippingFee: z.number().int().nonnegative().optional(),
  userId: z.string().min(1).nullable().optional(),
  /** Required for anonymous checkout (userId null) to enable photo-ownership check. */
  sessionId: z.string().min(1).max(128).nullable().optional(),
});

export const transitionMetaSchema = z.object({
  paymentKey: z.string().min(1).optional(),
  trackingNumber: z.string().min(1).optional(),
  courier: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

// Re-export shipping method schema for convenience inside order-aware code.
export { shippingMethodSchema };
