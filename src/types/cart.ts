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
import { orientationSchema } from './project';
import type {
  CartItemId,
  CartProjectId,
  IsoTimestamp,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from './common';
import type { SelectedOptions } from './product';
import type { CropTransform } from './editor';
import type { Orientation } from './project';

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
  // ----- 확장형 상품 묶음 링크 (ADR-023, migration 035). 전부 옵셔널 — 단품은 미사용 -----
  /**
   * 확장형 묶음 헤더(cart_projects) 참조. null/undefined = 레거시 단품(현행 평면 경로).
   * 같은 projectId 를 가진 여러 CartItem = 한 프로젝트의 라인들(공유 사진풀).
   */
  projectId?: CartProjectId | null;
  /** 프로젝트 내 라인 표시 순번. 단품은 미사용. */
  projectSeq?: number | null;
  /** 라인 방향(혼합 방향). 단품은 variant 기하에서 파생되므로 미사용. */
  orientation?: Orientation | null;
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

/**
 * Active LocalStorage cart key. Bumped v1 → v2 when CartItem gained the optional
 * 확장형 묶음 필드(ADR-023). v2 is a superset of v1 (new fields optional), so the
 * migration is lossless — `storage.ts` reads the legacy v1 key once and promotes
 * it into v2 (see CART_LOCAL_STORAGE_KEY_V1).
 */
export const CART_LOCAL_STORAGE_KEY = 'frameshop.cart.v2';
/** Legacy key migrated from on first read. Do not write to this. */
export const CART_LOCAL_STORAGE_KEY_V1 = 'frameshop.cart.v1';
export const CART_QUANTITY_MIN = 1;
export const CART_QUANTITY_MAX = 99;

// ---------- Zod schemas ----------

export const cartItemSchema = z.object({
  id: z.string().min(1).optional(),
  localId: z.string().uuid(),
  userId: z.string().min(1).nullable(),
  // uuid 강화(FS-P1 security P1-001): probe true 시 cart_projects.product_id
  // (uuid FK) 에 그대로 닿는다 — 느슨한 문자열은 Postgres 22P02/23503 의 입구.
  // 실값은 항상 products PK(gen_random_uuid) 라 정상 클라이언트 무파손.
  productId: z.string().uuid(),
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
  // 확장형 묶음 링크(ADR-023). 옵셔널·nullable — v1 카트 항목은 이 필드들이 없어도 통과.
  // uuid/.max(9999) 강화(FS-P1 security P1-001): probe true 시 projectId 는
  // cart_projects.project_local_id(uuid), projectSeq 는 cart_items.project_seq
  // (int4) 에 닿는다 — DB 타입보다 느슨한 스키마는 22P02/22003 무처리 500 의 입구.
  projectId: z.string().uuid().nullable().optional(),
  projectSeq: z.number().int().nonnegative().max(9999).nullable().optional(),
  orientation: orientationSchema.nullable().optional(),
});

export const cartSummarySchema = z.object({
  itemCount: z.number().int().nonnegative(),
  totalQuantity: z.number().int().nonnegative(),
  subtotal: z.number().int().nonnegative(),
});
