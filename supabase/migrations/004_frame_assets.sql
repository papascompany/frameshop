-- 004_frame_assets.sql
-- Frame PNG overlays per color, with inner_rect (normalized 0..1).
-- Source: docs/PLAN.md §6, docs/specs/editor.md (inner_rect fallback).

CREATE TABLE IF NOT EXISTS frame_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color_code   text NOT NULL,
  color_label  text NOT NULL,
  png_url      text NOT NULL,
  inner_rect   jsonb NOT NULL,
  preview_url  text,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Each product has at most one PNG per color.
  UNIQUE (product_id, color_code),

  -- inner_rect must contain x,y,w,h within [0,1] (defensive guard;
  -- application layer must also validate via Zod).
  CONSTRAINT frame_inner_rect_shape CHECK (
    jsonb_typeof(inner_rect -> 'x') = 'number' AND
    jsonb_typeof(inner_rect -> 'y') = 'number' AND
    jsonb_typeof(inner_rect -> 'w') = 'number' AND
    jsonb_typeof(inner_rect -> 'h') = 'number'
  )
);

CREATE INDEX IF NOT EXISTS frame_assets_product_idx
  ON frame_assets (product_id);

COMMENT ON TABLE frame_assets IS 'Color-specific frame PNG overlays (M-FrameEditor).';
COMMENT ON COLUMN frame_assets.inner_rect IS '{x,y,w,h} normalized 0..1. Photo region.';
