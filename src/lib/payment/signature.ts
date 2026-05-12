/**
 * Toss webhook signature verification.
 *
 * Algorithm (per Toss docs):
 *   HMAC-SHA256(secret = TOSS_WEBHOOK_SECRET, message = rawBody) -> hex
 *   compare with the `tosspayments-signature` header (case-insensitive).
 *
 * Timing-safe equality is used to prevent character-by-character timing
 * attacks. UT 1순위 (PLAN.md §8.1 추가).
 */

import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { webhookEventSchema, type WebhookEvent, type WebhookVerifyResult } from '@/types/payment';

export function computeSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyWebhook(
  rawBody: string,
  signature: string,
  secret: string,
): WebhookVerifyResult {
  const expected = computeSignature(rawBody, secret);
  if (!constantTimeEquals(expected, signature)) {
    return { valid: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { valid: false };
  }

  const result = webhookEventSchema.safeParse(parsed);
  if (!result.success) {
    return { valid: false };
  }
  return { valid: true, event: result.data as WebhookEvent };
}
