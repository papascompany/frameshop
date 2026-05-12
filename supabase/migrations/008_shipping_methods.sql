-- 008_shipping_methods.sql
-- ADR-008: admin-configurable shipping methods (STANDARD, PICKUP, QUICK).
-- Source: docs/specs/admin.md (admin/shipping), docs/specs/checkout.md.

CREATE TABLE IF NOT EXISTS shipping_methods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL
                    CHECK (code IN ('STANDARD','PICKUP','QUICK')),
  label           text NOT NULL,
  fee             int  NOT NULL DEFAULT 0 CHECK (fee >= 0),
  free_threshold  int  CHECK (free_threshold IS NULL OR free_threshold >= 0),
  note            text,
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Only STANDARD may carry a free_threshold; others must be NULL.
  CONSTRAINT shipping_threshold_only_standard CHECK (
    free_threshold IS NULL OR code = 'STANDARD'
  )
);

CREATE INDEX IF NOT EXISTS shipping_methods_active_sort_idx
  ON shipping_methods (is_active, sort_order);

-- Touch updated_at automatically.
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS shipping_methods_touch ON shipping_methods;
CREATE TRIGGER shipping_methods_touch
  BEFORE UPDATE ON shipping_methods
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Seed defaults so admins can edit rather than create from scratch.
INSERT INTO shipping_methods (code, label, fee, free_threshold, note, sort_order, is_active)
VALUES
  ('STANDARD', '기본 배송', 3000, 30000, NULL, 10, true),
  ('PICKUP',   '직접 수령', 0,    NULL, '매장에서 직접 수령하실 수 있습니다.', 20, true),
  ('QUICK',    '퀵 배송',  10000, NULL, NULL, 30, true)
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE shipping_methods IS 'Admin-managed shipping options (ADR-008).';
