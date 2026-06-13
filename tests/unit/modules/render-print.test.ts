/**
 * Print rendering unit tests (photo-only renderer — product decision
 * 2026-06-13).
 *
 * The renderer is pure: it consumes the client-baked crop buffer + the print
 * geometry (inner_rect, variant mm, per-product bleed) and emits a 300dpi PNG.
 * Orientation is derived from the baked crop's own aspect. We feed it small
 * synthetic crops built with sharp and assert on the output geometry.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  BLEED_MM,
  mmToPx,
  renderPrintFile,
} from '@/lib/render/print';

// ---------- Helpers ----------

async function makeSolidPhoto(
  width: number,
  height: number,
  color: { r: number; g: number; b: number } = { r: 255, g: 0, b: 0 },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { ...color, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

const FULL = { x: 0, y: 0, w: 1, h: 1 };

// ---------- mmToPx (FE-07) ----------

describe('mmToPx', () => {
  it('converts 102mm (4×6 short edge) to 1205px at 300dpi', () => {
    expect(mmToPx(102)).toBe(1205);
  });

  it('converts 152mm (4×6 long edge) to 1795px', () => {
    expect(mmToPx(152)).toBe(1795);
  });

  it('BLEED_MM default is the 2mm industry standard', () => {
    expect(BLEED_MM).toBe(2);
  });
});

// ---------- Photo-only output dimensions ----------

describe('renderPrintFile — output dimensions (photo-only)', () => {
  it('4×6 portrait, full window, no bleed → 1205×1795 px', async () => {
    const out = await renderPrintFile({
      photoBuffer: await makeSolidPhoto(400, 600), // portrait crop
      innerRect: FULL,
      variant: { widthMm: 102, heightMm: 152 },
      bleedMm: 0,
    });
    expect(out.widthPx).toBe(mmToPx(102));
    expect(out.heightPx).toBe(mmToPx(152));

    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(out.widthPx);
    expect(meta.height).toBe(out.heightPx);
    expect(meta.format).toBe('png');
  });

  it('4×6 LANDSCAPE crop swaps the canvas to wide → 1795×1205 px', async () => {
    // Same variant (stored portrait 102×152) but the baked crop is landscape.
    // Orientation must come from the crop's aspect, not the raw variant.
    const out = await renderPrintFile({
      photoBuffer: await makeSolidPhoto(600, 400), // landscape crop
      innerRect: FULL,
      variant: { widthMm: 102, heightMm: 152 },
      bleedMm: 0,
    });
    expect(out.widthPx).toBe(mmToPx(152)); // wide
    expect(out.heightPx).toBe(mmToPx(102));
  });

  it('per-product bleed expands the canvas on every side', async () => {
    const out = await renderPrintFile({
      photoBuffer: await makeSolidPhoto(400, 600),
      innerRect: FULL,
      variant: { widthMm: 102, heightMm: 152 },
      bleedMm: 2,
    });
    expect(out.widthPx).toBe(mmToPx(102 + 2 * 2)); // mmToPx(106) = 1252
    expect(out.heightPx).toBe(mmToPx(152 + 2 * 2)); // mmToPx(156) = 1843
  });

  it('bleed 0 ("정사이즈") prints exactly the inner-window physical size', async () => {
    // Matted frame: inner window is 80% of the frame.
    const out = await renderPrintFile({
      photoBuffer: await makeSolidPhoto(400, 600),
      innerRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      variant: { widthMm: 102, heightMm: 152 },
      bleedMm: 0,
    });
    expect(out.widthPx).toBe(mmToPx(0.8 * 102));
    expect(out.heightPx).toBe(mmToPx(0.8 * 152));
  });

  it('11×14 portrait, full window, 2mm bleed → mm-derived dims', async () => {
    const out = await renderPrintFile({
      photoBuffer: await makeSolidPhoto(800, 1000),
      innerRect: FULL,
      variant: { widthMm: 279, heightMm: 356 },
      bleedMm: 2,
    });
    expect(out.widthPx).toBe(mmToPx(279 + 4));
    expect(out.heightPx).toBe(mmToPx(356 + 4));
  });
});

// ---------- Degenerate input ----------

describe('renderPrintFile — invalid geometry', () => {
  it('throws on a zero-area inner_rect instead of emitting a 1×1px print', async () => {
    await expect(
      renderPrintFile({
        photoBuffer: await makeSolidPhoto(400, 600),
        innerRect: { x: 0, y: 0, w: 0, h: 1 },
        variant: { widthMm: 102, heightMm: 152 },
        bleedMm: 0,
      }),
    ).rejects.toThrow(/non-positive print size/);
  });
});

// ---------- White background (alpha flattened) ----------

describe('renderPrintFile — opaque output', () => {
  it('flattens any alpha so the print has no transparent pixels', async () => {
    // A crop with a transparent corner (e.g. baked rotation) must print white.
    const withAlpha = await sharp({
      create: { width: 300, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const out = await renderPrintFile({
      photoBuffer: withAlpha,
      innerRect: FULL,
      variant: { widthMm: 102, heightMm: 152 },
      bleedMm: 0,
    });

    const { data, info } = await sharp(out.buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (y: number, x: number): number =>
      data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(0, 0)).toBe(255);
    expect(alphaAt(info.height - 1, info.width - 1)).toBe(255);
    // Flattened transparent → white.
    const r = data[0];
    const g = data[1];
    const b = data[2];
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });
});
