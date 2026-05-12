-- 013_photos_cleanup.sql
-- Anonymous photo retention + scheduled cleanup (P2-04 fix, ADR-017).
--
-- Source:
--   - docs/audit/phase-1.md §P2-04
--   - shared/DECISIONS.md ADR-010 ("Phase 2 cleanup job" promise)
--   - shared/DECISIONS.md ADR-017 (this migration's parent decision)
--
-- Scope:
--   Deletes `photos` rows where `user_id IS NULL AND session_id IS NOT NULL`
--   AND `created_at < now() - interval '30 days'`. Logged-in users' photos
--   are NEVER touched here.
--
--   `cart_items.photo_url` / `order_items.photo_url` are plain text URL
--   snapshots — they remain untouched. The Storage object lifecycle (the
--   actual JPEG bytes in `photos/anon/<sessionId>/...`) is deferred to a
--   Phase 3 Edge Function: SQL cannot reach Storage; an authenticated
--   service-role caller is required. See ADR-017 §Phase 3.
--
-- Safety / idempotency:
--   - `CREATE OR REPLACE FUNCTION` so re-running this migration is safe.
--   - `pg_cron.schedule(...)` is upserted via the `cron.job` table check
--     (see "Schedule registration" block below).
--   - If `pg_cron` is not available (older Supabase free tier), the
--     migration emits a NOTICE and skips the schedule. Operators can run
--     `SELECT public.delete_expired_anonymous_photos();` manually from a
--     dashboard cron or external scheduler.

-- ─── Cleanup function ────────────────────────────────────────────────────
-- SECURITY DEFINER so a `cron` invocation (which may not have RLS perms)
-- can delete photos. We pin search_path to public to avoid any role-set
-- search_path injection.

CREATE OR REPLACE FUNCTION public.delete_expired_anonymous_photos()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
BEGIN
  WITH deleted AS (
    DELETE FROM public.photos
     WHERE user_id IS NULL
       AND session_id IS NOT NULL
       AND created_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT count(*) INTO deleted_count FROM deleted;

  -- Audit trail: surface to Postgres log when non-zero so ops can grep.
  IF deleted_count > 0 THEN
    RAISE NOTICE 'delete_expired_anonymous_photos: deleted % rows', deleted_count;
  END IF;

  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.delete_expired_anonymous_photos() IS
  'ADR-017: deletes anonymous photos older than 30 days. Returns row count. Does NOT remove Storage objects (Phase 3).';

-- Lock down execution. Only service_role / pg_cron should call this in prod.
REVOKE ALL ON FUNCTION public.delete_expired_anonymous_photos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_expired_anonymous_photos() TO service_role;

-- ─── Schedule registration (pg_cron) ─────────────────────────────────────
-- pg_cron is bundled in Supabase but must be explicitly enabled. We try to
-- create the extension and schedule the job; if the extension isn't
-- available we emit a NOTICE and leave manual execution as the fallback.
--
-- Schedule: 18:00 UTC daily = 03:00 KST next day. Off-peak for KR users.

DO $$
BEGIN
  -- Best-effort enable. CREATE EXTENSION requires superuser; on Supabase
  -- Cloud the postgres role has it.
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'pg_cron extension cannot be enabled (insufficient privilege). Run cleanup manually or enable via Supabase dashboard.';
      RETURN;
    WHEN undefined_file THEN
      RAISE NOTICE 'pg_cron extension is not installed in this Postgres build. Skipping schedule.';
      RETURN;
  END;

  -- Unschedule any prior version (idempotent re-run).
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'cleanup-anon-photos';

  -- Register the daily job.
  PERFORM cron.schedule(
    'cleanup-anon-photos',
    '0 18 * * *',  -- 18:00 UTC daily = 03:00 KST next day
    $cron$ SELECT public.delete_expired_anonymous_photos(); $cron$
  );

  RAISE NOTICE 'cleanup-anon-photos scheduled (daily 18:00 UTC / 03:00 KST).';
EXCEPTION
  WHEN undefined_table THEN
    -- cron.job table missing (extension partially installed). Soft-fail.
    RAISE NOTICE 'cron.job table not present; skipping schedule registration.';
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron schedule registration failed (%). Job not scheduled; cleanup must run manually.', SQLERRM;
END;
$$;
