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
