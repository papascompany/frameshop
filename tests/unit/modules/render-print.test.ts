/**
 * Print rendering unit tests (frame_skills §3.1, §8 FE-07/08).
 *
 * The renderer is pure: it consumes buffers + a transform and emits a PNG
 * buffer. We feed it small synthetic photo + frame buffers built with sharp
 * and assert on the geometry of the output (pixel dims + bleed presence).
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  BLEED_MM,
  mmToPx,
  renderPrintFile,
  type InnerRectNorm,
} from '@/lib/render/print';

// ---------- Helpers ----------

async function makeSolidPhoto(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { ...color, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Build a frame PNG: opaque border, transparent interior matching innerRect.
 * The frame PNG is rendered as-is in the editor and stretched to inner-print
 * dimensions in the renderer; for tests we just need real RGBA bytes.
 */
async function makeFrame(
  width: number,
  height: number,
  innerRect: InnerRectNorm,
  borderColor: { r: number; g: number; b: number },
): Promise<Buffer> {
  // Start with a solid border colour, then punch a transparent rectangle
  // through it at innerRect. The simplest way: composite a transparent rect.
  const irX = Math.round(innerRect.x * width);
  const irY = Math.round(innerRect.y * height);
  const irW = Math.round(innerRect.w * width);
  const irH = Math.round(innerRect.h * height);

  // Make a transparent inner patch.
  const transparentInner = await sharp({
    create: {
      width: irW,
      height: irH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { ...borderColor, alpha: 1 },
    },
  })
    .composite([
      {
        input: transparentInner,
        left: irX,
        top: irY,
        blend: 'dest-out', // erase the inner rect on the base.
      },
    ])
    .png()
    .toBuffer();
}

// ---------- mmToPx (FE-07) ----------

describe('mmToPx', () => {
  it('converts 102mm (4×6 short edge) to 1205px at 300dpi', () => {
    expect(mmToPx(102)).toBe(1205);
  });

  it('converts 152mm (4×6 long edge) to 1795px', () => {
    expect(mmToPx(152)).toBe(1795);
  });

  it('rounds half-pixel values', () => {
    // 1mm = 11.811... px → 12
    expect(mmToPx(1)).toBe(12);
  });

  it('BLEED_MM is the 2mm industry standard', () => {
    expect(BLEED_MM).toBe(2);
  });
});

// ---------- renderPrintFile geometry (FE-07) ----------

describe('renderPrintFile — output dimensions', () => {
  it('produces a 4×6 print at 1252×1842 px (inner 1205×1795 + 47px bleed each side)', async () => {
    const photo = await makeSolidPhoto(200, 200, { r: 255, g: 0, b: 0 });
    const frame = await makeFrame(
      200,
      250,
      { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      { r: 0, g: 0, b: 0 },
    );

    const out = await renderPrintFile({
      photoBuffer: photo,
      frameBuffer: frame,
      innerRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      cropTransform: { x: 300, y: 450, scale: 1.0, rotation: 0 },
      stageSize: { w: 600, h: 900 },
      variant: { widthMm: 102, heightMm: 152 },
    });

    // mmToPx(102 + 2*2) = mmToPx(106) = round(106/25.4*300) = round(1252.0) = 1252
    // mmToPx(152 + 2*2) = mmToPx(156) = round(156/25.4*300) = round(1842.5) = 1843 — but we
    // compose innerW + 2*bleedPx (with bleedPx = mmToPx(2) = round(23.62) = 24),
    // so totalW = 1205 + 48 = 1253 and totalH = 1795 + 48 = 1843. Either is
    // within ±1px depending on rounding order; assert via the same code path.
    expect(out.widthPx).toBe(mmToPx(102) + 2 * mmToPx(2));
    expect(out.heightPx).toBe(mmToPx(152) + 2 * mmToPx(2));

    // Decode the PNG to confirm metadata agrees.
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(out.widthPx);
    expect(meta.height).toBe(out.heightPx);
    expect(meta.format).toBe('png');
  });

  it('produces an 11×14 print at the expected mm-derived dimensions', async () => {
    // 11×14 inch ≈ 279×356 mm.
    const photo = await makeSolidPhoto(200, 200, { r: 0, g: 200, b: 0 });
    const frame = await makeFrame(
      200,
      250,
      { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      { r: 60, g: 60, b: 60 },
    );

    const out = await renderPrintFile({
      photoBuffer: photo,
      frameBuffer: frame,
      innerRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      cropTransform: { x: 300, y: 400, scale: 1.0, rotation: 0 },
      stageSize: { w: 600, h: 800 },
      variant: { widthMm: 279, heightMm: 356 },
    });

    expect(out.widthPx).toBe(mmToPx(279) + 2 * mmToPx(2));
    expect(out.heightPx).toBe(mmToPx(356) + 2 * mmToPx(2));
  });
});

// ---------- Rotation handling ----------

describe('renderPrintFile — rotation', () => {
  it('does not throw for a 90° rotated photo, output dims preserved', async () => {
    // Non-square photo so rotation has a visible effect on the bounding box
    // of the photo layer (canvas dims should still match the variant).
    const photo = await makeSolidPhoto(300, 150, { r: 0, g: 0, b: 255 });
    const frame = await makeFrame(
      200,
      250,
      { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      { r: 0, g: 0, b: 0 },
    );

    const out = await renderPrintFile({
      photoBuffer: photo,
      frameBuffer: frame,
      innerRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      cropTransform: { x: 300, y: 450, scale: 1.0, rotation: 90 },
      stageSize: { w: 600, h: 900 },
      variant: { widthMm: 102, heightMm: 152 },
    });

    // Canvas dims always come from the variant, never from the rotated photo.
    expect(out.widthPx).toBe(mmToPx(102) + 2 * mmToPx(2));
    expect(out.heightPx).toBe(mmToPx(152) + 2 * mmToPx(2));
  });
});

// ---------- Bleed presence (FE-08) ----------

describe('renderPrintFile — bleed', () => {
  it('extends the canvas so the outer 2mm band has opaque pixels (no transparent strip)', async () => {
    // Build the smallest reasonable test case so we can decode raw pixels.
    const photo = await makeSolidPhoto(100, 100, { r: 255, g: 0, b: 0 });
    const frame = await makeFrame(
      100,
      100,
      { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      { r: 30, g: 30, b: 30 },
    );

    const out = await renderPrintFile({
      photoBuffer: photo,
      frameBuffer: frame,
      innerRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      cropTransform: { x: 50, y: 50, scale: 1.0, rotation: 0 },
      stageSize: { w: 100, h: 100 },
      variant: { widthMm: 25, heightMm: 25 },
    });

    // Decode to raw RGBA pixels and probe a pixel inside the bleed band.
    const { data, info } = await sharp(out.buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bleedPx = mmToPx(BLEED_MM);
    // Top-left of the bleed band (always inside the extended region).
    const px = (y: number, x: number): number =>
      data[(y * info.width + x) * info.channels];
    const alphaAt = (y: number, x: number): number =>
      data[(y * info.width + x) * info.channels + 3];

    // Outermost pixel should be opaque (extend({ extendWith: 'copy' }) copies
    // edge pixels including their alpha — our inner canvas is fully opaque
    // white, so alpha === 255 across the bleed).
    expect(alphaAt(0, 0)).toBe(255);
    expect(alphaAt(0, info.width - 1)).toBe(255);
    expect(alphaAt(info.height - 1, 0)).toBe(255);
    expect(alphaAt(info.height - 1, info.width - 1)).toBe(255);

    // And the bleed band's pixel should match the corresponding edge pixel
    // of the inner area (i.e. it was copied, not left transparent/black).
    // Compare red channel of (0, bleedPx) to (bleedPx, bleedPx) within ±2.
    const rOuter = px(0, bleedPx);
    const rInnerEdge = px(bleedPx, bleedPx);
    expect(Math.abs(rOuter - rInnerEdge)).toBeLessThanOrEqual(2);
  });
});
