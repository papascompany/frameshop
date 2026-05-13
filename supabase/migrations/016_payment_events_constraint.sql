-- 016_payment_events_constraint.sql
-- P1-04: Enforce that payment_events.status is a valid TossPaymentStatus value.
-- The comment in confirm.ts:109 claimed this was already constrained, but the
-- original migration (010_payment_events.sql) declared status as plain `text`.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_events_status_chk'
      AND conrelid = 'payment_events'::regclass
  ) THEN
    ALTER TABLE payment_events
      ADD CONSTRAINT payment_events_status_chk
      CHECK (status IN (
        'READY',
        'IN_PROGRESS',
        'WAITING_FOR_DEPOSIT',
        'DONE',
        'CANCELED',
        'PARTIAL_CANCELED',
        'ABORTED',
        'EXPIRED'
      ));
  END IF;
END $$;
