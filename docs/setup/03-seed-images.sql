-- ============================================================
-- FrameShop image seed (run AFTER uploading placeholders to
-- the `photos` Storage bucket).
--
-- Placeholders uploaded via `supabase storage cp`:
--   - product-thumb-basic.jpg
--   - product-gallery-basic.jpg
--   - frame-black.png
--   - frame-black-preview.jpg
-- ============================================================

-- Product images (thumbnail + gallery)
insert into product_images (id, product_id, image_url, alt_text, type, sort_order) values
  ('00000000-0000-0000-0000-000000000201'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid,
   'https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/photos/product-thumb-basic.jpg',
   '베이직 액자 썸네일', 'thumbnail', 0),
  ('00000000-0000-0000-0000-000000000202'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid,
   'https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/photos/product-gallery-basic.jpg',
   '베이직 액자 상세 이미지', 'gallery', 0)
on conflict (id) do update set
  image_url = excluded.image_url,
  alt_text = excluded.alt_text,
  type = excluded.type,
  sort_order = excluded.sort_order;


-- Frame asset (black) — inner_rect normalised (0..1) per docs/PLAN.md §6.
-- The transparent center occupies 80% of width/height starting at 10%,10%.
-- This matches the alpha-cutout produced by the generator script.
insert into frame_assets (id, product_id, color_code, color_label, png_url, inner_rect, preview_url) values
  ('00000000-0000-0000-0000-000000000301'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid,
   'black', '블랙',
   'https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/photos/frame-black.png',
   '{"x":0.1,"y":0.1,"w":0.8,"h":0.8}'::jsonb,
   'https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/photos/frame-black-preview.jpg')
on conflict (id) do update set
  png_url = excluded.png_url,
  preview_url = excluded.preview_url,
  inner_rect = excluded.inner_rect;


-- Verification
-- select count(*) as product_images from product_images where product_id = '00000000-0000-0000-0000-000000000010';
-- select count(*) as frame_assets   from frame_assets   where product_id = '00000000-0000-0000-0000-000000000010';
