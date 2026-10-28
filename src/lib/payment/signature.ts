/**
 * Toss webhook signature verification (documented scheme).
 *
 * Per https://docs.tosspayments.com/reference/using-api/webhook-events :
 *   1. HMAC-SHA256( key = 보안 키,
 *                   message = `{WEBHOOK_PAYLOAD}:{tosspayments-webhook-transmission-time}` )
 *   2. The `tosspayments-webhook-signature` header carries one or more
 *      comma-separated `v1:<base64>` values; base64-decode each.
 *   3. Authentic if the digest equals ANY decoded value.
 *
 * The signature is an optional extra check: the webhook route establishes
 * truth by re-fetching the payment from the Toss API with our secret key, so
 * an unsigned (or unverifiable) delivery is still safe to process. Toss's docs
 * do not say which events carry the header.
 *
 * Timing-safe equality is used to prevent byte-by-byte timing attacks.
 */

import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Raw HMAC digest of `${rawBody}:${transmissionTime}` (exported for tests). */
export function computeSignature(
  rawBody: string,
  transmissionTime: string,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(`${rawBody}:${transmissionTime}`, 'utf8')
    .digest();
}

export function verifyWebhookSignature(
  rawBody: string,
  transmissionTime: string,
  signatureHeader: string,
  secret: string,
): boolean {
  // SECURITY: never verify against an empty/whitespace secret — a blank key
  // would compute an attacker-reproducible HMAC. Empty inputs are invalid.
  if (
    secret.trim().length === 0 ||
    signatureHeader.trim().length === 0 ||
    transmissionTime.trim().length === 0
  ) {
    return false;
  }

  const expected = computeSignature(rawBody, transmissionTime, secret);
  return signatureHeader.split(',').some((part) => {
    const value = part.trim();
    if (!value.startsWith('v1:')) return false;
    const candidate = Buffer.from(value.slice(3), 'base64');
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  });
}
