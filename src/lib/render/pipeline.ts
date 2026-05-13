/**
 * Render-pipeline orchestration.
 *
 * Glue between `renderPrintFile` (pure compositor) and the database +
 * Supabase Storage. Owns:
 *   - loading the order_item snapshot + sibling frame_asset + variant,
 *   - fetching the photo + frame buffers (HTTPS or `supabase.storage`),
 *   - calling `renderPrintFile`,
 *   - uploading the result to the `previews` bucket under
 *     `print/<orderNo>-<itemIdx>.png`,
 *   - persisting `order_items.print_file_url`.
 *
 * Defensive defaults (frame_skills §5.1):
 *   - missing `stage_size` (legacy rows) → derive from `variant.widthMm`
 *     scaled to an 800px longer edge, matching the editor's BASE_STAGE_PX.
 *   - missing `frame_asset_id` → fall back to a frame_asset on the same
 *     product matching the snapshot's colour code.
 */

import 'server-only';
import type { OrderItemId } from '@/types/common';
import { getServiceRoleSupabase } from '../supabase/service';
import { renderPrintFile, type InnerRectNorm } from './print';
import { envPublic } from '../env-public';

// Same fallback used by the editor when a frame_asset has a malformed inner_rect.
const DEFAULT_INNER_RECT: InnerRectNorm = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

// Editor base stage longer-edge (matches BASE_STAGE_PX in studio client).
// Used only as a fallback for legacy order_items missing stage_size.
const FALLBACK_STAGE_LONG_EDGE = 800;

const PREVIEWS_BUCKET = 'previews';

export type RenderOrderItemResult =
  | { ok: true; printFileUrl: string }
  | { ok: false; code: RenderErrorCode; message: string };

export type RenderErrorCode =
  | 'ORDER_ITEM_NOT_FOUND'
  | 'VARIANT_MISSING'
  | 'FRAME_ASSET_MISSING'
  | 'PHOTO_FETCH_FAILED'
  | 'FRAME_FETCH_FAILED'
  | 'RENDER_FAILED'
  | 'UPLOAD_FAILED'
  | 'DB_UPDATE_FAILED';

type OrderItemRow = {
  id: string;
  order_id: string;
  variant_snapshot: {
    variantId: string;
    productId: string;
    productName: string;
    sizeLabel: string;
    colorLabel: string;
    unitPrice: number;
    options: { sizeCode: string; colorCode: string; matteCode: string; paperCode: string };
  };
  photo_url: string;
  crop_transform: { x: number; y: number; scale: number; rotation: number };
  print_file_url: string | null;
  frame_asset_id: string | null;
  stage_size: { w: number; h: number } | null;
  quantity: number;
};

type VariantRow = {
  id: string;
  product_id: string;
  width_mm: number;
  height_mm: number;
  color_code: string;
};

type FrameAssetRow = {
  id: string;
  product_id: string;
  color_code: string;
  png_url: string;
  inner_rect: InnerRectNorm;
};

type OrderRow = { order_no: string };

/**
 * Render and persist the 300dpi print file for a single order item.
 *
 * Idempotent: if `print_file_url` is already set the function returns the
 * existing URL without re-rendering. Callers can re-enqueue freely.
 */
export async function renderOrderItemPrint(
  orderItemId: OrderItemId,
): Promise<RenderOrderItemResult> {
  const supabase = getServiceRoleSupabase();

  // 1. Load order_item + sibling rows.
  const { data: itemRow, error: itemErr } = await supabase
    .from('order_items')
    .select('*')
    .eq('id', orderItemId as string)
    .maybeSingle();

  if (itemErr || !itemRow) {
    return {
      ok: false,
      code: 'ORDER_ITEM_NOT_FOUND',
      message: itemErr?.message ?? `order_item ${orderItemId} not found`,
    };
  }

  const item = itemRow as OrderItemRow;

  // Idempotency: skip if already rendered.
  if (item.print_file_url) {
    return { ok: true, printFileUrl: item.print_file_url };
  }

  // 2. Variant — for widthMm/heightMm.
  const { data: variantRow, error: vErr } = await supabase
    .from('product_variants')
    .select('id, product_id, width_mm, height_mm, color_code')
    .eq('id', item.variant_snapshot.variantId)
    .maybeSingle();

  if (vErr || !variantRow) {
    return {
      ok: false,
      code: 'VARIANT_MISSING',
      message: vErr?.message ?? `variant ${item.variant_snapshot.variantId} missing`,
    };
  }
  const variant = variantRow as VariantRow;

  // 3. Frame asset — by direct FK, or by (product, color) fallback.
  let frame: FrameAssetRow | null = null;
  if (item.frame_asset_id) {
    const { data } = await supabase
      .from('frame_assets')
      .select('id, product_id, color_code, png_url, inner_rect')
      .eq('id', item.frame_asset_id)
      .maybeSingle();
    frame = data as FrameAssetRow | null;
  }
  if (!frame) {
    const { data } = await supabase
      .from('frame_assets')
      .select('id, product_id, color_code, png_url, inner_rect')
      .eq('product_id', variant.product_id)
      .eq('color_code', variant.color_code)
      .maybeSingle();
    frame = data as FrameAssetRow | null;
  }
  if (!frame) {
    return {
      ok: false,
      code: 'FRAME_ASSET_MISSING',
      message: `no frame_asset for product=${variant.product_id} color=${variant.color_code}`,
    };
  }

  // 4. Stage size — use saved value or derive from variant aspect ratio.
  const stageSize = item.stage_size ?? deriveFallbackStageSize(variant);

  // 5. inner_rect — sanity check + fallback.
  const innerRect = sanitiseInnerRect(frame.inner_rect);

  // 6. Fetch photo + frame bytes.
  let photoBuffer: Buffer;
  try {
    photoBuffer = await fetchAsBuffer(item.photo_url);
  } catch (err) {
    return {
      ok: false,
      code: 'PHOTO_FETCH_FAILED',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  let frameBuffer: Buffer;
  try {
    frameBuffer = await fetchAsBuffer(frame.png_url);
  } catch (err) {
    return {
      ok: false,
      code: 'FRAME_FETCH_FAILED',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // 7. Render.
  let rendered;
  try {
    rendered = await renderPrintFile({
      photoBuffer,
      frameBuffer,
      innerRect,
      cropTransform: item.crop_transform,
      stageSize,
      variant: { widthMm: variant.width_mm, heightMm: variant.height_mm },
    });
  } catch (err) {
    return {
      ok: false,
      code: 'RENDER_FAILED',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // 8. Resolve order_no for path naming.
  const { data: orderRow } = await supabase
    .from('orders')
    .select('order_no')
    .eq('id', item.order_id)
    .maybeSingle();
  const orderNo = (orderRow as OrderRow | null)?.order_no ?? item.order_id;

  // 9. Upload to Storage.
  const path = `print/${orderNo}-${item.id}.png`;
  const up = await supabase.storage
    .from(PREVIEWS_BUCKET)
    .upload(path, rendered.buffer, { contentType: 'image/png', upsert: true });
  if (up.error) {
    return {
      ok: false,
      code: 'UPLOAD_FAILED',
      message: up.error.message,
    };
  }

  // P1-01: Generate a signed URL (7-day TTL) instead of a public URL.
  // The `previews` bucket is private — only service-role can upload; the
  // signed URL is the only access path. After 7 days the URL must be
  // regenerated (re-triggering the render resets it).
  const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
  const signed = await supabase.storage
    .from(PREVIEWS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    return {
      ok: false,
      code: 'UPLOAD_FAILED',
      message: signed.error?.message ?? 'createSignedUrl returned no URL',
    };
  }
  const printFileUrl = signed.data.signedUrl;

  // 10. Persist URL.
  const { error: updErr } = await supabase
    .from('order_items')
    .update({ print_file_url: printFileUrl })
    .eq('id', item.id);
  if (updErr) {
    return { ok: false, code: 'DB_UPDATE_FAILED', message: updErr.message };
  }

  console.info(
    JSON.stringify({
      event: 'print_render_complete',
      orderItemId: item.id,
      orderNo,
      widthPx: rendered.widthPx,
      heightPx: rendered.heightPx,
    }),
  );

  return { ok: true, printFileUrl };
}

// ---------- helpers ----------

/**
 * P0-02 SSRF allowlist.
 *
 * Only HTTPS URLs pointing to known-safe image hosts may be fetched by the
 * render pipeline. This prevents an attacker-controlled `photo_url` or
 * `frame.png_url` from being used to probe cloud-metadata endpoints
 * (e.g. 169.254.169.254) or internal services.
 *
 * Allowed hosts:
 *   - Our own Supabase project host (NEXT_PUBLIC_SUPABASE_URL hostname)
 *   - Any *.supabase.co (covers region-specific storage CDN subdomains)
 *   - Unsplash image CDN (images.unsplash.com, plus.unsplash.com)
 */
function isAllowedImageHost(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false; // reject non-parseable or relative URLs
  }
  if (parsed.protocol !== 'https:') return false;
  const { hostname } = parsed;

  // Supabase project host.
  try {
    const supabaseHost = new URL(envPublic.supabaseUrl()).hostname;
    if (hostname === supabaseHost) return true;
  } catch {
    // envPublic misconfigured — fall through to wildcard check.
  }
  // Supabase Storage CDN (wildcard).
  if (hostname.endsWith('.supabase.co')) return true;
  // Unsplash image CDN.
  if (hostname === 'images.unsplash.com' || hostname === 'plus.unsplash.com') return true;

  return false;
}

async function fetchAsBuffer(url: string): Promise<Buffer> {
  // P0-02: Guard against SSRF before making any outbound request.
  if (!isAllowedImageHost(url)) {
    let host = '(invalid URL)';
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    throw new Error(`SSRF guard: host "${host}" is not in the image allowlist`);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function sanitiseInnerRect(raw: unknown): InnerRectNorm {
  if (!raw || typeof raw !== 'object') return DEFAULT_INNER_RECT;
  const r = raw as Partial<InnerRectNorm>;
  const within = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  if (!within(r.x) || !within(r.y) || !within(r.w) || !within(r.h)) {
    return DEFAULT_INNER_RECT;
  }
  if ((r.x ?? 0) + (r.w ?? 0) > 1 || (r.y ?? 0) + (r.h ?? 0) > 1) {
    return DEFAULT_INNER_RECT;
  }
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

function deriveFallbackStageSize(variant: VariantRow): { w: number; h: number } {
  // Match BASE_STAGE_PX = 800 with the longer edge.
  const ratio = variant.width_mm / variant.height_mm;
  if (ratio >= 1) {
    return { w: FALLBACK_STAGE_LONG_EDGE, h: Math.round(FALLBACK_STAGE_LONG_EDGE / ratio) };
  }
  return { w: Math.round(FALLBACK_STAGE_LONG_EDGE * ratio), h: FALLBACK_STAGE_LONG_EDGE };
}
