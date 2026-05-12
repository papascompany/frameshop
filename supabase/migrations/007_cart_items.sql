-- 007_cart_items.sql
-- Server-side cart sync. LocalStorage mirrors this for offline use.
-- Source: docs/PLAN.md §6, docs/specs/cart.md.
-- HANDOFF: `local_id` column added as dedup key between LocalStorage and DB.

CREATE TABLE IF NOT EXISTS cart_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id        uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id      uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  photo_id        uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  options         jsonb NOT NULL,
  photo_url       text NOT NULL,
  crop_transform  jsonb NOT NULL,
  preview_url     text NOT NULL,
  price           int  NOT NULL CHECK (price >= 0),
  quantity        int  NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Dedup: same local_id within a user only inserts once.
  UNIQUE (user_id, local_id)
);

CREATE INDEX IF NOT EXISTS cart_items_user_idx
  ON cart_items (user_id, created_at DESC);

COMMENT ON TABLE cart_items IS 'Per-user cart, dedup-keyed by local_id (M-Cart).';
COMMENT ON COLUMN cart_items.local_id IS 'Client UUID. Same id is never inserted twice for one user.';
