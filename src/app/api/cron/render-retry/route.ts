/**
 * /api/cron/render-retry — Vercel Cron route for failed print render retry.
 *
 * P1-06: Polls `print_render_jobs` for PENDING / FAILED rows and re-runs the
 * render pipeline for each, up to MAX_ATTEMPTS per job.
 *
 * Invocation: Vercel Cron (vercel.json `crons`) fires a GET request to this
<<<<<<< HEAD
 * route every 5 minutes. Vercel automatically adds the
 * `Authorization: Bearer <CRON_SECRET>` header when `CRON_SECRET` env var is
 * configured on the project.
 *
 * Security: Only Vercel's cron infrastructure (or a caller with CRON_SECRET)
 * should invoke this endpoint. Any other caller gets 401.
 *
 * Reference: https://vercel.com/docs/cron-jobs/quickstart
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getRetryableJobs, claimRenderJob, markJobDone, markJobFailed } from '@/lib/render/jobs';
import { renderOrderItemPrint } from '@/lib/render/pipeline';
import type { OrderItemId } from '@/types/common';
import { asBrand } from '@/types/common';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds — process up to ~20 jobs per invocation

/** Verify the request comes from Vercel Cron (or an authorised caller). */
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // CRON_SECRET not configured — only allow in non-production (local dev).
    return process.env.NODE_ENV !== 'production';
  }
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${cronSecret}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobs = await getRetryableJobs(20);

  if (jobs.length === 0) {
    return NextResponse.json({ processed: 0, results: [] });
  }

  const results: Array<{
    orderItemId: string;
    claimed: boolean;
    ok?: boolean;
    code?: string;
    message?: string;
  }> = [];

  for (const job of jobs) {
    const orderItemId = asBrand<OrderItemId>(job.orderItemId);

    const claimed = await claimRenderJob(orderItemId).catch(() => false);
    if (!claimed) {
      results.push({ orderItemId: job.orderItemId, claimed: false });
      continue;
    }

    const result = await renderOrderItemPrint(orderItemId).catch((err: unknown) => ({
      ok: false as const,
      code: 'RENDER_FAILED' as const,
      message: err instanceof Error ? err.message : String(err),
    }));

    if (result.ok) {
      await markJobDone(orderItemId).catch(() => {});
      results.push({ orderItemId: job.orderItemId, claimed: true, ok: true });
      console.info(
        JSON.stringify({ event: 'cron_render_retry_success', orderItemId: job.orderItemId }),
      );
    } else {
      await markJobFailed(orderItemId, result.message).catch(() => {});
      results.push({
        orderItemId: job.orderItemId,
        claimed: true,
        ok: false,
        code: result.code,
        message: result.message,
      });
      console.error(
        JSON.stringify({
          event: 'cron_render_retry_failed',
          orderItemId: job.orderItemId,
          attempts: job.attempts + 1,
          code: result.code,
          message: result.message,
        }),
      );
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => r.claimed && !r.ok).length;
  const skipped = results.filter((r) => !r.claimed).length;

  return NextResponse.json({ processed: jobs.length, succeeded, failed, skipped, results });
}
