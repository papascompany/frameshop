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
import { orientationSchema } from './project';
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
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from './common';
import type { SelectedOptions } from './product';
import type { CropTransform } from './editor';
import type { Orientation } from './project';
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

// ---------- Cash receipt (현금영수증, migration 039) ----------

/** orders.receipt_type CHECK 와 1:1. income = 소득공제, proof = 지출증빙. */
export const CASH_RECEIPT_TYPES = ['income', 'proof'] as const;

export type CashReceiptType = (typeof CASH_RECEIPT_TYPES)[number];

/**
 * 주문 생성 시 현금영수증 신청 페이로드. `info` 는 식별번호(숫자·하이픈만,
 * 8~20자) — income 은 휴대폰번호 등, proof 는 사업자등록번호.
 */
export type CashReceiptRequest = {
  type: CashReceiptType;
  info: string;
};

/**
 * 현금영수증 식별번호 마스킹 — 마지막 4자리 숫자 외 전부 '*'(하이픈 유지).
 * 서버 컴포넌트가 클라이언트 props(RSC 페이로드)로 내리기 전에 호출한다
 * (FS-EC P2-1, PII 최소화) — 원문 식별번호(휴대폰/사업자번호)가 페이지 소스·
 * devtools 에 직렬화되지 않는다. 이미 마스킹된 입력에는 멱등.
 */
export function maskReceiptInfo(info: string | null | undefined): string | null {
  if (!info) return null;
  const totalDigits = info.replace(/[^0-9]/g, '').length;
  let seen = 0;
  return info
    .split('')
    .map((ch) => {
      if (!/[0-9]/.test(ch)) return ch;
      seen += 1;
      return seen > totalDigits - 4 ? ch : '*';
    })
    .join('');
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
  /**
   * 선결과제 1 — 원본 사진 보존. `OrderItem.photoUrl` 은 인쇄용 베이크 크롭이라
   * 원본 사진 참조가 빠져 재주문/재편집이 불가능했다. 주문 생성 시 카트의
   * 원본 photoId(있으면)를 스냅샷에 동결한다(jsonb라 마이그레이션 불요). 레거시
   * 주문엔 없으므로 재주문은 photo_url→photos 조회로 폴백한다. 인쇄 경로는 이
   * 필드를 사용하지 않는다(인쇄는 항상 베이크 크롭 photo_url 기준).
   */
  sourcePhotoId?: PhotoId;
  /** 원본 사진 URL(있으면). 재편집 시 원본을 캔버스에 다시 올리기 위함. */
  sourcePhotoUrl?: string;
  /**
   * ADR-025 (확장형 P1) — 묶음 라인 스냅샷 동결. `createOrder` 가 cartItems 를
   * projectId 로 그룹핑해 그룹당 서버 project_group_id 를 부여하고, 아래 필드들을
   * variant_snapshot(jsonb)에 함께 동결한다 — **마이그레이션 035 미적용에서도
   * 묶음 정보가 주문에 보존**된다(035 적용 시 전용 컬럼에도 conditional-spread).
   * 전부 옵셔널 — 단품/레거시 주문 행에는 없다.
   */
  /** 라인 방향 스냅샷(혼합 방향). 값 어휘는 project.ts `Orientation` 과 동일. */
  orientation?: Orientation;
  /** 묶음 내 라인 표시 순번. 단품은 없음. */
  projectSeq?: number;
  /** 묶음 표시 라벨(주문내역/관리자 그룹 표기용, 서버 생성). 단품은 없음. */
  groupLabel?: string;
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
  /**
   * Orderer-level free-form note (size change / payment request), distinct from
   * shipping.memo (courier instructions). Depends on migration 029; mapped
   * undefined-safe so reads work even if 029 is unapplied. Max 200 chars (app).
   *
   * Optional on the type so existing Order literals (fixtures, callers built
   * before 029) keep compiling; mapOrder always populates it as string | null.
   */
  orderMemo?: string | null;
  /**
   * Purchase-confirmation timestamp (구매확정). Null until the customer confirms
   * a DELIVERED order; once set, the order is finalized. Depends on migration
   * 033; mapped undefined-safe so reads work even if 033 is unapplied.
   *
   * Optional on the type so existing Order literals (fixtures, callers built
   * before 033) keep compiling; mapOrder always populates it as
   * IsoTimestamp | null.
   */
  confirmedAt?: IsoTimestamp | null;
  /**
   * FS-EC-00 optional additions. 전부 옵셔널(FROZEN 무파손) — 기존 Order 리터럴/
   * 픽스처가 그대로 컴파일된다. mapOrder 는 항상 undefined-safe 로 채운다
   * (해당 마이그레이션 미적용이어도 안전).
   */
  /** 부분환불 누적액(KRW). migration 038; mapOrder → 0 폴백. */
  refundedAmount?: number;
  /** 현금영수증 신청 유형. migration 039; null = 미신청. mapOrder → null 폴백. */
  receiptType?: CashReceiptType | null;
  /** 현금영수증 식별번호(숫자·하이픈). migration 039; mapOrder → null 폴백. */
  receiptInfo?: string | null;
  /** Toss cashReceipt 발급 결과 URL. migration 039; mapOrder → null 폴백. */
  receiptUrl?: string | null;
  /** Toss cashReceipt 발급 완료 시각. migration 039; mapOrder → null 폴백. */
  receiptIssuedAt?: IsoTimestamp | null;
  /** 주문 시 차감한 포인트 스냅샷(totalPrice 는 이미 차감 후). migration 031; → 0 폴백. */
  pointsRedeemed?: number;
  /** PAID 시 적립한 포인트 스냅샷(환불 시 회수 근거). migration 031; → 0 폴백. */
  pointsAccrued?: number;
  /** 제주/도서산간 추가 배송비 스냅샷(ADR-008). migration 030; → 0 폴백. */
  surchargeFee?: number;
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
  /**
   * 사용할 적립금(1 point = 1 KRW, 정수 ≥ 0). 서버가 잔액·상한(maxRedeemable)을
   * 권위 있게 재검증하고, totalPrice 에서 차감한 **최종 금액**을 저장한다(031).
   * 미지정/0 = 미사용. 회원 전용(userId 필수) — 익명 주문에선 무시/거부.
   */
  redeemPoints?: number;
  /** 현금영수증 신청(migration 039). null/미지정 = 미신청. */
  receipt?: CashReceiptRequest | null;
};

export type CreateOrderErrorCode =
  | 'EMPTY_CART'
  | 'INVALID_VARIANT'
  | 'SEQUENCE_FAILED'
  | 'INVALID_SHIPPING_METHOD'
  | 'SHIPPING_FEE_MISMATCH'
  | 'PRICE_MISMATCH'
  /** One or more photos in the cart don't belong to the calling user/session. */
  | 'PHOTO_OWNERSHIP'
  /** redeemPoints > 0 인데 포인트 기능 불가(031 미적용/익명/프로필 없음). */
  | 'POINTS_UNAVAILABLE'
  /** redeemPoints 가 잔액 또는 maxRedeemable 상한을 초과. */
  | 'POINTS_INSUFFICIENT'
  /** receipt 신청인데 현금영수증 기능 불가(039 미적용 등). */
  | 'RECEIPT_UNAVAILABLE';

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

export const cashReceiptTypeSchema = z.enum(CASH_RECEIPT_TYPES);

/**
 * 현금영수증 식별번호: 숫자·하이픈만, 8~20자 (휴대폰/사업자번호 커버).
 * FS-EC P2-3: 길이 규칙만으로는 "--------"(전부 하이픈)가 통과했다 — 숫자
 * 최소 8자리를 별도 refine 으로 강제한다.
 */
export const cashReceiptRequestSchema = z.object({
  type: cashReceiptTypeSchema,
  info: z
    .string()
    .min(8)
    .max(20)
    .regex(/^[0-9-]+$/, '숫자와 하이픈만 입력해주세요')
    .refine((v) => v.replace(/[^0-9]/g, '').length >= 8, {
      message: '숫자를 8자리 이상 입력해주세요',
    }),
});

export const orderItemSnapshotSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  productName: z.string().min(1),
  options: selectedOptionsSchema,
  sizeLabel: z.string().min(1),
  colorLabel: z.string().min(1),
  unitPrice: z.number().int().nonnegative(),
  // Optional snapshot extensions (forward-compatible; absent on legacy rows).
  // bleedMm was previously typed but missing from this schema — close the gap.
  bleedMm: z.number().nonnegative().optional(),
  sourcePhotoId: z.string().min(1).optional(),
  sourcePhotoUrl: z.string().optional(),
  // ADR-025 확장형 묶음 라인 스냅샷(옵셔널 — 단품/레거시 행엔 없음).
  orientation: orientationSchema.optional(),
  projectSeq: z.number().int().nonnegative().optional(),
  groupLabel: z.string().min(1).optional(),
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
  /** FS-EC-00: 적립금 사용(서버가 잔액/상한 재검증). 미지정 = 미사용. */
  redeemPoints: z.number().int().nonnegative().optional(),
  /** FS-EC-00: 현금영수증 신청. null/미지정 = 미신청. */
  receipt: cashReceiptRequestSchema.nullable().optional(),
});

export const transitionMetaSchema = z.object({
  paymentKey: z.string().min(1).optional(),
  trackingNumber: z.string().min(1).optional(),
  courier: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

// Re-export shipping method schema for convenience inside order-aware code.
export { shippingMethodSchema };
