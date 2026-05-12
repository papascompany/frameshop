-- 011_curations.sql
-- Landing page curations (ADR-007).
-- Source: docs/PLAN.md §6, docs/specs/landing.md, docs/specs/admin.md.

CREATE TABLE IF NOT EXISTS curations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL CHECK (type IN ('banner','collection','feature')),
  title        text,
  payload      jsonb NOT NULL,
  device       text NOT NULL DEFAULT 'all' CHECK (device IN ('all','pc','mobile')),
  start_at     timestamptz,
  end_at       timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS curations_active_device_idx
  ON curations (is_active, device, sort_order);
CREATE INDEX IF NOT EXISTS curations_window_idx
  ON curations (start_at, end_at);

COMMENT ON TABLE curations IS 'Landing-page curated content (M-Landing / M-Admin).';
COMMENT ON COLUMN curations.payload IS 'Per-type Zod schemas in src/types/curation.ts.';
