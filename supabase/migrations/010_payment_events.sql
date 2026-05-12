-- 010_payment_events.sql
-- Webhook event log for dedup / audit (HANDOFF: ADR candidate accepted).
-- Source: docs/specs/payment.md.

CREATE TABLE IF NOT EXISTS payment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_key   text NOT NULL UNIQUE,
  order_id      uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_no      text NOT NULL,
  status        text NOT NULL,
  raw_payload   jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_order_no_idx
  ON payment_events (order_no);
CREATE INDEX IF NOT EXISTS payment_events_received_idx
  ON payment_events (received_at DESC);

COMMENT ON TABLE payment_events IS 'Toss webhook dedup + audit (UNIQUE payment_key).';
