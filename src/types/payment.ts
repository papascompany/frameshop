/**
 * Payment types — Toss Payments v1 confirm/webhook contracts.
 *
 * Sources: docs/specs/payment.md.
 * Toss confirm API: https://api.tosspayments.com/v1/payments/confirm
 *
 * Security:
 *  - Server-only modules (`'server-only'`) implement confirm/webhook handlers.
 *  - `TOSS_SECRET_KEY` / `TOSS_WEBHOOK_SECRET` / `SUPABASE_SERVICE_ROLE_KEY`
 *    must never appear in client bundles.
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import type {
  IsoTimestamp,
  OrderId,
  OrderNo,
  PaymentEventId,
  PaymentKey,
} from './common';

// ---------- Request (client → server) ----------

export type RequestPaymentInput = {
  orderNo: OrderNo;
  totalPrice: number;
  orderName: string;
  customerName: string;
  customerEmail: string;
  successUrl: string;
  failUrl: string;
};

// ---------- Confirm route ----------

export type ConfirmPaymentInput = {
  paymentKey: PaymentKey;
  orderId: OrderNo; // Toss sends our orderNo as their orderId.
  amount: number;
};

export type ConfirmErrorCode =
  | 'AMOUNT_MISMATCH'
  | 'ORDER_NOT_FOUND'
  | 'TOSS_REJECTED'
  | 'ALREADY_PAID'
  | 'INTERNAL';

export type ConfirmResult =
  | { ok: true; orderNo: OrderNo; paymentKey: PaymentKey; alreadyPaid?: boolean }
  | { ok: false; code: ConfirmErrorCode; message: string };

// ---------- Webhook ----------

/**
 * Toss webhook event status (subset we map). Other values pass through and
 * are logged but not acted on in Phase 1.
 */
export const TOSS_PAYMENT_STATUSES = [
  'READY',
  'IN_PROGRESS',
  'WAITING_FOR_DEPOSIT',
  'DONE',
  'CANCELED',
  'PARTIAL_CANCELED',
  'ABORTED',
  'EXPIRED',
] as const;
export type TossPaymentStatus = (typeof TOSS_PAYMENT_STATUSES)[number];

export type WebhookEvent = {
  eventType: string;
  createdAt: IsoTimestamp;
  data: {
    paymentKey: PaymentKey;
    orderId: OrderNo;
    status: TossPaymentStatus;
    totalAmount: number;
  };
};

export type WebhookVerifyResult =
  | { valid: true; event: WebhookEvent }
  | { valid: false };

// ---------- Persistence: payment_events table (ADR-this-phase) ----------

export type PaymentEvent = {
  id: PaymentEventId;
  paymentKey: PaymentKey;
  orderId: OrderId | null;
  orderNo: OrderNo;
  status: TossPaymentStatus;
  rawPayload: unknown;
  receivedAt: IsoTimestamp;
};

// ---------- Constants ----------

export const MAX_PAYMENT_CONFIRM_TIMEOUT_MS = 10_000;
export const MAX_PAYMENT_RETRY_SECONDS = 600;

/** Maps Toss status → our OrderStatus where defined. */
import type { OrderStatus } from './order';
export const TOSS_STATUS_TO_ORDER_STATUS: Readonly<
  Partial<Record<TossPaymentStatus, OrderStatus>>
> = {
  DONE: 'PAID',
  CANCELED: 'CANCELLED',
  ABORTED: 'CANCELLED',
  EXPIRED: 'CANCELLED',
} as const;

// ---------- Zod schemas ----------

export const tossStatusSchema = z.enum(TOSS_PAYMENT_STATUSES);

export const confirmPaymentInputSchema = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.string().regex(/^\d{8}-\d{4}$/),
  amount: z.number().int().nonnegative(),
});

export const webhookEventSchema = z.object({
  eventType: z.string().min(1),
  createdAt: z.string(),
  data: z.object({
    paymentKey: z.string().min(1),
    orderId: z.string().regex(/^\d{8}-\d{4}$/),
    status: tossStatusSchema,
    totalAmount: z.number().int().nonnegative(),
  }),
});
