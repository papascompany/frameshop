'use client';

/**
 * Print-ready crop generation (client-only, runs in the browser canvas).
 *
 * The editor preview Stage is rendered at a small CSS size (≈560px frame),
 * but the actual photo bitmap is full resolution. To produce a print file we
 * must crop the ORIGINAL bitmap — never the downscaled preview — so there is
 * zero quality loss.
 *
 * Coordinate systems
 * ------------------
 *  • Stage px      — the Konva preview pixels (what `cropTransform` is in).
 *  • Photo px      — the original uploaded image's natural pixels.
 *  • Frame mm      — the real product dimensions (variant.width_mm/height_mm).
 *
 * `cropTransform` places the photo on the Stage:
 *     stage_pt = rotate(rotation, (photo_pt − photo_center) · scale) + (x, y)
 *
 * The print area is `inner_rect` (normalised 0..1 inside the frame rect).
 * The crop we output = inner_rect expanded OUTWARD by `bleedMm` on each side.
 *
 * Output canvas
 * -------------
 * 1 output pixel maps to 1 ORIGINAL photo pixel (we divide the Stage-space
 * crop size by `cropTransform.scale`). The photo is drawn straight onto the
 * output canvas with the inverse of the Stage placement, so the crop is
 * pixel-accurate at full resolution.
 */

import type { CropTransform } from '@/types/editor';
import type { InnerRect } from '@/types/product';

export type StageFrameGeom = {
  /** Frame rect top-left inside the Stage (px). */
  frameX: number;
  frameY: number;
  /** Frame rect size inside the Stage (px). */
  frameW: number;
  frameH: number;
};

export type PrintCropArgs = {
  /** The ORIGINAL photo bitmap (already loaded, full resolution). */
  photoImg: HTMLImageElement;
  /** Placement of the photo on the preview Stage. */
  cropTransform: CropTransform;
  /** Print area, normalised 0..1 inside the frame rect. */
  innerRect: InnerRect;
  /** Bleed in millimetres, expands the crop outward on every side. */
  bleedMm: number;
  /** Real frame width in mm (variant.widthMm) — used to convert bleed mm→px. */
  frameWidthMm: number;
  /** Frame rect geometry inside the Stage. */
  stage: StageFrameGeom;
  /** JPEG quality 0..1 (default 0.92). */
  quality?: number;
};

export type PrintCropResult = {
  blob: Blob;
  /** Output bitmap size in original-photo pixels. */
  width: number;
  height: number;
};

/**
 * Crop the original photo to the print area (+ bleed) at full resolution.
 * Areas where the photo does not cover the crop window are filled white.
 */
export async function generatePrintCrop(args: PrintCropArgs): Promise<PrintCropResult> {
  const {
    photoImg,
    cropTransform,
    innerRect,
    bleedMm,
    frameWidthMm,
    stage,
    quality = 0.92,
  } = args;

  // --- 1. inner_rect → absolute Stage px -----------------------------------
  const innerStageX = stage.frameX + innerRect.x * stage.frameW;
  const innerStageY = stage.frameY + innerRect.y * stage.frameH;
  const innerStageW = innerRect.w * stage.frameW;
  const innerStageH = innerRect.h * stage.frameH;

  // --- 2. bleed (mm) → Stage px --------------------------------------------
  // px-per-mm is identical on both axes (frame rect keeps the real aspect).
  const stagePxPerMm = stage.frameW / frameWidthMm;
  const bleedStagePx = Math.max(0, bleedMm) * stagePxPerMm;

  // --- 3. crop window (inner_rect expanded by bleed) in Stage px ------------
  const cropStageX = innerStageX - bleedStagePx;
  const cropStageY = innerStageY - bleedStagePx;
  const cropStageW = innerStageW + 2 * bleedStagePx;
  const cropStageH = innerStageH + 2 * bleedStagePx;

  // --- 4. output canvas size at ORIGINAL photo resolution ------------------
  // Each Stage px corresponds to (1 / scale) photo px, so dividing the crop
  // window by the scale recovers the original-resolution pixel count.
  const scale = cropTransform.scale || 1;
  const outW = Math.max(1, Math.round(cropStageW / scale));
  const outH = Math.max(1, Math.round(cropStageH / scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // High-quality downscaling (only relevant if the browser must resample).
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // White backdrop for any area the photo doesn't cover (e.g. after rotation
  // or when the photo is smaller than the crop window).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  // --- 5. draw the photo with the inverse Stage placement ------------------
  // In the output canvas (origin = crop top-left, 1px = 1 photo px):
  //   • the photo center (cropTransform.x/y in Stage) lands at
  //     ((x − cropStageX)/scale, (y − cropStageY)/scale)
  //   • rotation is the same as cropTransform.rotation
  //   • the photo is drawn at natural size (1:1)
  const photoCenterOutX = (cropTransform.x - cropStageX) / scale;
  const photoCenterOutY = (cropTransform.y - cropStageY) / scale;

  ctx.save();
  ctx.translate(photoCenterOutX, photoCenterOutY);
  ctx.rotate((cropTransform.rotation * Math.PI) / 180);
  ctx.drawImage(
    photoImg,
    -photoImg.naturalWidth / 2,
    -photoImg.naturalHeight / 2,
  );
  ctx.restore();

  // --- 6. encode -----------------------------------------------------------
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      quality,
    );
  });

  return { blob, width: outW, height: outH };
}
