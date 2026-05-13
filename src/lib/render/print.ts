/**
 * Server-side 300dpi print rendering (Sharp).
 *
 * Source of truth: docs/frame_skills.md §3 (coordinate pipeline), §5
 * (print rendering), §6.5 (2mm bleed), §8 (FE-07/08 acceptance tests).
 *
 * The editor preview lives in Konva stage pixels (sRGB). The print pipeline
 * converts those coordinates to true 300dpi pixels for the configured
 * `product_variants.width_mm × height_mm` and surrounds the inner print area
 * with a 2mm industry-standard bleed on all four sides. Photo rotation,
 * scale, and translation are all expressed about the photo's natural centre
 * (matching Konva's offsetX/offsetY = naturalW/2, naturalH/2 convention).
 *
 * NOT covered in Phase 1:
 *   - ICC colour profile conversion (sRGB only — see frame_skills §5.3).
 *   - PDF output. PNG only.
 *   - Matte layer thickness (Phase 2).
 *
 * Pure function — no IO, no DB access. Callers supply buffers; this module
 * returns a buffer. That keeps it trivially testable and lets the route
 * handler own the Storage upload + DB mutation.
 */

import 'server-only';
import sharp from 'sharp';

// ---------- Constants ----------

export const PRINT_DPI = 300;
export const MM_PER_INCH = 25.4;
/**
 * Industry-standard bleed. See frame_skills §6.5: cutting tolerance is ±1mm,
 * so 2mm of edge replication on all sides prevents white slivers after the
 * trim. Change requires an ADR + downstream print-vendor coordination.
 */
export const BLEED_MM = 2;

// ---------- Helpers ----------

/** mm → pixel at 300dpi. Rounded to the nearest integer pixel. */
export function mmToPx(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * PRINT_DPI);
}

// ---------- Types ----------

export type InnerRectNorm = {
  /** 0..1 normalized X (left edge) of the photo region within the frame PNG. */
  x: number;
  /** 0..1 normalized Y (top edge). */
  y: number;
  /** 0..1 normalized width. */
  w: number;
  /** 0..1 normalized height. */
  h: number;
};

export type CropTransformInput = {
  /** Stage-pixel coordinate where the photo's natural centre is pinned. */
  x: number;
  y: number;
  /** Uniform scale. 1.0 = photo natural pixel size in stage space. */
  scale: number;
  /** Degrees, clockwise positive, applied about the photo centre. */
  rotation: number;
};

export type StageSize = {
  w: number;
  h: number;
};

export type VariantSize = {
  widthMm: number;
  heightMm: number;
};

export type RenderInput = {
  /** Decoded photo bytes (any sharp-supported format). */
  photoBuffer: Buffer;
  /** RGBA PNG frame overlay with transparent inner_rect region. */
  frameBuffer: Buffer;
  /** Photo viewport within the frame PNG (normalized 0..1). */
  innerRect: InnerRectNorm;
  /** Client editor crop transform — stage-pixel coordinates. */
  cropTransform: CropTransformInput;
  /** Client editor stage size — anchors the cropTransform coordinates. */
  stageSize: StageSize;
  /** Target print size (mm). Drives the 300dpi canvas size. */
  variant: VariantSize;
};

export type RenderOutput = {
  /** PNG bytes — bleed included. */
  buffer: Buffer;
  /** Final pixel width (= mmToPx(widthMm + 2*BLEED_MM)). */
  widthPx: number;
  /** Final pixel height. */
  heightPx: number;
};

// ---------- Internal helpers ----------

/**
 * Intersect an off-canvas image rect with the canvas. Returns the slice of
 * the source image to extract and the destination offset at which to paste
 * it, or `null` if there is no overlap.
 *
 * Coordinates are in the canvas's own frame: `place` is where the (unclipped)
 * image's top-left would land; positive means inside, negative means
 * partially off the top/left edge.
 */
function clipToCanvas(
  place: { x: number; y: number; w: number; h: number },
  canvas: { w: number; h: number },
): {
  srcLeft: number;
  srcTop: number;
  width: number;
  height: number;
  dstLeft: number;
  dstTop: number;
} | null {
  const left = Math.max(0, place.x);
  const top = Math.max(0, place.y);
  const right = Math.min(canvas.w, place.x + place.w);
  const bottom = Math.min(canvas.h, place.y + place.h);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return {
    srcLeft: left - place.x,
    srcTop: top - place.y,
    width,
    height,
    dstLeft: left,
    dstTop: top,
  };
}

// ---------- Renderer ----------

/**
 * Render the print-resolution composite for a single order item.
 *
 * Pipeline (frame_skills §5.2):
 *   1. Compute inner-print pixel dimensions from `variant.{width,height}Mm`.
 *   2. Scale the client cropTransform from stage-px into inner-print-px,
 *      then offset by `bleedPx` so coordinates anchor inside the bleed.
 *   3. Resize + rotate the photo about its natural centre.
 *   4. Composite onto a white inner canvas, clipping to the inner_rect.
 *   5. Composite the frame PNG over the top (stretched to the inner size).
 *   6. `extend({ extendWith: 'copy' })` to add a 2mm bleed of replicated
 *      edge pixels on all four sides.
 *   7. Encode PNG.
 *
 * Returns a self-contained `RenderOutput`. Side-effect free.
 */
// P2-04: Memory budget note.
// The pipeline allocates ~5 large Sharp buffers sequentially:
//   photoOut, clippedPhotoLayer, innerCanvas, innerComposite, withBleed.
// For a 4000×4000 source photo on an 11×14 print (≈3307×4205 px at 300dpi),
// each RGBA buffer ≈ 4000×4200×4B ≈ 67MB. Peak heap ≈ 3–4 live buffers ≈ 200MB.
// Vercel Pro Node functions cap at 1024MB — safe with current single-tenant cron.
// Action required before enabling concurrent renders: load-test at ≥5 simultaneous
// 11×14 jobs and validate memory stays below 750MB (75% headroom).
export async function renderPrintFile(input: RenderInput): Promise<RenderOutput> {
  const { variant, stageSize, cropTransform, innerRect, photoBuffer, frameBuffer } = input;

  // ── 1. Canvas dimensions ────────────────────────────────────────────────
  const innerWPx = mmToPx(variant.widthMm);
  const innerHPx = mmToPx(variant.heightMm);
  const bleedPx = mmToPx(BLEED_MM);
  const totalWPx = innerWPx + bleedPx * 2;
  const totalHPx = innerHPx + bleedPx * 2;

  // ── 2. Stage → print scale ──────────────────────────────────────────────
  // The client stage covers the inner print area (Konva aspect ratio is
  // derived from variant mm). A single uniform factor maps both X and Y;
  // we use the X ratio and treat Y as identical (any mismatch is upstream
  // — the editor enforces matching aspect ratios).
  const stageToPrint = innerWPx / stageSize.w;

  // Photo natural size — needed for rotation pivot offsets.
  const photoMeta = await sharp(photoBuffer).metadata();
  const photoW = photoMeta.width ?? 0;
  const photoH = photoMeta.height ?? 0;
  if (photoW === 0 || photoH === 0) {
    throw new Error('renderPrintFile: photo metadata missing width/height');
  }

  // ── 3. Photo transform in inner-print-px space ──────────────────────────
  // Target photo size = naturalSize × stageScale × stageToPrint.
  // Round to integers — sharp resize requires int dims.
  const photoPrintScale = cropTransform.scale * stageToPrint;
  const targetW = Math.max(1, Math.round(photoW * photoPrintScale));
  const targetH = Math.max(1, Math.round(photoH * photoPrintScale));

  // Apply rotation about the photo centre (sharp.rotate defaults to centre
  // pivot when background is uniform — we use transparent so rotated corners
  // stay invisible against the canvas).
  let transformedPhoto = sharp(photoBuffer)
    .resize(targetW, targetH, { fit: 'fill' });

  if (cropTransform.rotation !== 0) {
    transformedPhoto = transformedPhoto.rotate(cropTransform.rotation, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  const photoOut = await transformedPhoto.png().toBuffer();
  const photoOutMeta = await sharp(photoOut).metadata();
  const photoOutW = photoOutMeta.width ?? targetW;
  const photoOutH = photoOutMeta.height ?? targetH;

  // Photo centre in inner-print-px space.
  const centreX = cropTransform.x * stageToPrint;
  const centreY = cropTransform.y * stageToPrint;
  // Top-left of the (rotated) photo bbox so sharp.composite can place it.
  const photoLeft = Math.round(centreX - photoOutW / 2);
  const photoTop = Math.round(centreY - photoOutH / 2);

  // ── 4. Inner canvas — white background, photo clipped to inner_rect ─────
  //
  // We crop the photo to the inner_rect by:
  //   a. compositing the (possibly off-canvas) photo over an inner-rect-
  //      sized transparent layer at the appropriate offset,
  //   b. then placing that layer over the white inner canvas at the inner-
  //      rect position.
  //
  // This guarantees the photo cannot bleed outside the inner_rect even when
  // cropTransform places it far off-centre.
  const irX = Math.round(innerRect.x * innerWPx);
  const irY = Math.round(innerRect.y * innerHPx);
  const irW = Math.max(1, Math.round(innerRect.w * innerWPx));
  const irH = Math.max(1, Math.round(innerRect.h * innerHPx));

  // Photo position relative to inner_rect origin.
  const photoLeftInRect = photoLeft - irX;
  const photoTopInRect = photoTop - irY;

  // sharp.composite rejects an input larger than the base canvas, so we
  // pre-extract the visible portion of the photo (the slice that actually
  // intersects the inner rect) and offset its placement coordinates
  // accordingly. This also discards pixels the editor would have clipped,
  // shrinking memory pressure on large photos.
  const visible = clipToCanvas(
    { x: photoLeftInRect, y: photoTopInRect, w: photoOutW, h: photoOutH },
    { w: irW, h: irH },
  );

  const compositeOps: sharp.OverlayOptions[] = [];
  if (visible) {
    const sliced = await sharp(photoOut)
      .extract({
        left: visible.srcLeft,
        top: visible.srcTop,
        width: visible.width,
        height: visible.height,
      })
      .png()
      .toBuffer();
    compositeOps.push({ input: sliced, left: visible.dstLeft, top: visible.dstTop });
  }

  const clippedPhotoLayer = await sharp({
    create: {
      width: irW,
      height: irH,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(compositeOps)
    .png()
    .toBuffer();

  // Inner canvas (no bleed yet): white base + clipped photo at inner_rect.
  const innerCanvas = await sharp({
    create: {
      width: innerWPx,
      height: innerHPx,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: clippedPhotoLayer, left: irX, top: irY }])
    .png()
    .toBuffer();

  // ── 5. Frame PNG overlay (stretched to inner canvas size) ───────────────
  // The frame PNG's natural pixel size is arbitrary; we resize it to the
  // print inner dimensions so its transparent window lines up with the
  // photo region. Aspect-ratio mismatch is enforced upstream (Admin form).
  const frameResized = await sharp(frameBuffer)
    .resize(innerWPx, innerHPx, { fit: 'fill' })
    .png()
    .toBuffer();

  const innerComposite = await sharp(innerCanvas)
    .composite([{ input: frameResized, left: 0, top: 0 }])
    .png()
    .toBuffer();

  // ── 6. Bleed extension (frame_skills §6.5) ──────────────────────────────
  // `extendWith: 'copy'` replicates the edge pixel row/column outward. This
  // is the conservative default — `'mirror'` would look more natural but is
  // not always desirable on framed prints where the outermost pixels are
  // the frame moulding itself.
  const withBleed = await sharp(innerComposite)
    .extend({
      top: bleedPx,
      bottom: bleedPx,
      left: bleedPx,
      right: bleedPx,
      extendWith: 'copy',
    })
    .png()
    .toBuffer();

  return {
    buffer: withBleed,
    widthPx: totalWPx,
    heightPx: totalHPx,
  };
}
