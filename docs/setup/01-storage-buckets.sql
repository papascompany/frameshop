-- ============================================================
-- FrameShop Storage Buckets & RLS
-- Run this AFTER 00-combined-migrations.sql.
-- ============================================================

-- 1) Create public buckets (photos = user uploads, previews = composited previews)
insert into storage.buckets (id, name, public)
values
  ('photos',   'photos',   true),
  ('previews', 'previews', true)
on conflict (id) do nothing;


-- 2) RLS policies for storage.objects
--    photos bucket:
--      - public READ (already public=true but we keep an explicit SELECT policy)
--      - INSERT/UPDATE/DELETE only via service_role
--        (the upload route in src/app/api/photos/upload/route.ts uses service role)
--    previews bucket:
--      - public READ
--      - INSERT only via service_role

-- Drop old policies if any (idempotent re-runs)
drop policy if exists "photos public read"     on storage.objects;
drop policy if exists "previews public read"   on storage.objects;

create policy "photos public read"
  on storage.objects for select
  using (bucket_id = 'photos');

create policy "previews public read"
  on storage.objects for select
  using (bucket_id = 'previews');

-- Note: storage.objects has RLS enabled by default in Supabase.
-- Service role bypasses RLS, so server-side uploads from
-- src/app/api/photos/upload/route.ts will work without
-- explicit INSERT policies. Anonymous and authenticated clients
-- cannot upload directly (no INSERT policy granted) — exactly what we want.
