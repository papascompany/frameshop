/**
 * Toss webhook signature verification (UT, TDD 1st priority).
 *
 * Spec: docs/specs/payment.md AC-7, "verifyWebhook" interface.
 */

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { computeSignature, verifyWebhook } from '@/lib/payment/signature';

const SECRET = 'whsec-test-1234';

function sign(body: string, secret: string = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

const validEvent = {
  eventType: 'PAYMENT_STATUS_CHANGED',
  createdAt: '2026-05-12T03:00:00.000Z',
  data: {
    paymentKey: 'pk-abcd1234',
    orderId: '20260512-0001',
    status: 'DONE',
    totalAmount: 12000,
  },
};

describe('computeSignature', () => {
  it('produces the expected HMAC-SHA256 hex digest', () => {
    const body = JSON.stringify(validEvent);
    expect(computeSignature(body, SECRET)).toBe(sign(body));
  });
});

describe('verifyWebhook', () => {
  it('returns valid=true for a correct signature + valid payload', () => {
    const body = JSON.stringify(validEvent);
    const result = verifyWebhook(body, sign(body), SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.data.paymentKey).toBe('pk-abcd1234');
      expect(result.event.data.status).toBe('DONE');
    }
  });

  it('rejects a tampered body', () => {
    const original = JSON.stringify(validEvent);
    const tampered = original.replace('12000', '1');
    const result = verifyWebhook(tampered, sign(original), SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects a wrong signature', () => {
    const body = JSON.stringify(validEvent);
    const result = verifyWebhook(body, 'deadbeef', SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects payloads that fail schema validation', () => {
    const bad = JSON.stringify({ ...validEvent, data: { ...validEvent.data, status: 'NOT_A_STATUS' } });
    const result = verifyWebhook(bad, sign(bad), SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects non-JSON bodies', () => {
    const body = 'not-json';
    const result = verifyWebhook(body, sign(body), SECRET);
    expect(result.valid).toBe(false);
  });
});
