-- 015_order_items_render_meta.sql
-- Render-pipeline metadata for order_items (ADR-005, frame_skills §5).
--
-- Source: docs/frame_skills.md §5 (print rendering inputs), feat/editor-frame-overlay.
--
-- The server-side 300dpi render pipeline (`/api/render/print`) needs the
-- frame_asset that was selected at the time of order, plus the client stage
-- size that the cropTransform coordinates are anchored to. The existing
-- `crop_transform` column (from migration 009) already stores the transform
-- itself; we add the two missing dimensions here so the print renderer can
-- faithfully reproduce the editor preview at print resolution.
--
-- Backwards compatibility: all three columns are nullable. Existing rows
-- (created before render-pipeline meta was tracked) will fall back to
-- variant-derived defaults at render time. `frame_asset_id` is a soft
-- reference (ON DELETE SET NULL) — admins must not orphan in-flight orders
-- when retiring a frame asset.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS frame_asset_id uuid
    REFERENCES frame_assets(id) ON DELETE SET NULL;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS stage_size jsonb;

-- crop_transform is already NOT NULL on the existing schema (migration 009).
-- We do not add it again — present for documentation only.

CREATE INDEX IF NOT EXISTS order_items_frame_asset_idx
  ON order_items (frame_asset_id);

COMMENT ON COLUMN order_items.frame_asset_id IS
  'frame_skills §5: the frame PNG (and inner_rect) selected at order time.';
COMMENT ON COLUMN order_items.stage_size IS
  'frame_skills §5: {w,h} client preview stage size — anchors crop_transform coordinates.';
