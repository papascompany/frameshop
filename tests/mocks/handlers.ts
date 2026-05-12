/**
 * MSW request handlers.
 *
 * Covers the surfaces our integration tests hit: Supabase REST, Toss
 * confirm API, and our own internal routes. Tests can override specific
 * handlers per-suite with `server.use(...)`.
 */

import { http, HttpResponse } from 'msw';

const SUPABASE_REST = /\.supabase\.co\/rest\/v1/;
const TOSS_CONFIRM = 'https://api.tosspayments.com/v1/payments/confirm';

export const handlers = [
  // ── Supabase REST fallthrough: return empty arrays so reads don't crash.
  http.get(SUPABASE_REST, () => HttpResponse.json([])),
  http.post(SUPABASE_REST, () => HttpResponse.json([])),
  http.patch(SUPABASE_REST, () => HttpResponse.json([])),
  http.delete(SUPABASE_REST, () => HttpResponse.json([])),

  // ── Toss confirm (default success — tests override for failures).
  http.post(TOSS_CONFIRM, async ({ request }) => {
    const body = (await request.json()) as {
      paymentKey: string;
      orderId: string;
      amount: number;
    };
    return HttpResponse.json({
      paymentKey: body.paymentKey,
      orderId: body.orderId,
      status: 'DONE',
      totalAmount: body.amount,
      method: 'CARD',
      approvedAt: new Date().toISOString(),
    });
  }),

  // ── Our internal routes (used by integration tests for ui code).
  http.get('/api/cart', () =>
    HttpResponse.json({ ok: true, items: [] }),
  ),
];
