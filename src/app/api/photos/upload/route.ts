/**
 * POST /api/photos/upload
 *
 * Multipart form-data: { file, sessionId? }.
 * Stores resized original + 400px thumb in Supabase Storage `photos`
 * bucket (path: photos/<userId|anon-sessionId>/<uuid>.<ext>).
 *
 * The client SHOULD pre-resize to LONG_EDGE_RESIZE_PX (M-Photo). The server
 * additionally:
 *   - magic-byte verifies the container via `sharp(buffer).metadata()`
 *   - generates a separate thumb (P1-05 fix — no longer reuses original)
 *   - rate-limits per session/user (P1-05 fix)
 */

import 'server-only';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { asBrand } from '@/types/common';
import type { SessionId, UserId } from '@/types/common';
import {
  ALLOWED_PHOTO_MIME,
  MAX_UPLOAD_BYTES,
  THUMB_LONG_EDGE_PX,
  type AllowedPhotoMime,
} from '@/types/photo';
import { createPhoto } from '@/lib/db/photo';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { checkUploadRate } from '@/lib/upload-ratelimit';
import { isSameOrigin } from '@/lib/security/same-origin';

const BUCKET = 'photos';

// Sharp's `format` strings for inputs we accept.
const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }
  const form = await request.formData();
  const file = form.get('file');
  const sessionIdRaw = form.get('sessionId');

  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { ok: false, code: 'NO_FILE' },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, code: 'FILE_TOO_LARGE' },
      { status: 413 },
    );
  }
  const mime = file.type as AllowedPhotoMime;
  if (!ALLOWED_PHOTO_MIME.includes(mime)) {
    return NextResponse.json(
      { ok: false, code: 'UNSUPPORTED_MIME' },
      { status: 415 },
    );
  }

  // Identify caller.
  const supabaseUser = await getServerSupabase();
  const { data: userData } = await supabaseUser.auth.getUser();
  const userId = userData.user?.id ?? null;

  // SECURITY: the guest sessionId is concatenated into the Storage object path
  // (`anon/<sessionId>/...`). Restrict it to a safe token charset so a value
  // containing `/` or `..` cannot escape the `anon/` namespace (path injection).
  const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
  const sessionId =
    typeof sessionIdRaw === 'string' && SAFE_SESSION_ID.test(sessionIdRaw)
      ? sessionIdRaw
      : null;

  if (!userId && !sessionId) {
    // Either no owner at all, or a malformed/unsafe sessionId was supplied.
    return NextResponse.json(
      { ok: false, code: 'NO_OWNER' },
      { status: 400 },
    );
  }

  // Rate limit per identity (P1-05 fix). Phase 2: swap to Upstash KV.
  const rlKey = userId ?? `anon:${sessionId}`;
  const rl = checkUploadRate(rlKey);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', retryAfterSec: rl.retryAfterSec },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Magic-byte / container validation (P1-05 fix). `file.type` is set by the
  // browser and can be spoofed; sharp inspects the actual bytes.
  let detectedFormat: string | undefined;
  let detectedWidth: number | undefined;
  let detectedHeight: number | undefined;
  try {
    const meta = await sharp(bytes).metadata();
    detectedFormat = meta.format;
    detectedWidth = meta.width;
    detectedHeight = meta.height;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: 'INVALID_IMAGE_FORMAT',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 400 },
    );
  }
  if (!detectedFormat || !ALLOWED_SHARP_FORMATS.has(detectedFormat)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'INVALID_IMAGE_FORMAT',
        message: `detected=${detectedFormat ?? 'unknown'}`,
      },
      { status: 400 },
    );
  }

  // LOW-003 FIX: derive extension from a static allowlist map, not by splitting
  // the MIME string (which could produce unexpected values like 'heif+sequence').
  const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
    'image/heif': 'heif',
  };
  const ext = MIME_TO_EXT[mime] ?? 'jpg';
  const uuid = crypto.randomUUID();
  const ownerPath = userId ?? `anon/${sessionId}`;
  const path = `${ownerPath}/${uuid}.${ext}`;
  const thumbPath = `${ownerPath}/${uuid}-thumb.jpg`;

  // Generate a small thumb separately so we don't re-upload the original
  // (P1-05 fix — was 2x Storage cost previously). `fit: 'inside'` preserves
  // aspect ratio; both axes are bounded by THUMB_LONG_EDGE_PX.
  let thumbBuffer: Buffer;
  try {
    thumbBuffer = await sharp(bytes)
      .rotate() // auto-orient via EXIF
      .resize(THUMB_LONG_EDGE_PX, THUMB_LONG_EDGE_PX, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: 'THUMB_GENERATION_FAILED',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }

  // Upload via service role (anon users can't write directly).
  const supabaseSvc = getServiceRoleSupabase();

  const up = await supabaseSvc.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) {
    return NextResponse.json(
      { ok: false, code: 'UPLOAD_FAILED', message: up.error.message },
      { status: 500 },
    );
  }

  const thumbUp = await supabaseSvc.storage
    .from(BUCKET)
    .upload(thumbPath, thumbBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (thumbUp.error) {
    return NextResponse.json(
      { ok: false, code: 'UPLOAD_FAILED', message: thumbUp.error.message },
      { status: 500 },
    );
  }

  // SECURITY FIX (CRITICAL-001): photos bucket is now private.
  // Generate signed URLs for client display. The storage *paths* are persisted
  // so fresh signed URLs can be regenerated at any time via the service-role
  // key (see render pipeline `resolveFreshPhotoUrl`). TTL is 7 days so the
  // cart/checkout/preview window doesn't break the displayed image if the user
  // takes a while between uploading and ordering (was 1 h — too short, a cart
  // older than an hour showed a broken thumbnail).
  const SIGNED_URL_TTL = 7 * 24 * 3600; // 7 days

  const [origSigned, thumbSigned] = await Promise.all([
    supabaseSvc.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL),
    supabaseSvc.storage.from(BUCKET).createSignedUrl(thumbPath, SIGNED_URL_TTL),
  ]);

  if (origSigned.error || !origSigned.data?.signedUrl) {
    return NextResponse.json(
      { ok: false, code: 'SIGN_FAILED', message: origSigned.error?.message ?? 'signed url failed' },
      { status: 500 },
    );
  }
  if (thumbSigned.error || !thumbSigned.data?.signedUrl) {
    return NextResponse.json(
      { ok: false, code: 'SIGN_FAILED', message: thumbSigned.error?.message ?? 'thumb signed url failed' },
      { status: 500 },
    );
  }

  const originalUrl = origSigned.data.signedUrl;
  const thumbUrl = thumbSigned.data.signedUrl;

  try {
    const photo = await createPhoto({
      userId: userId ? asBrand<UserId>(userId) : null,
      sessionId: sessionId ? asBrand<SessionId>(sessionId) : null,
      originalUrl,
      thumbUrl,
      storagePath: path,
      thumbPath,
      // Persist intrinsic dimensions (from sharp metadata) so consumers don't
      // have to decode the bitmap to learn its size.
      ...(detectedWidth ? { widthPx: detectedWidth } : {}),
      ...(detectedHeight ? { heightPx: detectedHeight } : {}),
    });
    return NextResponse.json({ ok: true, photo }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: 'PHOTO_INSERT_FAILED',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
