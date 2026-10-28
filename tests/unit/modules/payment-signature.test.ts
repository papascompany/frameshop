/**
 * Toss webhook signature verification — documented scheme
 * (https://docs.tosspayments.com/reference/using-api/webhook-events):
 * HMAC-SHA256(보안 키, `${payload}:${transmission-time}`) compared against the
 * base64 values after `v1:` in `tosspayments-webhook-signature`.
 */

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { computeSignature, verifyWebhookSignature } from '@/lib/payment/signature';

const SECRET = 'security-key-test-1234';
const TIME = '2026-10-28T10:00:00.000000';

/** Independent re-implementation of the documented scheme (the oracle). */
function header(body: string, time: string = TIME, secret: string = SECRET): string {
  const digest = createHmac('sha256', secret).update(`${body}:${time}`, 'utf8').digest('base64');
  return `v1:${digest}`;
}

const BODY = JSON.stringify({
  eventType: 'PAYMENT_STATUS_CHANGED',
  createdAt: '2026-10-28T10:00:00.000000',
  data: { paymentKey: 'pk-abcd1234', orderId: '20261028-0001', status: 'DONE', totalAmount: 12000 },
});

describe('computeSignature', () => {
  it('hashes `${payload}:${transmissionTime}` with HMAC-SHA256', () => {
    expect(computeSignature(BODY, TIME, SECRET).toString('base64')).toBe(
      header(BODY).slice(3),
    );
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a correct v1 signature', () => {
    expect(verifyWebhookSignature(BODY, TIME, header(BODY), SECRET)).toBe(true);
  });

  it('accepts when ANY of several comma-separated signatures matches', () => {
    const multi = `v1:${Buffer.from('rotated-old-key').toString('base64')}, ${header(BODY)}`;
    expect(verifyWebhookSignature(BODY, TIME, multi, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = BODY.replace('12000', '1');
    expect(verifyWebhookSignature(tampered, TIME, header(BODY), SECRET)).toBe(false);
  });

  it('rejects a different transmission time (time is part of the signed message)', () => {
    expect(
      verifyWebhookSignature(BODY, '2026-10-28T10:00:01.000000', header(BODY), SECRET),
    ).toBe(false);
  });

  it('rejects a signature made with another key', () => {
    expect(
      verifyWebhookSignature(BODY, TIME, header(BODY, TIME, 'other-key'), SECRET),
    ).toBe(false);
  });

  it('rejects values without the v1: prefix (e.g. the old bare-hex scheme)', () => {
    const bareHex = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
    expect(verifyWebhookSignature(BODY, TIME, bareHex, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, TIME, header(BODY).slice(3), SECRET)).toBe(false);
  });

  it.each([
    ['blank secret', BODY, TIME, header(BODY), '   '],
    ['blank header', BODY, TIME, '', SECRET],
    ['blank transmission time', BODY, '', header(BODY), SECRET],
  ])('rejects %s', (_label, body, time, sig, secret) => {
    expect(verifyWebhookSignature(body, time, sig, secret)).toBe(false);
  });
});
