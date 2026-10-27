/**
 * /api/cron/payment-sweep — Vercel Cron route for the payment confirm backstop.
 *
 * Reconciles CREATED orders the success-page confirm never finished: settles
 * payments Toss already approved (PAID), and expires abandoned unpaid orders
 * (CANCELLED + redeemed points restored). Logic lives in
 * `src/lib/payment/sweep.ts`; this route only authenticates and reports.
 *
 * Invocation: Vercel Cron (vercel.json `crons`) fires a GET once daily
 * (Hobby plan limit). Vercel adds `Authorization: Bearer <CRON_SECRET>` when
 * `CRON_SECRET` is configured on the project.
 *
 * Reference: https://vercel.com/docs/cron-jobs/quickstart
 */

import { type NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sweepUnconfirmedOrders } from '@/lib/payment/sweep';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Same constant-time CRON_SECRET check as /api/cron/render-retry. */
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // CRON_SECRET not configured — only allow in non-production (local dev).
    return process.env.NODE_ENV !== 'production';
  }
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${cronSecret}`;
  if (auth.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const summary = await sweepUnconfirmedOrders();

  const count = (action: string) =>
    summary.outcomes.filter((o) => o.action === action).length;
  const counts = {
    confirmed: count('confirmed'),
    expired: count('expired'),
    waiting: count('waiting'),
    confirmFailed: count('confirm_failed'),
    manual: count('manual'),
    errors: count('error'),
  };
  console.info(
    JSON.stringify({
      event: 'cron_payment_sweep',
      skipped: summary.skipped ?? null,
      scanned: summary.scanned,
      ...counts,
    }),
  );

  return NextResponse.json({ ...summary, ...counts });
}
