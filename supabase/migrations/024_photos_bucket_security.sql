-- 024_photos_bucket_security.sql
--
-- SECURITY FIX (CRITICAL-001):
-- User-uploaded photos were stored in a public bucket, making every uploaded
-- photo world-readable by anyone who knew (or guessed) the URL.
-- This migration:
--   1. Makes the `photos` bucket private (public = false).
--   2. Adds `storage.objects` RLS policies so only the owning user can access
--      their own objects (via service-role or a fresh signed URL).
--   3. Adds `storage_path` + `thumb_path` columns to the `photos` table so
--      the application can generate fresh signed URLs on-demand without
--      relying on long-lived stored URLs.

-- ─── 1. Make the photos bucket private ───────────────────────────────────────
-- Note: Storage bucket configuration is normally done via the Supabase
-- dashboard or the Management API. In hosted Supabase, the `storage.buckets`
-- table is writable by service_role so we can update it here.
UPDATE storage.buckets
SET    public = false
WHERE  id = 'photos';

-- ─── 2. storage.objects RLS policies ─────────────────────────────────────────
-- Pattern: path is  `<userId>/<uuid>.ext`  for authenticated users
--          and     `anon/<sessionId>/<uuid>.ext`  for anonymous sessions.
-- We allow SELECT only to the owning user (matched via auth.uid() prefix).
-- INSERT / DELETE are handled exclusively via the service-role key (no RLS).

-- Owner can SELECT their own objects.
DROP POLICY IF EXISTS "photos_owner_select" ON storage.objects;
CREATE POLICY "photos_owner_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'photos'
    AND (
      -- Authenticated owner: path starts with their user UUID
      (auth.uid() IS NOT NULL AND name LIKE (auth.uid()::text || '/%'))
    )
  );

-- ─── 3. Add storage path columns to photos table ─────────────────────────────
-- `storage_path`  — object key inside the `photos` bucket for the original
-- `thumb_path`    — object key for the thumbnail
-- These allow the application to call `createSignedUrl(path, ttl)` at any
-- time, decoupling display URLs from the stored record.
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS thumb_path   text;

COMMENT ON COLUMN photos.storage_path IS
  'Object key inside the `photos` Supabase Storage bucket (private). '
  'Use service-role createSignedUrl(storage_path, ttl) to generate '
  'an access URL. Format: <userId>/<uuid>.<ext> or anon/<sessionId>/<uuid>.<ext>';

COMMENT ON COLUMN photos.thumb_path IS
  'Object key for the thumbnail inside the `photos` bucket. '
  'Same scheme as storage_path, always a .jpg.';
