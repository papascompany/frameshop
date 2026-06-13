/**
 * Render-pipeline orchestration.
 *
 * Glue between `renderPrintFile` (pure, photo-only normaliser) and the database
 * + Supabase Storage. Owns:
 *   - loading the order_item snapshot + sibling frame_asset (for inner_rect) +
 *     variant,
 *   - fetching the baked print-crop buffer (HTTPS or `supabase.storage`),
 *   - resolving the frozen per-product bleed,
 *   - calling `renderPrintFile`,
 *   - uploading the result to the `previews` bucket under
 *     `print/<orderNo>-<itemIdx>.png`,
 *   - persisting `order_items.print_file_url`.
 *
 * Photo-only pipeline (product decision 2026-06-13): the frame moulding is NOT
 * printed, so the frame PNG is never fetched — `frame_asset` is loaded only for
 * its `inner_rect` (print-window size). `stage_size`/`crop_transform` columns
 * are likewise unused (legacy of the retired frame-composite path).
 *
 * Defensive default (frame_skills §5.1): missing `frame_asset_id` → fall back to
 * a frame_asset on the same product matching the snapshot's colour code.
 */

import 'server-only';
import type { OrderItemId } from '@/types/common';
import { getServiceRoleSupabase } from '../supabase/service';
import { renderPrintFile, BLEED_MM, type InnerRectNorm } from './print';
import { envPublic } from '../env-public';

// Same fallback used by the editor when a frame_asset has a malformed inner_rect.
const DEFAULT_INNER_RECT: InnerRectNorm = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

const PREVIEWS_BUCKET = 'previews';

export type RenderOrderItemResult =
  | { ok: true; printFileUrl: string }
  | { ok: false; code: RenderErrorCode; message: string };

export type RenderErrorCode =
  | 'ORDER_ITEM_NOT_FOUND'
  | 'VARIANT_MISSING'
  | 'FRAME_ASSET_MISSING'
  | 'PHOTO_FETCH_FAILED'
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
    /** Per-product bleed (mm) frozen at order creation. Absent on legacy rows. */
    bleedMm?: number;
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
      .select('id, product_id, color_code, inner_rect')
      .eq('id', item.frame_asset_id)
      .maybeSingle();
    frame = data as FrameAssetRow | null;
  }
  if (!frame) {
    const { data } = await supabase
      .from('frame_assets')
      .select('id, product_id, color_code, inner_rect')
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

  // 4. inner_rect — sanity check + fallback. Drives the print's physical size
  //    (print window = inner_rect of the oriented variant).
  const innerRect = sanitiseInnerRect(frame.inner_rect);

  // 5. Per-product bleed (mm). MUST equal the value the client baked the crop
  //    with, or the canvas won't match the crop's true size (fit:'cover' would
  //    crop/border). The order snapshot FREEZES it at order creation, so admin
  //    edits to products.bleed_mm after the order can't corrupt the render.
  //    Legacy orders predating the frozen field fall back to the live value.
  const frozenBleed = item.variant_snapshot.bleedMm;
  const bleedMm =
    typeof frozenBleed === 'number' && Number.isFinite(frozenBleed) && frozenBleed >= 0
      ? frozenBleed
      : await resolveBleedMm(supabase, variant.product_id);

  // 6. Fetch the baked print crop bytes.
  //
  // `photo_url` is the client-baked, print-ready crop (inner_rect + bleed,
  // oriented, full-res). It's a short-lived signed URL minted at upload time
  // and will have EXPIRED by render time (renders happen on payment
  // confirmation, well after upload). Re-sign from the photo's durable
  // `storage_path` so the fetch always uses a fresh URL. Falls back to the
  // stored URL for legacy/external photos with no path.
  const photoFetchUrl = await resolveFreshPhotoUrl(supabase, item.photo_url);
  let photoBuffer: Buffer;
  try {
    photoBuffer = await fetchAsBuffer(photoFetchUrl);
  } catch (err) {
    return {
      ok: false,
      code: 'PHOTO_FETCH_FAILED',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // 7. Render — photo-only (no frame moulding printed); the baked crop is
  //    normalised to its exact 300dpi physical size. Orientation comes from
  //    the baked crop's own aspect (set in renderPrintFile).
  let rendered;
  try {
    rendered = await renderPrintFile({
      photoBuffer,
      innerRect,
      variant: { widthMm: variant.width_mm, heightMm: variant.height_mm },
      bleedMm,
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
 * render pipeline. This prevents an attacker-controlled `photo_url` from being
 * used to probe cloud-metadata endpoints (e.g. 169.254.169.254) or internal
 * services.
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

const PHOTOS_BUCKET = 'photos';
/** Fresh signed-URL TTL for re-signing a photo at render time (1 hour is plenty
 *  — the URL is used immediately for the render fetch and then discarded). */
const RENDER_PHOTO_SIGN_TTL = 60 * 60;

/**
 * Resolve a currently-valid URL for an order item's photo.
 *
 * Order items store the signed URL captured at upload time, which expires long
 * before the render runs. We look the photo up by its stored `original_url`
 * (an exact match — the same string was persisted on both rows) to recover the
 * durable `storage_path`, then mint a fresh signed URL. If the photo has no
 * row/path (e.g. legacy or external artwork URLs), we fall back to the stored
 * URL and let the SSRF-guarded fetch try it directly.
 */
async function resolveFreshPhotoUrl(
  supabase: ReturnType<typeof getServiceRoleSupabase>,
  storedPhotoUrl: string,
): Promise<string> {
  try {
    const { data } = await supabase
      .from('photos')
      .select('storage_path')
      .eq('original_url', storedPhotoUrl)
      .maybeSingle();
    const storagePath = (data as { storage_path: string | null } | null)?.storage_path;
    if (storagePath) {
      const signed = await supabase.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrl(storagePath, RENDER_PHOTO_SIGN_TTL);
      if (signed.data?.signedUrl) return signed.data.signedUrl;
    }
  } catch {
    // Non-fatal — fall back to the stored URL below.
  }
  return storedPhotoUrl;
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

/**
 * Resolve the per-product bleed (mm). Admin-configured via `products.bleed_mm`
 * (NOT NULL DEFAULT 0; `0` = "정사이즈"/exact-cut). The client baked the crop
 * with this same value, so reusing it keeps the print canvas sized to the
 * baked crop's true physical extent (uniform resize, no rescale). Falls back to
 * the industry-standard `BLEED_MM` only if the row is unreadable.
 */
async function resolveBleedMm(
  supabase: ReturnType<typeof getServiceRoleSupabase>,
  productId: string,
): Promise<number> {
  try {
    const { data } = await supabase
      .from('products')
      .select('bleed_mm')
      .eq('id', productId)
      .maybeSingle();
    const raw = (data as { bleed_mm: number | string | null } | null)?.bleed_mm;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n;
  } catch {
    // Non-fatal — fall back to the industry-standard default below.
  }
  return BLEED_MM;
}
