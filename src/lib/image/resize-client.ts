/**
 * Client-side image resize utility.
 *
 * Resizes an image File so its longest edge is <= maxSize, preserving aspect
 * ratio. Output is JPEG (quality 0.85) — the original EXIF orientation is
 * baked in via `createImageBitmap({ imageOrientation: 'from-image' })`.
 *
 * Why this exists:
 * - Mobile photos are commonly 4000+px on the long edge (12MB+ JPEG, 24MB+ HEIC).
 * - Uploading the raw file blows up mobile memory and storage cost.
 * - Spec (docs/specs/photo.md, ADR context) requires a pre-upload 1600px resize.
 *
 * Pure browser util — must only be imported from client components.
 */

const FALLBACK_MIME = 'image/jpeg';
const FALLBACK_QUALITY = 0.85;

export class ImageResizeError extends Error {
  readonly code: 'DECODE_FAILED' | 'ENCODE_FAILED' | 'UNSUPPORTED';

  constructor(code: 'DECODE_FAILED' | 'ENCODE_FAILED' | 'UNSUPPORTED', message: string) {
    super(message);
    this.code = code;
    this.name = 'ImageResizeError';
  }
}

type ImageBitmapCreator = (
  file: Blob,
  options?: { imageOrientation?: 'from-image' | 'none' },
) => Promise<ImageBitmap>;

function hasCreateImageBitmap(): boolean {
  return typeof globalThis.createImageBitmap === 'function';
}

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

async function decodeWithBitmap(file: Blob): Promise<ImageBitmap> {
  const creator = globalThis.createImageBitmap as ImageBitmapCreator;
  try {
    return await creator(file, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers (older Safari) reject the options bag; retry without it.
    return await creator(file);
  }
}

type DecodedImage = {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number) => void;
  dispose: () => void;
};

async function decodeViaHtmlImage(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageResizeError('DECODE_FAILED', 'Image decode failed'));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => {
        ctx.drawImage(img, 0, 0, w, h);
      },
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (hasCreateImageBitmap()) {
    try {
      const bmp = await decodeWithBitmap(file);
      return {
        width: bmp.width,
        height: bmp.height,
        draw: (ctx, w, h) => {
          ctx.drawImage(bmp, 0, 0, w, h);
        },
        dispose: () => bmp.close?.(),
      };
    } catch {
      // fall through to HTMLImageElement
    }
  }
  return await decodeViaHtmlImage(file);
}

function computeTargetSize(
  width: number,
  height: number,
  maxSize: number,
): { w: number; h: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxSize) return { w: width, h: height };
  const ratio = maxSize / longEdge;
  return {
    w: Math.max(1, Math.round(width * ratio)),
    h: Math.max(1, Math.round(height * ratio)),
  };
}

async function encodeViaOffscreen(
  draw: DecodedImage['draw'],
  w: number,
  h: number,
  quality: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageResizeError('ENCODE_FAILED', 'No 2D context');
  draw(ctx, w, h);
  return await canvas.convertToBlob({ type: FALLBACK_MIME, quality });
}

async function encodeViaCanvas(
  draw: DecodedImage['draw'],
  w: number,
  h: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageResizeError('ENCODE_FAILED', 'No 2D context');
  draw(ctx, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ImageResizeError('ENCODE_FAILED', 'toBlob returned null'));
      },
      FALLBACK_MIME,
      quality,
    );
  });
}

/**
 * Resize an image File so its longest edge is at most `maxSize` px.
 *
 * If the source is already smaller than `maxSize`, the function still
 * re-encodes as JPEG q=0.85 (this normalizes HEIC/PNG/WebP into a single,
 * upload-friendly format and applies EXIF orientation).
 *
 * @throws {ImageResizeError} `DECODE_FAILED` if the browser can't decode the file
 *                            `ENCODE_FAILED` if canvas encoding fails
 *                            `UNSUPPORTED`   if neither codec path is available
 */
export async function resizeImageToMax(file: File, maxSize: number): Promise<Blob> {
  if (typeof window === 'undefined') {
    throw new ImageResizeError('UNSUPPORTED', 'Browser-only utility');
  }
  if (maxSize <= 0) {
    throw new ImageResizeError('UNSUPPORTED', 'maxSize must be positive');
  }

  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(file);
  } catch (err) {
    if (err instanceof ImageResizeError) throw err;
    throw new ImageResizeError('DECODE_FAILED', 'Image decode failed');
  }

  try {
    const { w, h } = computeTargetSize(decoded.width, decoded.height, maxSize);
    if (hasOffscreenCanvas()) {
      try {
        return await encodeViaOffscreen(decoded.draw, w, h, FALLBACK_QUALITY);
      } catch {
        // fall back to <canvas>
      }
    }
    return await encodeViaCanvas(decoded.draw, w, h, FALLBACK_QUALITY);
  } finally {
    decoded.dispose();
  }
}
