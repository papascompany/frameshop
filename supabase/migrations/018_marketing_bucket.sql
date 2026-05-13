-- 018_marketing_bucket.sql
-- P1-07: Public bucket for mirrored marketing assets (Unsplash photos).
--
-- Why public? These are editorial photos that are already freely available
-- on Unsplash under the Unsplash License. There is no privacy concern; we
-- want them served as fast as possible without signed-URL overhead.
--
-- The bucket is intentionally separate from `previews` (which is private,
-- see 017_previews_bucket_private.sql). Marketing assets and user print
-- files have entirely different access semantics.

INSERT INTO storage.buckets (id, name, public)
  VALUES ('marketing', 'marketing', true)
  ON CONFLICT (id) DO NOTHING;
