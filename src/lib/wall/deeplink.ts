/**
 * Wall → Studio deep-link (FS-EC-04).
 *
 * Studio URL shape: `/studio/{uuid}?productId={id}` (uuid = client-generated
 * session segment). The wall simulator adds OPTIONAL preselect params —
 * `size`, `color`, `orientation` — which StudioClient applies ONCE on initial
 * mount. When absent, the studio behaves exactly as before (no regression).
 *
 * Pure module: usable from both server (page.tsx searchParams parsing) and
 * client (WallClient link building). NO store/Konva imports.
 */

/** Kept structurally identical to the editor's FrameOrientation. */
export type StudioOrientation = 'portrait' | 'landscape';

export type StudioPreselect = {
  sizeCode?: string;
  colorCode?: string;
  orientation?: StudioOrientation;
};

/**
 * Build a studio deep-link with optional preselect params.
 * `sessionId` is the caller-provided URL segment (crypto.randomUUID() for a
 * fresh session) — injected as an argument so the builder stays pure/testable.
 */
export function buildStudioEditUrl(args: {
  sessionId: string;
  productId: string;
  sizeCode?: string;
  colorCode?: string;
  orientation?: StudioOrientation;
}): string {
  const params = new URLSearchParams({ productId: args.productId });
  if (args.sizeCode) params.set('size', args.sizeCode);
  if (args.colorCode) params.set('color', args.colorCode);
  if (args.orientation) params.set('orientation', args.orientation);
  return `/studio/${encodeURIComponent(args.sessionId)}?${params.toString()}`;
}

/**
 * Parse raw searchParams into a StudioPreselect.
 *
 * Shape-level sanitising only (trim + orientation enum) — whether a size/
 * color CODE actually exists in the product's option matrix is validated
 * later by `resolveStudioPreselect` (the matrix lives client-side).
 * Returns null when nothing usable is present, so `preselect == null`
 * preserves the studio's legacy behaviour exactly.
 */
export function parseStudioPreselect(params: {
  size?: string;
  color?: string;
  orientation?: string;
}): StudioPreselect | null {
  const out: StudioPreselect = {};
  const size = params.size?.trim();
  if (size) out.sizeCode = size;
  const color = params.color?.trim();
  if (color) out.colorCode = color;
  if (params.orientation === 'portrait' || params.orientation === 'landscape') {
    out.orientation = params.orientation;
  }
  return out.sizeCode || out.colorCode || out.orientation ? out : null;
}
