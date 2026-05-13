-- 019_print_render_jobs.sql
-- P1-06: Persistent render job queue for 300dpi print file generation.
--
-- Problem: the previous enqueue.ts used queueMicrotask (fire-and-forget).
-- If Vercel terminates the function before the microtask runs, the render
-- is silently lost. Customers who paid have no print file.
--
-- Solution: persist a job row BEFORE dispatching. If the in-process attempt
-- fails, a Vercel Cron at /api/cron/render-retry picks up PENDING / FAILED
-- rows and retries up to MAX_ATTEMPTS (5) times.
--
-- Status lifecycle:
--   PENDING  → render dispatched but not yet started (or process killed)
--   RUNNING  → render in flight (set at job start)
--   DONE     → print_file_url written to order_items (terminal)
--   FAILED   → all attempts exhausted (terminal; needs admin review)

CREATE TABLE IF NOT EXISTS print_render_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id   uuid        NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  status          text        NOT NULL DEFAULT 'PENDING',
  attempts        int         NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT print_render_jobs_order_item_uniq UNIQUE (order_item_id),
  CONSTRAINT print_render_jobs_status_chk CHECK (
    status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')
  )
);

-- Index for cron query: pick up retryable jobs quickly.
CREATE INDEX IF NOT EXISTS print_render_jobs_retryable_idx
  ON print_render_jobs (status, attempts)
  WHERE status IN ('PENDING', 'FAILED');

-- RLS: service role bypasses RLS; no direct user access needed.
ALTER TABLE print_render_jobs ENABLE ROW LEVEL SECURITY;
