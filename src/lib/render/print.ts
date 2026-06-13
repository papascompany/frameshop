/**
 * Server-side 300dpi print rendering (Sharp).
 *
 * Source of truth: docs/frame_skills.md §3 (coordinate pipeline), §5
 * (print rendering), §6.5 (bleed). Product decision 2026-06-13 (CTO):
 * the print file is **photo-only** (no frame moulding printed — the frame is
 * a physical object). Bleed is **per-product**, configured by admin via
 * `products.bleed_mm` (0 = "정사이즈" exact-cut, >0 = bleed for trimming).
 *
 * Single source of truth for the print pixels: the **client-baked crop**
 * (`exportPrintCrop` → `generatePrintCrop`). That crop is already:
 *   - clipped to the print window (`inner_rect`) + `product.bleedMm`,
 *   - oriented (가로/세로) per the editor's chosen orientation,
 *   - at full original-photo resolution.
 *
 * So this module does NOT re-derive the crop from the original photo +
 * cropTransform (the old framed-composite pipeline, retired 2026-06-13). It
 * simply normalises the baked crop to the exact 300dpi physical size it
 * represents. Because the baked crop's pixel aspect equals
 * `(inner_rect.w·Wmm + 2·bleed) : (inner_rect.h·Hmm + 2·bleed)` exactly (see
 * `generatePrintCrop`), the resize below is a pure uniform scale — no
 * distortion, no cropping.
 *
 * NOT covered (frame_skills §5.3): ICC colour-profile conversion (sRGB only),
 * PDF output (PNG only).
 *
 * Pure function — no IO, no DB access. Callers supply the baked-crop buffer;
 * this module returns a PNG buffer. The pipeline owns Storage + DB.
 */

import 'server-only';
import sharp from 'sharp';

// ---------- Constants ----------

export const PRINT_DPI = 300;
export const MM_PER_INCH = 25.4;
/**
 * Default bleed when a product has none configured. Industry standard is 2mm
 * (frame_skills §6.5); per-product `products.bleed_mm` overrides this, and
 * `0` is valid ("정사이즈" — cut exactly to size, no bleed).
 */
export const BLEED_MM = 2;

// ---------- Helpers ----------

/** mm → pixel at 300dpi. Rounded to the nearest integer pixel. */
export function mmToPx(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * PRINT_DPI);
}

// ---------- Types ----------

export type InnerRectNorm = {
  /** 0..1 normalized X (left edge) of the print window within the frame. */
  x: number;
  /** 0..1 normalized Y (top edge). */
  y: number;
  /** 0..1 normalized width. */
  w: number;
  /** 0..1 normalized height. */
  h: number;
};

export type VariantSize = {
  widthMm: number;
  heightMm: number;
};

export type RenderInput = {
  /**
   * The client-baked print crop (already inner_rect + bleed, oriented,
   * full-res). This IS the print photo; do not pass the original upload.
   */
  photoBuffer: Buffer;
  /** Print window within the frame (normalized 0..1) — drives physical size. */
  innerRect: InnerRectNorm;
  /** Raw variant size (mm). Long/short edges are assigned by orientation. */
  variant: VariantSize;
  /**
   * Per-product bleed (mm). Admin-configured; `0` = exact-cut. INVARIANT: this
   * must be the SAME value the client baked `photoBuffer` with — pass the value
   * FROZEN in the order snapshot, never a live `products.bleed_mm` read (an
   * admin edit after the order would otherwise mis-size the canvas vs the crop).
   */
  bleedMm: number;
};

export type RenderOutput = {
  /** PNG bytes — photo-only, bleed included, at the target physical size. */
  buffer: Buffer;
  /** Final pixel width at 300dpi. */
  widthPx: number;
  /** Final pixel height at 300dpi. */
  heightPx: number;
};

// ---------- Renderer ----------

/**
 * Normalise the client-baked crop into the 300dpi photo-only print file.
 *
 * Steps:
 *   1. Read the baked crop's pixel dimensions — its aspect tells us the
 *      orientation (가로 ⇒ wide), since it was baked in the oriented stage.
 *   2. Assign the variant's long/short edges to W/H by that orientation.
 *   3. Target physical size = `inner_rect · oriented-variant + 2·bleed`, in mm,
 *      converted to 300dpi pixels. (This equals the baked crop's true size.)
 *   4. Resize the baked crop to the target. `cover` guards against any
 *      sub-pixel aspect drift from rounding without distorting.
 *
 * Side-effect free.
 */
export async function renderPrintFile(input: RenderInput): Promise<RenderOutput> {
  const { photoBuffer, innerRect, variant, bleedMm } = input;

  // ── 1. Baked-crop dimensions → orientation ──────────────────────────────
  const meta = await sharp(photoBuffer).metadata();
  const photoW = meta.width ?? 0;
  const photoH = meta.height ?? 0;
  if (photoW === 0 || photoH === 0) {
    throw new Error('renderPrintFile: photo metadata missing width/height');
  }
  // The baked crop was produced in the oriented editor stage, so its own
  // aspect carries the orientation — no persisted flag needed. Tie (exact
  // square crop) → landscape; harmless because for a square variant hi === lo,
  // and for a non-square variant a square crop can't occur.
  const landscape = photoW >= photoH;

  // ── 2. Oriented variant edges ───────────────────────────────────────────
  const lo = Math.min(variant.widthMm, variant.heightMm);
  const hi = Math.max(variant.widthMm, variant.heightMm);
  const orientedWMm = landscape ? hi : lo;
  const orientedHMm = landscape ? lo : hi;

  // ── 3. Target physical size (= baked crop's true size) ──────────────────
  const bleed = Math.max(0, bleedMm);
  const printWMm = innerRect.w * orientedWMm + 2 * bleed;
  const printHMm = innerRect.h * orientedHMm + 2 * bleed;
  if (!(printWMm > 0) || !(printHMm > 0)) {
    // Degenerate inner_rect (0-width/height) or variant — surface it instead of
    // silently emitting a 1×1px print.
    throw new Error(
      `renderPrintFile: non-positive print size (${printWMm}×${printHMm} mm) — ` +
        `check inner_rect and variant`,
    );
  }
  const targetW = mmToPx(printWMm);
  const targetH = mmToPx(printHMm);

  // Quality guard: if the baked crop is smaller than the 300dpi target it will
  // be upscaled (soft print). Warn so ops can spot under-resolution photos.
  const upscale = Math.max(targetW / photoW, targetH / photoH);
  if (upscale > 1.15) {
    console.warn(
      JSON.stringify({
        event: 'print_render_upscale',
        upscale: Math.round(upscale * 100) / 100,
        crop: { w: photoW, h: photoH },
        target: { w: targetW, h: targetH },
      }),
    );
  }

  // ── 4. Resize to the 300dpi target ──────────────────────────────────────
  // Aspect already matches (uniform scale); `cover` absorbs sub-pixel rounding
  // drift without distortion. Flatten onto white so any alpha (rotated corners
  // baked into the crop) prints as paper-white, not black.
  const buffer = await sharp(photoBuffer)
    .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  return { buffer, widthPx: targetW, heightPx: targetH };
}
