/**
 * POST /api/webhook/payment
 *
 * Toss-Signature header MUST be present and valid.
 * Returns 200 on idempotent success, 401 on bad signature, 422 on schema fail.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { verifyWebhook } from '@/lib/payment/signature';
import { handleWebhook } from '@/lib/payment/confirm';
import { getEffectiveTossWebhookSecret } from '@/lib/env';

export async function POST(request: Request): Promise<Response> {
  const signature =
    request.headers.get('tosspayments-signature') ??
    request.headers.get('toss-signature') ??
    '';
  const rawBody = await request.text();

  // MEDIUM-004 FIX: use getEffectiveTossWebhookSecret (env-var → DB fallback)
  // instead of env.tossWebhookSecret() which throws if the env var is unset,
  // causing a 500 → Toss retries forever → orders never reach PAID status.
  let webhookSecret: string;
  try {
    webhookSecret = await getEffectiveTossWebhookSecret();
  } catch {
    console.error(JSON.stringify({ event: 'webhook_secret_missing' }));
    // Return 200 so Toss stops retrying; log for investigation.
    return NextResponse.json({ ok: false, code: 'CONFIG_ERROR' }, { status: 200 });
  }

  const verified = verifyWebhook(rawBody, signature, webhookSecret);
  if (!verified.valid) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_SIGNATURE' },
      { status: 401 },
    );
  }

  try {
    await handleWebhook(verified.event);
  } catch (err) {
    // Don't 500 — Toss will retry. Log raw and accept.
    console.error(
      JSON.stringify({
        event: 'webhook_handler_error',
        message: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
