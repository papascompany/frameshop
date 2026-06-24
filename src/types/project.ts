/**
 * 확장형 상품(프로젝트/세트 집합) 도메인 타입.
 *
 * 설계 SSOT: docs/specs/extended-product.md §2, §4. 결정: ADR-023.
 *
 * 프로젝트(묶음) = 공유 사진풀 + N개의 라인(평면 cart_items). single 단품은
 * projectId=null 로 현행 평면 경로를 그대로 쓴다(회귀 표면 0). 확장형(extended)만
 * 이 집합 타입을 사용한다.
 *
 * 의존 방향(순환 없음): project.ts → product.ts / common (값 import).
 * cart.ts(`CartItem`)는 **타입 전용**으로만 끌어와 런타임 순환을 만들지 않는다
 * (cart.ts 는 반대로 project.ts 의 `Orientation`/`orientationSchema` 를 값으로 import).
 *
 * FROZEN(옵셔널/추가 전용): 2026-06-24 (ADR-023). 이후 변경은 ADR 선승인.
 */

import { z } from 'zod';
import { PRODUCT_TYPES, type ProductType } from './product';
import type {
  CartProjectId,
  ProjectLocalId,
  ProductId,
  PhotoId,
} from './common';
import type { CartItem } from './cart';
import type { CropTransform } from './editor';

// ---------- Enums / unions ----------

// `ProductType`(single|extended)은 product.ts 가 SSOT. 확장형 도메인에서도 쓰도록 재노출.
export { PRODUCT_TYPES };
export type { ProductType };

/** 라인/주문 방향(혼합 방향 지원). migration 034/035 의 CHECK 와 일치. */
export const ORIENTATIONS = ['landscape', 'portrait'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/**
 * 프로젝트 종류. `basic` = 내부적으로 단품 1라인을 래핑한 형태(편집기가 single 을
 * kind:'basic' 으로 다룸 — 저장은 평면), `extended` = 다라인 묶음.
 */
export const PROJECT_KINDS = ['basic', 'extended'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

// ---------- Domain types ----------

/**
 * 프로젝트 사진풀의 한 항목. `photoId` 는 인쇄 마스터(베이크 크롭) 의미를 유지하고,
 * `sourcePhotoId`(ADR-020) 로 원본을 보존해 "같은 사진 다른 사이즈"·재편집을 가능케 한다.
 */
export type ProjectPhotoRef = {
  /** 인쇄 마스터(베이크 크롭) photoId — 현행 cart_items.photo_id 의미와 동일. */
  photoId: PhotoId;
  /** 원본 사진 photoId(ADR-020). 재편집/같은사진 멀티사이즈에 사용. */
  sourcePhotoId?: PhotoId;
  /** 원본 사진 URL(있으면) — 재편집 시 캔버스에 원본을 다시 올리기 위함. */
  originalUrl?: string;
  /** 풀 썸네일/미리보기 URL. */
  previewUrl: string;
  /** 원본 대비 실제 변형(크롭/이동/스케일). */
  cropTransform?: CropTransform;
};

/**
 * 세트(묶음) 가격 분해. ADR-021: "구성 합산 → 세트 할인 → 세트 합계". 세트 할인은
 * 주문 생성 시 각 order_items 행에 비례배분되어 행 가격 합 = total 을 유지한다.
 */
export type ProjectPricing = {
  /** 라인 가격 합산(할인 전). */
  subtotal: number;
  /** 세트 할인액(비례배분 전 총액). 단품/할인없음이면 0. */
  setDiscount: number;
  /** 최종 합계 = subtotal - setDiscount. */
  total: number;
};

/**
 * 장바구니의 확장형 묶음(프로젝트). cart_projects 헤더 + 자식 cart_items 라인의
 * 읽기 집합(read-model). 단품(projectId=null)은 이 타입을 만들지 않는다.
 */
export type CartProject = {
  /** 서버 PK(cart_projects.id). 로컬 전용(미동기) 프로젝트는 없을 수 있음. */
  projectId?: CartProjectId;
  /** 클라 생성 UUID(localStorage ↔ DB dedup). */
  projectLocalId: ProjectLocalId;
  kind: ProjectKind;
  productId: ProductId;
  title: string;
  /** set_templates 좌표 프리셋(있으면 벽모드, 없으면 그리드모드). 036 도입 전엔 null. */
  setTemplateId: string | null;
  photoPool: ProjectPhotoRef[];
  /** 자식 라인 — 평면 cart_items 로 저장되며 projectId 로 묶인다. */
  items: CartItem[];
  pricing: ProjectPricing;
};

// ---------- Zod schemas ----------

export const productTypeSchema = z.enum(PRODUCT_TYPES);
export const orientationSchema = z.enum(ORIENTATIONS);
export const projectKindSchema = z.enum(PROJECT_KINDS);

export const projectPricingSchema = z.object({
  subtotal: z.number().int().nonnegative(),
  setDiscount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

// CartProject 전체 영속화 스키마(그룹 배치 upsert API)는 P2 에서 cartItemSchema 와 함께
// 구성한다 — 여기서 cartItemSchema 를 값 import 하면 cart.ts ↔ project.ts 런타임 순환이
// 생기므로 P0 에서는 enum/pricing 스키마만 노출한다(타입 계약은 위 도메인 타입으로 충족).
