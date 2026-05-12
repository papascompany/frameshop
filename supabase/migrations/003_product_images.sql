-- 003_product_images.sql
-- Per-product gallery (thumbnail / gallery / guide).
-- Source: docs/PLAN.md §6, docs/specs/product.md.

CREATE TABLE IF NOT EXISTS product_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url    text NOT NULL,
  alt_text     text,
  type         text NOT NULL CHECK (type IN ('thumbnail','gallery','guide')),
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_images_product_idx
  ON product_images (product_id, type, sort_order);

COMMENT ON TABLE product_images IS 'Per-product media (M-ProductDetail).';
