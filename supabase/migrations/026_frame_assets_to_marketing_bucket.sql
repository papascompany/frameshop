-- 026_frame_assets_to_marketing_bucket.sql
--
-- BACKGROUND (follows migration 024):
--   Migration 024 made the `photos` bucket private to protect user-uploaded
--   photos. However, frame overlay images (frame-black.png, frame-white.png,
--   frame-brown.png, frame-natural.png and their preview variants) were also
--   stored in the `photos` bucket, causing 400 errors in the canvas editor.
--
-- CHANGES:
--   1. Drops the temporary `photos_frames_public_read` RLS policy created as
--      a quick-fix attempt (it cannot help because /object/public/ requires
--      the bucket itself to be public — RLS is not sufficient).
--   2. Updates `frame_assets` URLs from `photos` bucket to `marketing/frames/`
--      (the `marketing` bucket is already public — see migration 018).
--      Files were physically copied to marketing/frames/ via service-role API.
--
-- NOTE: The actual file copy (photos/* → marketing/frames/*) was performed
-- via the Supabase Storage API using the service-role key. This migration
-- only records the DB-side URL update so the schema stays in sync.

-- ─── 1. Drop temporary RLS policy (no longer needed) ─────────────────────────
DROP POLICY IF EXISTS "photos_frames_public_read" ON storage.objects;

-- ─── 2. Update frame_assets URLs to marketing/frames/ bucket ─────────────────
UPDATE frame_assets
SET
  png_url     = replace(png_url,     '/object/public/photos/', '/object/public/marketing/frames/'),
  preview_url = replace(preview_url, '/object/public/photos/', '/object/public/marketing/frames/')
WHERE
  png_url LIKE '%/object/public/photos/frame-%';
