-- 009_orders.sql
-- Orders + order_items + order_sequences (daily counter for order_no).
-- Source: docs/PLAN.md §6 + Appendix A, docs/specs/order.md, ADR-008.

-- ── Daily sequence table for `YYYYMMDD-NNNN` order numbers ───────────────
-- Concurrency safe via INSERT ... ON CONFLICT DO UPDATE returning seq.
CREATE TABLE IF NOT EXISTS order_sequences (
  day    date PRIMARY KEY,
  seq    int  NOT NULL DEFAULT 0
);

COMMENT ON TABLE order_sequences IS 'Per-day counter for order_no (KST). Locked per-row by UPSERT.';

-- ── Orders ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no          text UNIQUE NOT NULL,
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'CREATED' CHECK (
    status IN ('CREATED','PAID','IN_PRODUCTION','SHIPPED','DELIVERED','CANCELLED','REFUNDED')
  ),
  total_price       int  NOT NULL CHECK (total_price >= 0),
  shipping_fee      int  NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  shipping_method   text NOT NULL CHECK (
    shipping_method IN ('STANDARD','PICKUP','QUICK')
  ),
  payment_id        text UNIQUE,             -- Toss paymentKey, set on PAID
  tracking_number   text,
  courier           text,
  orderer           jsonb NOT NULL,          -- { name, phone, email }
  shipping          jsonb NOT NULL,          -- { name, phone, zip, addr1, addr2, memo }
  created_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  shipped_at        timestamptz
);

CREATE INDEX IF NOT EXISTS orders_user_idx
  ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx
  ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_order_no_idx
  ON orders (order_no);

COMMENT ON TABLE orders IS 'Orders (M-Order). order_no = YYYYMMDD-NNNN (KST).';
COMMENT ON COLUMN orders.shipping_method IS 'ADR-008 snapshot — frozen at create time.';
COMMENT ON COLUMN orders.shipping_fee   IS 'ADR-008 snapshot — frozen at create time.';

-- ── Order items (variant snapshot frozen at order time) ──────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_snapshot  jsonb NOT NULL,
  photo_url         text NOT NULL,
  crop_transform    jsonb NOT NULL,
  print_file_url    text,
  quantity          int  NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  price             int  NOT NULL CHECK (price >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_order_idx
  ON order_items (order_id);

COMMENT ON TABLE order_items IS 'Snapshot rows for order_items.variant_snapshot.';
