/**
 * CRUD helpers for `print_render_jobs`.
 *
 * P1-06: Persistent render job queue. Every order item that needs a 300dpi
 * print file gets a job row before the render is dispatched. If the
 * in-process attempt fails (or the Vercel function is killed), the cron at
 * /api/cron/render-retry picks up PENDING / FAILED rows and retries up to
 * MAX_ATTEMPTS (5) times.
 *
 * Status lifecycle:
 *   PENDING → job created, not yet started (or function killed mid-flight)
 *   RUNNING → render in-flight (set atomically at job start)
 *   DONE    → print_file_url written to order_items (terminal)
 *   FAILED  → all MAX_ATTEMPTS exhausted (terminal; needs admin review)
 */

import 'server-only';
import type { OrderItemId } from '@/types/common';
import { getServiceRoleSupabase } from '../supabase/service';

export const MAX_ATTEMPTS = 5;

export type RenderJobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export type RenderJob = {
  id: string;
  orderItemId: string;
  status: RenderJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: string;
  order_item_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapJob(row: JobRow): RenderJob {
  return {
    id: row.id,
    orderItemId: row.order_item_id,
    status: row.status as RenderJobStatus,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Insert a PENDING job for an order item.
 * Idempotent: UNIQUE constraint on order_item_id — silently no-ops if a row
 * already exists (e.g. duplicate enqueue from confirm + webhook race).
 */
export async function createRenderJob(orderItemId: OrderItemId): Promise<void> {
  const supabase = getServiceRoleSupabase();
  await supabase.from('print_render_jobs').upsert(
    { order_item_id: orderItemId as string, status: 'PENDING', attempts: 0 },
    { onConflict: 'order_item_id', ignoreDuplicates: true },
  );
}

/**
 * Atomically transition job to RUNNING and increment attempts.
 * Returns true if the claim succeeded (job was PENDING/FAILED with room to retry).
 *
 * Single-region constraint: Vercel Cron fires at most one instance concurrently,
 * so a read-then-update is safe for Phase 1. Phase 2 replace with FOR UPDATE.
 */
export async function claimRenderJob(orderItemId: OrderItemId): Promise<boolean> {
  const supabase = getServiceRoleSupabase();

  const { data: row } = await supabase
    .from('print_render_jobs')
    .select('id, status, attempts')
    .eq('order_item_id', orderItemId as string)
    .maybeSingle();

  if (!row) return false;
  const r = row as { id: string; status: string; attempts: number };
  if (!['PENDING', 'RUNNING', 'FAILED'].includes(r.status)) return false;
  if (r.attempts >= MAX_ATTEMPTS) return false;

  const { error } = await supabase
    .from('print_render_jobs')
    .update({
      status: 'RUNNING',
      attempts: r.attempts + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', r.id);

  return !error;
}

/** Mark job DONE when render succeeds. */
export async function markJobDone(orderItemId: OrderItemId): Promise<void> {
  const supabase = getServiceRoleSupabase();
  await supabase
    .from('print_render_jobs')
    .update({ status: 'DONE', last_error: null, updated_at: new Date().toISOString() })
    .eq('order_item_id', orderItemId as string);
}

/**
 * Mark job back to PENDING (for next retry) or terminal FAILED if exhausted.
 * Reads current attempt count from DB to decide which terminal state to use.
 * Called when a render attempt throws or returns ok: false.
 */
export async function markJobFailed(
  orderItemId: OrderItemId,
  errorMessage: string,
): Promise<void> {
  const supabase = getServiceRoleSupabase();

  // Re-read current attempts (already incremented by claimRenderJob).
  const { data: row } = await supabase
    .from('print_render_jobs')
    .select('attempts')
    .eq('order_item_id', orderItemId as string)
    .maybeSingle();

  const attempts = (row as { attempts: number } | null)?.attempts ?? MAX_ATTEMPTS;
  const nextStatus = attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';

  await supabase
    .from('print_render_jobs')
    .update({
      status: nextStatus,
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('order_item_id', orderItemId as string);
}

/**
 * Return retryable jobs (PENDING or FAILED with room for another attempt).
 * Used by the /api/cron/render-retry endpoint.
 */
export async function getRetryableJobs(limit = 20): Promise<RenderJob[]> {
  const supabase = getServiceRoleSupabase();
  const { data } = await supabase
    .from('print_render_jobs')
    .select('*')
    .in('status', ['PENDING', 'FAILED'])
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(limit);

  return (data ?? []).map((r) => mapJob(r as JobRow));
}

/** Return terminal FAILED jobs (attempts >= MAX_ATTEMPTS). Admin dashboard. */
export async function getFailedJobs(limit = 50): Promise<RenderJob[]> {
  const supabase = getServiceRoleSupabase();
  const { data } = await supabase
    .from('print_render_jobs')
    .select('*')
    .eq('status', 'FAILED')
    .gte('attempts', MAX_ATTEMPTS)
    .order('updated_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => mapJob(r as JobRow));
}
