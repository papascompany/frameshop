-- 027_products_bleed_mm.sql
--
-- FEATURE: print bleed.
-- Adds a per-product `bleed_mm` so the editor can generate a print-ready crop
-- that extends OUTWARD from the visible print area (inner_rect) by the given
-- number of millimetres. The bleed is the safety margin trimmed off after
-- printing so the image runs fully to the frame edge with no white slivers.
--
--   crop region = inner_rect (mm) expanded by `bleed_mm` on every side.
--
-- 0 (default) = no bleed → crop is exactly the inner_rect.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS bleed_mm numeric(5,2) NOT NULL DEFAULT 0
  CHECK (bleed_mm >= 0 AND bleed_mm <= 50);

COMMENT ON COLUMN products.bleed_mm IS
  'Print bleed in millimetres added around inner_rect when generating the '
  'print-ready crop in the editor. 0 = no bleed (crop == inner_rect).';
