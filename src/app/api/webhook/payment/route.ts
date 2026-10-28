/**
 * POST /api/webhook/payment — Toss PAYMENT_STATUS_CHANGED receiver.
 *
 * Truth comes from re-fetching the payment with our secret key
 * (`src/lib/payment/webhook.ts`), so the body is only a hint. When Toss sends
 * a `tosspayments-webhook-signature` header and a 보안 키 is configured, the
 * documented signature is verified too (401 on mismatch); otherwise the
 * delivery proceeds on the re-fetch alone.
 *
 * Responses: 200 handled (Toss stops retrying) · 503 retry wanted (key not
 * configured, Toss/DB transient error, own-cancel grace) · 400 malformed ·
 * 401 bad signature · 429 rate-limited. Toss must get an answer within 10s.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyWebhookSignature } from '@/lib/payment/signature';
import { handlePaymentWebhook } from '@/lib/payment/webhook';
import { getEffectiveTossWebhookSecret } from '@/lib/env';
import { checkRate } from '@/lib/ratelimit';
import { getClientIp } from '@/lib/security/client-ip';

const deliverySchema = z.object({
  eventType: z.string().min(1),
  data: z.object({
    paymentKey: z.string().min(1).max(200),
  }),
});

export async function POST(request: Request): Promise<Response> {
  // Every accepted delivery costs one Toss API call — bound unsigned floods.
  const rate = await checkRate('payment_webhook_ip', getClientIp(request), {
    max: 60,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  const rawBody = await request.text();

  const signature = request.headers.get('tosspayments-webhook-signature');
  if (signature) {
    const secret = await getEffectiveTossWebhookSecret().catch(() => null);
    if (secret) {
      const transmissionTime =
        request.headers.get('tosspayments-webhook-transmission-time') ?? '';
      if (!verifyWebhookSignature(rawBody, transmissionTime, signature, secret)) {
        // Wrong 보안 키 in settings also lands here — Toss keeps retrying
        // (up to 7 times over ~3 days), so fixing the key recovers the events.
        console.error(JSON.stringify({ event: 'webhook_signature_invalid' }));
        return NextResponse.json(
          { ok: false, code: 'INVALID_SIGNATURE' },
          { status: 401 },
        );
      }
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_JSON' }, { status: 400 });
  }
  const parsed = deliverySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'BAD_INPUT' }, { status: 400 });
  }
  if (parsed.data.eventType !== 'PAYMENT_STATUS_CHANGED') {
    // Other event types are not subscribed to; acknowledge so Toss stops.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const retriedHeader = request.headers.get(
    'tosspayments-webhook-transmission-retried-count',
  );
  const retried = retriedHeader === null ? Number.NaN : Number(retriedHeader);
  const result = await handlePaymentWebhook({
    eventType: parsed.data.eventType,
    paymentKey: parsed.data.data.paymentKey,
    rawPayload: body,
    transmissionId: request.headers.get('tosspayments-webhook-transmission-id'),
    retriedCount: Number.isInteger(retried) ? retried : null,
  });

  return result.httpStatus === 200
    ? NextResponse.json({ ok: true }, { status: 200 })
    : NextResponse.json({ ok: false, code: 'RETRY' }, { status: 503 });
}
