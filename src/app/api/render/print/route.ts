/**
 * POST /api/render/print
 *
 * Internal-only render trigger. Renders the 300dpi print file for a single
 * order_item and stores the URL on `order_items.print_file_url`.
 *
 * Callers (no public clients):
 *   - `enqueuePrintRender()` in-process (preferred, fire-and-forget on PAID)
 *   - Admin retry endpoint (future)
 *   - cron/jobs runner (future)
 *
 * Authorisation: this route is NOT exposed to browsers. Because middleware
 * cookie auth would let a non-admin session reach the endpoint, we require
 * an `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` header on every
 * call. Admin-role JWT calls are accepted as well for the future admin UI.
 *
 * Body: { orderItemId: uuid }
 * Returns: { ok: true, printFileUrl } | { ok: false, code, message }
 */

import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asBrand } from '@/types/common';
import type { OrderItemId } from '@/types/common';
import { env } from '@/lib/env';
import { getServerSupabase } from '@/lib/supabase/server';
import { renderOrderItemPrint } from '@/lib/render/pipeline';

export const runtime = 'nodejs';
// Sharp can spike CPU + memory; let the platform give the route a longer
// timeout than the default 10s on serverless platforms that honour this.
export const maxDuration = 60;

const inputSchema = z.object({
  orderItemId: z.string().uuid(),
});

export async function POST(request: Request): Promise<Response> {
  // ── AuthZ ───────────────────────────────────────────────────────────────
  const authorised = await isAuthorisedCaller(request);
  if (!authorised) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED', message: 'Service-role or admin required' },
      { status: 401 },
    );
  }

  // ── Input ───────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_JSON', message: 'Invalid JSON' },
      { status: 400 },
    );
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 400 },
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const result = await renderOrderItemPrint(
    asBrand<OrderItemId>(parsed.data.orderItemId),
  );
  if (!result.ok) {
    const status = result.code === 'ORDER_ITEM_NOT_FOUND' ? 404 : 500;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}

/**
 * Two acceptable callers:
 *   1. Service-role bearer (server-to-server, our own enqueue + cron).
 *   2. An admin Supabase session (future admin retry UI).
 *
 * Anything else (anon cookies, missing header) → 401.
 */
async function isAuthorisedCaller(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    // Constant-time compare (HMAC-based) to prevent timing attacks on the key.
    if (constantTimeEqualStr(token, env.supabaseServiceRoleKey())) {
      return true;
    }
  }

  // Fallback: admin session.
  try {
    const supabase = await getServerSupabase();
    const { data } = await supabase.auth.getUser();
    const role =
      (data.user?.app_metadata as { role?: string } | null | undefined)?.role ?? null;
    return role === 'admin';
  } catch {
    return false;
  }
}

/**
 * P0-04: Constant-time string equality using HMAC-SHA256.
 *
 * Why HMAC instead of a direct `crypto.timingSafeEqual`?
 *   `timingSafeEqual` requires equal-length Buffers and throws otherwise,
 *   meaning a naive wrapper must branch on length — leaking whether the
 *   supplied token has the right byte count. Hashing both values with a
 *   random per-call key normalises them to 32 bytes regardless of input
 *   length, so the subsequent `timingSafeEqual` call is truly constant-time.
 *
 * The random key is single-use (not a secret), ensuring the approach works
 * even if an attacker knows the HMAC key.
 */
function constantTimeEqualStr(a: string, b: string): boolean {
  const k = randomBytes(32);
  const ha = createHmac('sha256', k).update(a, 'utf8').digest();
  const hb = createHmac('sha256', k).update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
