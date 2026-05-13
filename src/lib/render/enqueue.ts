/**
 * Print-render trigger helper.
 *
 * P1-06: Replaced fire-and-forget queueMicrotask with a durable job queue.
 *
 * Flow:
 *  1. Insert a PENDING row in `print_render_jobs` (idempotent UPSERT).
 *  2. Attempt the render in-process immediately (fast path for most orders).
 *  3. On success → mark DONE.
 *  4. On failure → mark back to PENDING (or FAILED if exhausted).
 *
 * If the Vercel function is killed between steps 1 and 2, the PENDING row
 * remains and the cron at /api/cron/render-retry picks it up within 5 minutes.
 *
 * Callers (payment confirm, webhook) must NOT await this function — payment
 * confirmation must succeed even if rendering is delayed.
 */

import 'server-only';
import type { OrderItemId } from '@/types/common';
import { renderOrderItemPrint } from './pipeline';
import {
  createRenderJob,
  claimRenderJob,
  markJobDone,
  markJobFailed,
} from './jobs';

/**
 * Durably enqueue and immediately attempt a print render for one order item.
 *
 * Never throws. Logs structured JSON on failure so Vercel log drains / admin
 * panels can surface failed jobs alongside the DB row in `print_render_jobs`.
 */
export async function enqueuePrintRender(orderItemId: OrderItemId): Promise<void> {
  // Step 1: Persist job row BEFORE dispatching. Idempotent — safe to call
  // multiple times (confirm + webhook race both enqueue the same item).
  try {
    await createRenderJob(orderItemId);
  } catch (err) {
    // DB write failure is non-fatal for payment; log and fall through.
    console.error(
      JSON.stringify({
        event: 'render_job_create_failed',
        orderItemId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return;
  }

  // Step 2: Attempt in-process render immediately (fast path).
  // Wrapped in a microtask so the caller's response is sent first.
  queueMicrotask(async () => {
    // Claim the job (transition PENDING → RUNNING, increment attempts).
    const claimed = await claimRenderJob(orderItemId).catch(() => false);
    if (!claimed) {
      // Already running or terminal — the cron will handle it.
      return;
    }

    const result = await renderOrderItemPrint(orderItemId).catch((err: unknown) => ({
      ok: false as const,
      code: 'RENDER_FAILED' as const,
      message: err instanceof Error ? err.message : String(err),
    }));

    if (result.ok) {
      await markJobDone(orderItemId).catch(() => {
        // Non-fatal: job will stay RUNNING until cron corrects it.
      });
    } else {
      // Read current attempts from job claim — we incremented by 1 in claimRenderJob.
      // Pass a sentinel so markJobFailed can decide PENDING vs FAILED.
      // The actual count is managed inside markJobFailed via MAX_ATTEMPTS check.
      await markJobFailed(orderItemId, result.message).catch(() => {
        // Non-fatal: worst case the job stays RUNNING until next cron cycle.
      });
      console.error(
        JSON.stringify({
          event: 'print_render_failed',
          orderItemId,
          code: result.code,
          message: result.message,
        }),
      );
    }
  });
}
