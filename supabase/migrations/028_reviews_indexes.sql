-- 028_reviews_indexes.sql
--
-- PERF: the `reviews` table (migration 023) shipped with NO indexes. The two
-- hot public read paths do filtered, ordered scans:
--   getRecentPublicReviews : WHERE is_public ORDER BY created_at DESC LIMIT 5
--   getProductReviews      : WHERE product_id = $1 AND is_public ORDER BY created_at DESC
-- On a growing table these become sequential scans + sort. Add covering
-- indexes so both are index-only range scans.

CREATE INDEX IF NOT EXISTS reviews_public_created_idx
  ON reviews (is_public, created_at DESC);

CREATE INDEX IF NOT EXISTS reviews_product_public_created_idx
  ON reviews (product_id, is_public, created_at DESC);

-- Duplicate-review guard (getOrderReview) looks up by order_id.
CREATE INDEX IF NOT EXISTS reviews_order_idx
  ON reviews (order_id);
