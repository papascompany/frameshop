/**
 * Editor (FrameEditor + CropEditor) types.
 *
 * Sources: docs/specs/editor.md, PLAN.md Appendix A.
 * HANDOFF note: Konva is imported via `dynamic({ssr:false})` — this file
 * defines pure data shapes only and must remain Konva-free so it can be
 * imported on both server and client.
 *
 * FROZEN: 2026-05-12 by Architect.
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

// ---------- Editor state (Zustand store) ----------

export type EditorState = {
  productId: ProductId;
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
  productId: z.string().min(1),
  photoId: z.string().min(1).nullable(),
  selectedOptions: selectedOptionsSchema,
  selectedVariantId: z.string().min(1).nullable(),
  cropTransform: cropTransformSchema,
  previewDataUrl: z.string().nullable(),
  isProcessing: z.boolean(),
});
