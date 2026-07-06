/**
 * Editor (FrameEditor + CropEditor) types.
 *
 * Sources: docs/specs/editor.md, PLAN.md Appendix A.
 * HANDOFF note: Konva is imported via `dynamic({ssr:false})` — this file
 * defines pure data shapes only and must remain Konva-free so it can be
 * imported on both server and client.
 *
 * FROZEN: 2026-05-12 by Architect.
 * ADR-025 (2026-07-06): 옵셔널 확장만 — `EditorPhotoEntry.selectedOptions?/orientation?`
 * + `EditorKind` 추가(확장형 P1 라인 단위 옵션 계약). 기존 필드 무변경.
 */

import { z } from 'zod';
import { selectedOptionsSchema } from './product';
import type {
  PhotoId,
  ProductId,
  ProductVariantId,
} from './common';
import type { SelectedOptions } from './product';

// ---------- Transforms ----------

export type CropTransform = {
  /** Canvas-space x coordinate of photo center. */
  x: number;
  /** Canvas-space y coordinate of photo center. */
  y: number;
  /** Uniform scale factor. 1.0 = 100%. */
  scale: number;
  /** Rotation in degrees. */
  rotation: number;
};

// ---------- Multi-photo tray (M-Editor v2) ----------

/**
 * One confirmed photo ready to be ordered. Multiple entries share the SAME
 * selectedOptions/variant (그룹 주문). Each entry holds the already-confirmed,
 * print-ready crop (re-uploaded full-res Photo) + its copy quantity.
 *
 * The crop is baked at "담기" time using the active variant geometry, so the
 * stored `photo` is the cropped print master and needs only an identity
 * transform downstream. Size changes invalidate the geometry → the tray is
 * cleared (colour/matte/paper do not affect crop geometry, so they preserve it).
 */
export type EditorPhotoEntry = {
  /** Client-only id (crypto.randomUUID). */
  entryId: string;
  /** Confirmed print-ready crop, re-uploaded via /api/photos/upload. */
  photo: import('./photo').Photo;
  /** Thumbnail URL for the tray strip. */
  previewUrl: string;
  /** Copy count for this photo, 1..99 (그룹사진 = 1장 × N부). */
  quantity: number;
  /**
   * 선결과제 1 — 원본 사진 보존. 베이크 크롭(`photo`)은 인쇄 마스터지만, 같은
   * 사진을 다른 사이즈로 다시 굽거나(확장형) 재주문 시 재편집하려면 원본 사진
   * 참조가 필요하다. 담기 시점의 원본 photoId/URL과 실제 크롭 변형을 함께 보존한다.
   * (옵셔널 — 레거시 호출부/베이크 직전 상태와의 하위호환.)
   */
  sourcePhotoId?: PhotoId;
  sourcePhotoUrl?: string;
  /** 베이크에 사용된 실제 크롭 변형(identity가 아님). 재편집·재주문 복원용. */
  cropTransform?: CropTransform;
  /**
   * ADR-025 (확장형 P1) — 라인 단위 옵션 스냅샷. extended 라인은 항상 채워지고,
   * basic 라인은 undefined → 전역 selectedOptions 사용(현행 동작 문자 그대로).
   * variantId 는 **저장하지 않는다**: `variantsByKey[variantKey(selectedOptions)]`
   * 로 파생한다(options 와의 이중 진실 방지 — ADR-025).
   */
  selectedOptions?: SelectedOptions;
  /**
   * ADR-025 — 라인 방향(혼합 방향 지원). basic 라인은 undefined → 전역 방향 사용.
   * 값 어휘는 project.ts `Orientation`·store/editor.ts `FrameOrientation` 과
   * 동일하나, project.ts 가 이미 이 파일의 `CropTransform` 을 type-import 하므로
   * 역방향 참조는 순환이 된다 — 여기서는 리터럴 유니온으로 둔다(구조적 호환).
   */
  orientation?: 'portrait' | 'landscape';
};

// ---------- Editor kind (ADR-025, 확장형 P1) ----------

/**
 * 편집 세션 모드. `basic` = 현행 단품 편집기(회귀 0 — setSize/setOrientation 의
 * entries 초기화 등 현행 동작 문자 그대로), `extended` = 멀티포토 사진풀 +
 * 라인별 독립 사이즈/방향/수량. 스토어 `init` 이 URL `mode` 파라미터로 결정하며
 * 기본값은 `'basic'`.
 */
export const EDITOR_KINDS = ['basic', 'extended'] as const;
export type EditorKind = (typeof EDITOR_KINDS)[number];

// ---------- Editor state (Zustand store) ----------

/**
 * Editor state shape shared between the Zustand store and IO boundaries.
 *
 * P2-02 fix (2026-05-12, ADR-014 drift resolution): `productId` is nullable
 * to represent the pre-init state ("before product selection / hydration").
 * Once `init({ productId, ... })` is called the value is non-null for the
 * lifetime of the editor session. Callers that need a non-null product can
 * narrow with a runtime guard.
 */
export type EditorState = {
  /** null = before product selection (store initial state). */
  productId: ProductId | null;
  photoId: PhotoId | null;
  selectedOptions: SelectedOptions;
  selectedVariantId: ProductVariantId | null;
  cropTransform: CropTransform;
  /** Last generated preview data URL (in-memory only). */
  previewDataUrl: string | null;
  isProcessing: boolean;
};

/** Payload emitted from the editor when the user confirms "Add to cart". */
export type EditorConfirmPayload = {
  variantId: ProductVariantId;
  cropTransform: CropTransform;
  previewBlob: Blob;
  selectedOptions: SelectedOptions;
};

// ---------- Constants ----------

export const CROP_SCALE_MIN = 0.5;
export const CROP_SCALE_MAX = 3.0;
export const CROP_ROTATION_MIN_DEG = -45;
export const CROP_ROTATION_MAX_DEG = 45;
export const PREVIEW_PIXEL_RATIO = 2;
export const DEFAULT_INNER_RECT_FALLBACK = {
  x: 0.1,
  y: 0.1,
  w: 0.8,
  h: 0.8,
} as const;

// ---------- Zod schemas ----------

export const editorKindSchema = z.enum(EDITOR_KINDS);

export const cropTransformSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().min(CROP_SCALE_MIN).max(CROP_SCALE_MAX),
  rotation: z
    .number()
    .min(CROP_ROTATION_MIN_DEG)
    .max(CROP_ROTATION_MAX_DEG),
});

export const editorStateSchema = z.object({
  // P2-02 fix: aligned with `EditorState.productId: ProductId | null`.
  // `null` = before product selection. After `init()` runs the store
  // sets a real ProductId.
  productId: z.string().min(1).nullable(),
  photoId: z.string().min(1).nullable(),
  selectedOptions: selectedOptionsSchema,
  selectedVariantId: z.string().min(1).nullable(),
  cropTransform: cropTransformSchema,
  previewDataUrl: z.string().nullable(),
  isProcessing: z.boolean(),
});
