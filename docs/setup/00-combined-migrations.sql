-- 001_categories.sql
-- Category tree (self-referencing parent_id).
-- Source: docs/PLAN.md §6, docs/specs/catalog.md.

CREATE TABLE IF NOT EXISTS categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,
  name         text NOT NULL,
  parent_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS categories_parent_id_idx
  ON categories (parent_id);
CREATE INDEX IF NOT EXISTS categories_active_sort_idx
  ON categories (is_active, sort_order);

COMMENT ON TABLE categories IS 'Catalog category tree (M-Catalog).';
COMMENT ON COLUMN categories.parent_id IS 'NULL = root category. Max depth 3 (enforced in app layer).';
-- 002_products.sql
-- Frames sold to end users.
-- Source: docs/PLAN.md §6, docs/specs/product.md.

CREATE TABLE IF NOT EXISTS products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name         text NOT NULL,
  tagline      text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  base_price   int  NOT NULL CHECK (base_price >= 0),
  has_frame    boolean NOT NULL DEFAULT true,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_category_id_idx
  ON products (category_id);
CREATE INDEX IF NOT EXISTS products_active_sort_idx
  ON products (is_active, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (name gin_trgm_ops);

-- pg_trgm extension is required for the trigram name search index above.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

COMMENT ON TABLE products IS 'Frame products (M-Catalog / M-ProductDetail).';
COMMENT ON COLUMN products.has_frame IS 'Filter axis: framed vs frameless print.';
-- 003_product_images.sql
-- Per-product gallery (thumbnail / gallery / guide).
-- Source: docs/PLAN.md §6, docs/specs/product.md.

CREATE TABLE IF NOT EXISTS product_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url    text NOT NULL,
  alt_text     text,
  type         text NOT NULL CHECK (type IN ('thumbnail','gallery','guide')),
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_images_product_idx
  ON product_images (product_id, type, sort_order);

COMMENT ON TABLE product_images IS 'Per-product media (M-ProductDetail).';
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
-- 005_product_variants.sql
-- Size x color x matte x paper variants (ADR-006: pre-generated).
-- Source: docs/PLAN.md §6, docs/specs/editor.md.

CREATE TABLE IF NOT EXISTS product_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_code     text NOT NULL,
  size_label    text NOT NULL,
  width_mm      int  NOT NULL CHECK (width_mm > 0),
  height_mm     int  NOT NULL CHECK (height_mm > 0),
  color_code    text NOT NULL,
  matte_code    text NOT NULL CHECK (matte_code IN ('none','with')),
  paper_code    text NOT NULL CHECK (paper_code IN ('glossy','matte','fineart')),
  price         int  NOT NULL CHECK (price >= 0),
  stock         int  NOT NULL DEFAULT 99999 CHECK (stock >= 0),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (product_id, size_code, color_code, matte_code, paper_code)
);

CREATE INDEX IF NOT EXISTS product_variants_product_idx
  ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS product_variants_active_idx
  ON product_variants (product_id, is_active, price);

COMMENT ON TABLE product_variants IS 'All size x color x matte x paper combinations (ADR-006).';
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
-- 007_cart_items.sql
-- Server-side cart sync. LocalStorage mirrors this for offline use.
-- Source: docs/PLAN.md §6, docs/specs/cart.md.
-- HANDOFF: `local_id` column added as dedup key between LocalStorage and DB.

CREATE TABLE IF NOT EXISTS cart_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id        uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id      uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  photo_id        uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  options         jsonb NOT NULL,
  photo_url       text NOT NULL,
  crop_transform  jsonb NOT NULL,
  preview_url     text NOT NULL,
  price           int  NOT NULL CHECK (price >= 0),
  quantity        int  NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Dedup: same local_id within a user only inserts once.
  UNIQUE (user_id, local_id)
);

CREATE INDEX IF NOT EXISTS cart_items_user_idx
  ON cart_items (user_id, created_at DESC);

COMMENT ON TABLE cart_items IS 'Per-user cart, dedup-keyed by local_id (M-Cart).';
COMMENT ON COLUMN cart_items.local_id IS 'Client UUID. Same id is never inserted twice for one user.';
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
-- 009_orders.sql
-- Orders + order_items + order_sequences (daily counter for order_no).
-- Source: docs/PLAN.md §6 + Appendix A, docs/specs/order.md, ADR-008.

-- ── Daily sequence table for `YYYYMMDD-NNNN` order numbers ───────────────
-- Concurrency safe via INSERT ... ON CONFLICT DO UPDATE returning seq.
CREATE TABLE IF NOT EXISTS order_sequences (
  day    date PRIMARY KEY,
  seq    int  NOT NULL DEFAULT 0
);

COMMENT ON TABLE order_sequences IS 'Per-day counter for order_no (KST). Locked per-row by UPSERT.';

-- ── Orders ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no          text UNIQUE NOT NULL,
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'CREATED' CHECK (
    status IN ('CREATED','PAID','IN_PRODUCTION','SHIPPED','DELIVERED','CANCELLED','REFUNDED')
  ),
  total_price       int  NOT NULL CHECK (total_price >= 0),
  shipping_fee      int  NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  shipping_method   text NOT NULL CHECK (
    shipping_method IN ('STANDARD','PICKUP','QUICK')
  ),
  payment_id        text UNIQUE,             -- Toss paymentKey, set on PAID
  tracking_number   text,
  courier           text,
  orderer           jsonb NOT NULL,          -- { name, phone, email }
  shipping          jsonb NOT NULL,          -- { name, phone, zip, addr1, addr2, memo }
  created_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  shipped_at        timestamptz
);

CREATE INDEX IF NOT EXISTS orders_user_idx
  ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx
  ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_order_no_idx
  ON orders (order_no);

COMMENT ON TABLE orders IS 'Orders (M-Order). order_no = YYYYMMDD-NNNN (KST).';
COMMENT ON COLUMN orders.shipping_method IS 'ADR-008 snapshot — frozen at create time.';
COMMENT ON COLUMN orders.shipping_fee   IS 'ADR-008 snapshot — frozen at create time.';

-- ── Order items (variant snapshot frozen at order time) ──────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_snapshot  jsonb NOT NULL,
  photo_url         text NOT NULL,
  crop_transform    jsonb NOT NULL,
  print_file_url    text,
  quantity          int  NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  price             int  NOT NULL CHECK (price >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_order_idx
  ON order_items (order_id);

COMMENT ON TABLE order_items IS 'Snapshot rows for order_items.variant_snapshot.';
-- 010_payment_events.sql
-- Webhook event log for dedup / audit (HANDOFF: ADR candidate accepted).
-- Source: docs/specs/payment.md.

CREATE TABLE IF NOT EXISTS payment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_key   text NOT NULL UNIQUE,
  order_id      uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_no      text NOT NULL,
  status        text NOT NULL,
  raw_payload   jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_order_no_idx
  ON payment_events (order_no);
CREATE INDEX IF NOT EXISTS payment_events_received_idx
  ON payment_events (received_at DESC);

COMMENT ON TABLE payment_events IS 'Toss webhook dedup + audit (UNIQUE payment_key).';
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
-- 012_rls_policies.sql
-- Row-level security for every user-touchable table.
-- Source: docs/PLAN.md §6.1, individual spec files.
--
-- Admin role detection:
--   We treat any session whose JWT `app_metadata.role = 'admin'` as admin.
--   The helper `is_admin()` reads it from `auth.jwt() -> 'app_metadata'`.
--
-- All write paths for sensitive tables (orders, payment_events) flow through
-- the service-role key on the server. RLS is the second line of defense.

-- ── Admin detection helper ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- ── categories ───────────────────────────────────────────────────────────
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_read ON categories;
CREATE POLICY categories_read ON categories
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS categories_admin_write ON categories;
CREATE POLICY categories_admin_write ON categories
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── products ─────────────────────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_read ON products;
CREATE POLICY products_read ON products
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS products_admin_write ON products;
CREATE POLICY products_admin_write ON products
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── product_images ───────────────────────────────────────────────────────
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_images_read ON product_images;
CREATE POLICY product_images_read ON product_images
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS product_images_admin_write ON product_images;
CREATE POLICY product_images_admin_write ON product_images
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── frame_assets ─────────────────────────────────────────────────────────
ALTER TABLE frame_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frame_assets_read ON frame_assets;
CREATE POLICY frame_assets_read ON frame_assets
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS frame_assets_admin_write ON frame_assets;
CREATE POLICY frame_assets_admin_write ON frame_assets
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── product_variants ─────────────────────────────────────────────────────
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_variants_read ON product_variants;
CREATE POLICY product_variants_read ON product_variants
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS product_variants_admin_write ON product_variants;
CREATE POLICY product_variants_admin_write ON product_variants
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── photos ───────────────────────────────────────────────────────────────
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photos_owner_select ON photos;
CREATE POLICY photos_owner_select ON photos
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

-- Authenticated users can insert their own photos (user_id = self).
-- Anonymous uploads are routed through a server-only route handler that uses
-- the service-role key (RLS bypassed). RLS still blocks direct anon writes.
DROP POLICY IF EXISTS photos_owner_insert ON photos;
CREATE POLICY photos_owner_insert ON photos
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS photos_owner_update ON photos;
CREATE POLICY photos_owner_update ON photos
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS photos_owner_delete ON photos;
CREATE POLICY photos_owner_delete ON photos
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin());

-- ── cart_items ───────────────────────────────────────────────────────────
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cart_items_owner_all ON cart_items;
CREATE POLICY cart_items_owner_all ON cart_items
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── orders ───────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Read: owner or admin. Guest-by-phone lookup goes through service role.
DROP POLICY IF EXISTS orders_owner_select ON orders;
CREATE POLICY orders_owner_select ON orders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

-- Insert: a logged-in user may insert *their own* order. Guest orders go
-- through the service-role server route.
DROP POLICY IF EXISTS orders_owner_insert ON orders;
CREATE POLICY orders_owner_insert ON orders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Update: admin only. Status transitions are server-only via service role.
DROP POLICY IF EXISTS orders_admin_update ON orders;
CREATE POLICY orders_admin_update ON orders
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Delete: never (orders are immutable; use CANCELLED status).

-- ── order_items ──────────────────────────────────────────────────────────
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_items_owner_select ON order_items;
CREATE POLICY order_items_owner_select ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
       WHERE o.id = order_items.order_id
         AND (o.user_id = auth.uid() OR is_admin())
    )
  );

-- Inserts/updates flow through service role. No anon access.

-- ── order_sequences ──────────────────────────────────────────────────────
ALTER TABLE order_sequences ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy = service-role only access.

-- ── payment_events ───────────────────────────────────────────────────────
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
-- Service-role only. No anon/authenticated policy.

-- ── curations ────────────────────────────────────────────────────────────
ALTER TABLE curations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS curations_read ON curations;
CREATE POLICY curations_read ON curations
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS curations_admin_write ON curations;
CREATE POLICY curations_admin_write ON curations
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── shipping_methods ─────────────────────────────────────────────────────
ALTER TABLE shipping_methods ENABLE ROW LEVEL SECURITY;

-- Public read (checkout needs it for anon users too).
DROP POLICY IF EXISTS shipping_methods_read ON shipping_methods;
CREATE POLICY shipping_methods_read ON shipping_methods
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS shipping_methods_admin_write ON shipping_methods;
CREATE POLICY shipping_methods_admin_write ON shipping_methods
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
