-- 006_photos.sql
-- User-uploaded photos.
-- Source: docs/PLAN.md §6, docs/specs/photo.md.
-- HANDOFF: `session_id` column added for anonymous photo isolation
-- (Storage path: photos/anon/<sessionId>/<uuid>.jpg).

CREATE TABLE IF NOT EXISTS photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id    text,  -- anonymous session ID; NULL for logged-in users
  original_url  text NOT NULL,
  thumb_url     text NOT NULL,
  width_px      int,
  height_px     int,
  exif          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Either logged-in OR anonymous-with-session.
  CONSTRAINT photos_owner_present CHECK (
    user_id IS NOT NULL OR session_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS photos_user_idx
  ON photos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS photos_session_idx
  ON photos (session_id, created_at DESC);

COMMENT ON TABLE photos IS 'User-uploaded source photos (M-Photo).';
COMMENT ON COLUMN photos.session_id IS 'Anonymous session UUID; used while user_id IS NULL.';
