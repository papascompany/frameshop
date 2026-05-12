/**
 * Pure helpers for the editor canvas (NO Konva imports).
 *
 * - lookupVariant: option-matrix → variant lookup (UT-08)
 * - applyCropTransform: CropTransform → Konva-compatible image attrs (UT-02)
 * - fitPhotoToFrame: initial CropTransform sized to inner_rect (UT-03)
 */

import { variantKey, type OptionMatrix, type ProductVariant, type SelectedOptions } from '@/types/product';
import {
  CROP_SCALE_MAX,
  CROP_SCALE_MIN,
  type CropTransform,
} from '@/types/editor';

// ----- variant lookup -----

export function lookupVariant(args: {
  variantsByKey: Record<string, ProductVariant>;
  options: SelectedOptions;
}): ProductVariant | null {
  const key = variantKey(args.options);
  return args.variantsByKey[key] ?? null;
}

export function pickDefaultVariant(matrix: OptionMatrix): ProductVariant | null {
  const variants = Object.values(matrix.variantsByKey);
  if (variants.length === 0) return null;
  // Cheapest active variant. (`is_active` already filtered upstream.)
  return variants.reduce((cheapest, v) =>
    cheapest === null || v.price < cheapest.price ? v : cheapest,
  null as ProductVariant | null);
}

// ----- transform math -----

/** Konva-compatible image attrs (kept as a plain shape to avoid Konva types). */
export type ImageAttrs = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  /** Offset point used by Konva so the image rotates around its center. */
  offsetX: number;
  offsetY: number;
};

export function applyCropTransform(
  image: { width: number; height: number },
  transform: CropTransform,
): ImageAttrs {
  return {
    x: transform.x,
    y: transform.y,
    scaleX: transform.scale,
    scaleY: transform.scale,
    rotation: transform.rotation,
    offsetX: image.width / 2,
    offsetY: image.height / 2,
  };
}

/**
 * Compute fit-cover transform that places a photo inside an inner_rect.
 * @param photoSize   pixel size of the source photo (post-EXIF rotation)
 * @param innerRect   normalized 0..1 rect within the stage
 * @param stageSize   pixel size of the Konva Stage
 */
export function fitPhotoToFrame(
  photoSize: { w: number; h: number },
  innerRect: { x: number; y: number; w: number; h: number },
  stageSize: { w: number; h: number },
): CropTransform {
  const targetW = innerRect.w * stageSize.w;
  const targetH = innerRect.h * stageSize.h;

  // Cover: largest of (target/photo) so the photo fully covers the rect.
  const scale = Math.max(targetW / photoSize.w, targetH / photoSize.h);

  // Center of the inner rect in pixel space.
  const cx = innerRect.x * stageSize.w + targetW / 2;
  const cy = innerRect.y * stageSize.h + targetH / 2;

  return {
    x: cx,
    y: cy,
    scale: clamp(scale, CROP_SCALE_MIN, CROP_SCALE_MAX),
    rotation: 0,
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
