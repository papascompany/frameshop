/**
 * /api/payment/confirm contract test — IT.
 *
 * Spec: docs/specs/payment.md AC-3/AC-4.
 * The route handler is the integration unit under test. We assert the input
 * validation behavior; deep DB / Toss interaction is left for separate
 * spec tests when Supabase is wired up.
 */

import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/payment/confirm/route';

describe('POST /api/payment/confirm', () => {
  it('returns 400 BAD_JSON when body is not valid JSON', async () => {
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_JSON');
  });

  it('returns 403 BAD_ORIGIN when Origin is cross-site (P2-05)', async () => {
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Production-style origin from an attacker domain. NODE_ENV=test so
        // the helper only allows same-origin or localhost — `evil.example`
        // matches neither.
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({
        paymentKey: 'pk-test',
        orderId: '20260512-0001',
        amount: 12000,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_ORIGIN');
  });

  it('returns 400 BAD_INPUT when schema rejects the payload', async () => {
    const req = new Request('http://localhost/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentKey: 'pk',
        orderId: 'not-our-format',
        amount: -1,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_INPUT');
  });

  it.todo('returns AMOUNT_MISMATCH when DB total_price != amount');
  it.todo('returns ORDER_NOT_FOUND when orderNo is missing');
  it.todo('returns ALREADY_PAID when order is already PAID');
  it.todo('calls Toss confirm and transitions order on success');
});
