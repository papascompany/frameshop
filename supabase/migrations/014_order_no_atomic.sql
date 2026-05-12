-- 014_order_no_atomic.sql
-- Atomic per-day order_no sequence allocator (P2-08 fix, ADR-019).
--
-- Source:
--   - docs/audit/phase-1.md §P2-08
--   - shared/DECISIONS.md ADR-013 (original two-statement approach)
--   - shared/DECISIONS.md ADR-019 (this migration's parent decision —
--     supersedes ADR-013's race window with a single-statement RPC).
--
-- Background:
--   `src/lib/db/order.ts:42-58` (generateOrderNo) currently runs:
--     1. SELECT seq FROM order_sequences WHERE day = ?
--     2. UPSERT order_sequences (day, seq = SELECT+1)
--   Between (1) and (2) a concurrent allocation can claim the same `seq`,
--   leading to a duplicate `order_no` (UNIQUE violation on `orders.order_no`)
--   or a skipped count. ADR-013 promised a Postgres function that performs
--   the equivalent of `INSERT ... ON CONFLICT DO UPDATE SET seq = seq + 1
--   RETURNING seq` in a single statement, making the allocation atomic.
--
-- This migration creates that function. The application code switch
-- (db/order.ts) is a backend-dev follow-up — see TODO below.

CREATE OR REPLACE FUNCTION public.next_order_no(day_kst date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result int;
BEGIN
  -- Single-statement atomic increment. `RETURNING seq` is evaluated AFTER
  -- the row is locked & updated, so concurrent callers serialize on the
  -- per-day row and each receives a distinct, monotonically increasing seq.
  INSERT INTO public.order_sequences (day, seq)
       VALUES (day_kst, 1)
  ON CONFLICT (day) DO UPDATE
       SET seq = public.order_sequences.seq + 1
  RETURNING seq INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.next_order_no(date) IS
  'ADR-019: atomic per-day order sequence allocator. Returns next seq for a KST date. Caller formats YYYYMMDD-NNNN.';

-- Lock down execution. Only authenticated callers (via server route w/ a
-- supabase client tied to a session) and service_role can invoke. anon is
-- intentionally excluded — order_no allocation must originate from a
-- server context.
REVOKE ALL ON FUNCTION public.next_order_no(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_order_no(date) TO authenticated, service_role;

-- TODO(backend-dev): Replace the SELECT-then-UPSERT body of
--   `generateOrderNo` in `src/lib/db/order.ts` (lines ~42-58) with:
--
--     const { data: seq, error } = await supabase.rpc('next_order_no', {
--       day_kst: day,
--     });
--     if (error || typeof seq !== 'number') {
--       throw new CreateOrderError('SEQUENCE_FAILED', error?.message ?? 'rpc returned non-number');
--     }
--     return asBrand<OrderNo>(formatOrderNo(today, seq));
--
-- Once that swap is in, delete the "race window is small but real" comment
-- and update ADR-013's Status to "Superseded by ADR-019".
