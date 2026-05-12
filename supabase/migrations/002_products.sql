-- 002_products.sql
-- Frames sold to end users.
-- Source: docs/PLAN.md §6, docs/specs/product.md.

-- pg_trgm extension required by the trigram name search index below.
-- Must be created BEFORE the index so the gin_trgm_ops operator class exists.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name         text NOT NULL,
  tagline      text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  base_price   int  NOT NULL CHECK (base_price >= 0),
  has_frame    boolean NOT NULL DEFAULT true,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_category_id_idx
  ON products (category_id);
CREATE INDEX IF NOT EXISTS products_active_sort_idx
  ON products (is_active, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (name gin_trgm_ops);

COMMENT ON TABLE products IS 'Frame products (M-Catalog / M-ProductDetail).';
COMMENT ON COLUMN products.has_frame IS 'Filter axis: framed vs frameless print.';
