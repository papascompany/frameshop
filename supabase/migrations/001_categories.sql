-- 001_categories.sql
-- Category tree (self-referencing parent_id).
-- Source: docs/PLAN.md §6, docs/specs/catalog.md.

CREATE TABLE IF NOT EXISTS categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,
  name         text NOT NULL,
  parent_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS categories_parent_id_idx
  ON categories (parent_id);
CREATE INDEX IF NOT EXISTS categories_active_sort_idx
  ON categories (is_active, sort_order);

COMMENT ON TABLE categories IS 'Catalog category tree (M-Catalog).';
COMMENT ON COLUMN categories.parent_id IS 'NULL = root category. Max depth 3 (enforced in app layer).';
