-- 005_product_variants.sql
-- Size x color x matte x paper variants (ADR-006: pre-generated).
-- Source: docs/PLAN.md §6, docs/specs/editor.md.

CREATE TABLE IF NOT EXISTS product_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_code     text NOT NULL,
  size_label    text NOT NULL,
  width_mm      int  NOT NULL CHECK (width_mm > 0),
  height_mm     int  NOT NULL CHECK (height_mm > 0),
  color_code    text NOT NULL,
  matte_code    text NOT NULL CHECK (matte_code IN ('none','with')),
  paper_code    text NOT NULL CHECK (paper_code IN ('glossy','matte','fineart')),
  price         int  NOT NULL CHECK (price >= 0),
  stock         int  NOT NULL DEFAULT 99999 CHECK (stock >= 0),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (product_id, size_code, color_code, matte_code, paper_code)
);

CREATE INDEX IF NOT EXISTS product_variants_product_idx
  ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS product_variants_active_idx
  ON product_variants (product_id, is_active, price);

COMMENT ON TABLE product_variants IS 'All size x color x matte x paper combinations (ADR-006).';
