import { z } from 'zod';

/**
 * Common branded ID types and shared primitives.
 *
 * Branded types prevent accidental mixups between different ID kinds at the
 * type level (e.g. passing a ProductId where an OrderId is expected). At
 * runtime they are plain strings.
 *
 * FROZEN: 2026-05-12 by Architect.
 */

// ---------- Branded ID types ----------

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type CategoryId = Brand<string, 'CategoryId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type ProductImageId = Brand<string, 'ProductImageId'>;
export type FrameAssetId = Brand<string, 'FrameAssetId'>;
export type ProductVariantId = Brand<string, 'ProductVariantId'>;
export type PhotoId = Brand<string, 'PhotoId'>;
export type CartItemId = Brand<string, 'CartItemId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type OrderItemId = Brand<string, 'OrderItemId'>;
export type CurationId = Brand<string, 'CurationId'>;
export type ShippingMethodId = Brand<string, 'ShippingMethodId'>;
export type PaymentEventId = Brand<string, 'PaymentEventId'>;
export type UserId = Brand<string, 'UserId'>;

/**
 * 확장형 상품(ADR-023) — 묶음(프로젝트) 식별자.
 * `CartProjectId` = cart_projects 서버 PK. `ProjectLocalId` = 클라 생성 UUID로
 * localStorage ↔ DB dedup(cart_items.local_id ↔ ADR-011 패턴과 동일). 둘 다
 * 추가 전용(additive) 브랜드라 기존 코드/런타임에 영향 없음.
 */
export type CartProjectId = Brand<string, 'CartProjectId'>;
export type ProjectLocalId = Brand<string, 'ProjectLocalId'>;

/**
 * FS-X 웨이브(ADR-026) — 세트·구성규칙·문의·위시·쿠폰 식별자.
 * 전부 추가 전용(additive) 브랜드 — 기존 코드/런타임 무영향.
 */
export type SetTemplateId = Brand<string, 'SetTemplateId'>;
export type BundleRuleId = Brand<string, 'BundleRuleId'>;
export type InquiryId = Brand<string, 'InquiryId'>;
export type WishlistItemId = Brand<string, 'WishlistItemId'>;
export type CouponId = Brand<string, 'CouponId'>;

/**
 * Client-generated UUID used to dedup cart items between LocalStorage and DB.
 * Distinct from CartItemId (server primary key).
 */
export type LocalId = Brand<string, 'LocalId'>;

/** Editor session ID (client-generated, used in /studio/[sessionId] route). */
export type SessionId = Brand<string, 'SessionId'>;

/** Toss payment key (server-issued by PG). */
export type PaymentKey = Brand<string, 'PaymentKey'>;

/** Order number in `YYYYMMDD-NNNN` format. */
export type OrderNo = Brand<string, 'OrderNo'>;

// ---------- Helpers ----------

/** Cast a plain string into a branded ID. Use at IO boundaries only. */
export function asBrand<T extends Brand<string, string>>(id: string): T {
  return id as T;
}

// ---------- Result / Pagination primitives ----------

/** Standard Result type for explicit success/failure. */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** ISO 8601 timestamp string. */
export type IsoTimestamp = string;

/** Pagination input for list queries. */
export type ListOptions = {
  page?: number;
  pageSize?: number;
};

/** Pagination output. */
export type Paginated<T> = {
  items: T[];
  total: number;
  hasMore: boolean;
  page: number;
  pageSize: number;
};

/** Default page sizes (kept here so all modules agree). */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;


// ---------- Runtime ID validation ----------

/**
 * DB 식별자(PK/FK)용 UUID 형식 검증. **`z.uuid()` / `z.string().uuid()` 를 쓰지 말 것.**
 *
 * Zod v4 의 `uuid` 는 RFC 4122 의 **버전·variant 비트까지** 강제한다. 그래서
 * `00000000-0000-0000-0000-000000000010` 같은 시드/고정 식별자를 거부한다
 * (2026-08-08 실사고: 시드 상품의 `/api/cart`·`/api/orders` 가 전부 422 BAD_INPUT
 *  → 로그인 사용자 장바구니가 조용히 비고, 주문 생성 자체가 불가능했다).
 *
 * `z.guid()` 는 8-4-4-4-12 hex 형식만 검사한다 — Postgres `uuid` 캐스팅 실패(22P02)와
 * 문자열 주입 차단이라는 본래 목적(FS-P1 security P1-001)은 그대로 달성한다.
 */
export const uuidLike = z.guid();
