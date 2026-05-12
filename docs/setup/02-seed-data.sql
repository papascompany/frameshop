-- ============================================================
-- FrameShop Seed Data (Phase 1 MVP)
-- Run this AFTER 00-combined-migrations.sql + 01-storage-buckets.sql.
--
-- This seed creates the minimum viable catalog so `npm run dev` shows
-- a clickable landing → catalog → product flow. Images and frame PNGs
-- must be uploaded separately (see comments below).
-- ============================================================

-- ============================================================
-- 1) Category: 베이직 액자
-- ============================================================
insert into categories (id, slug, name, parent_id, sort_order, is_active)
values
  ('00000000-0000-0000-0000-000000000001'::uuid,
   'basic-frame', '베이직 액자', null, 0, true)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;


-- ============================================================
-- 2) Product: 베이직 액자
-- ============================================================
insert into products (id, category_id, name, tagline, description, base_price, has_frame, is_active, sort_order)
values
  ('00000000-0000-0000-0000-000000000010'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   '베이직 액자',
   '가장 인기 있는 입문용 액자',
   '깔끔한 디자인의 베이직 액자입니다. 4가지 사이즈 × 1가지 색상 조합으로 시작해보세요.',
   4800,
   true,
   true,
   0)
on conflict (id) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  description = excluded.description,
  base_price = excluded.base_price,
  has_frame = excluded.has_frame,
  is_active = excluded.is_active;


-- ============================================================
-- 3) Product variants — Size × Color × Matte × Paper
--    For Phase 1 we ship only 4 sizes × 1 color (black) × 1 matte × 1 paper = 4 variants.
--    Architect can expand the matrix via admin CSV import later.
-- ============================================================
insert into product_variants
  (id, product_id, size_code, size_label, width_mm, height_mm,
   color_code, matte_code, paper_code, price, stock, is_active)
values
  ('00000000-0000-0000-0000-000000000101'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid,
   '4x6',   '4×6 (10×15cm)',  102, 152, 'black', 'none', 'glossy',  4800, 99999, true),
  ('00000000-0000-0000-0000-000000000102'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid,
   '5x7',   '5×7 (13×18cm)',  127, 178, 'black', 'none', 'glossy',  7800, 99999, true),
  ('00000000-0000-0000-0000-000000000103'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid,
   '8x10',  '8×10 (20×25cm)', 203, 254, 'black', 'none', 'glossy', 14800, 99999, true),
  ('00000000-0000-0000-0000-000000000104'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid,
   '11x14', '11×14 (28×36cm)',279, 356, 'black', 'none', 'glossy', 24800, 99999, true)
on conflict (id) do update set
  price = excluded.price,
  stock = excluded.stock,
  is_active = excluded.is_active;


-- ============================================================
-- 4) shipping_methods — 008_shipping_methods.sql already seeds
--    STANDARD/PICKUP/QUICK defaults. No additional seed needed here.
-- ============================================================


-- ============================================================
-- 5) Placeholder image/PNG records (OPTIONAL — uncomment after
--    uploading actual files to Storage)
--
-- To use:
--  a) Supabase Dashboard → Storage → photos bucket
--     Upload these files:
--       - product-thumb-basic.jpg  (300×300, product card thumbnail)
--       - product-gallery-basic.jpg (1200×1200, detail page)
--       - frame-black.png   (1200×1500, transparent center, used as overlay)
--       - frame-black-preview.jpg (200×200, frame option swatch)
--
--  b) Then uncomment + run the inserts below.
--     The URL format is:
--       https://<project-ref>.supabase.co/storage/v1/object/public/photos/<filename>
-- ============================================================

-- insert into product_images (id, product_id, image_url, alt_text, type, sort_order) values
--   ('00000000-0000-0000-0000-000000000201'::uuid,
--    '00000000-0000-0000-0000-000000000010'::uuid,
--    'https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/photos/product-thumb-basic.jpg',
--    '베이직 액자 썸네일', 'thumbnail', 0),
--   ('00000000-0000-0000-0000-000000000202'::uuid,
--    '00000000-0000-0000-0000-000000000010'::uuid,
--    'https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/photos/product-gallery-basic.jpg',
--    '베이직 액자 상세 이미지', 'gallery', 0);

-- insert into frame_assets (id, product_id, color_code, color_label, png_url, inner_rect, preview_url) values
--   ('00000000-0000-0000-0000-000000000301'::uuid,
--    '00000000-0000-0000-0000-000000000010'::uuid,
--    'black', '블랙',
--    'https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/photos/frame-black.png',
--    '{"x":0.1,"y":0.1,"w":0.8,"h":0.8}'::jsonb,
--    'https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/photos/frame-black-preview.jpg');


-- ============================================================
-- 6) Admin role assignment (OPTIONAL)
--    To grant a user admin access (so /admin pages work),
--    update their app_metadata.role.
--
--    Replace '<user-email>' with the actual auth.users.email.
-- ============================================================

-- update auth.users
-- set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
-- where email = '<user-email>';


-- ============================================================
-- Verification
-- ============================================================
-- select count(*) as categories from categories where is_active;
-- select count(*) as products    from products  where is_active;
-- select count(*) as variants    from product_variants where is_active;
-- select code, fee, free_threshold, is_active from shipping_methods order by sort_order;
