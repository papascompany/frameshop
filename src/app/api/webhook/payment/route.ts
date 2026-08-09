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
    // 시크릿이 없으면 서명을 검증할 수 없다 = 페이로드를 신뢰할 수 없다.
    // 200(성공)을 돌려주면 Toss 가 재시도를 멈춰 **이벤트가 영구 소실**된다
    // (가상계좌 입금·PG측 취소 통지 유실). 5xx 로 재시도를 유도해 설정 복구
    // 후 이벤트가 살아 돌아오게 한다. 결제 확정 주경로는 /payment/success
    // → confirm 이므로 이 재시도가 결제 완료를 막지는 않는다.
    return NextResponse.json(
      { ok: false, code: 'CONFIG_ERROR' },
      { status: 503 },
    );
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
