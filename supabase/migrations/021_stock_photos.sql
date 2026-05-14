-- stock_photos: 어드민 등록 명화 이미지 (Supabase Storage 연동)

CREATE TABLE stock_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,         -- "모네 — 수련"
  artist      text,                   -- "Claude Monet"
  era         text,                   -- "인상주의"
  image_url   text NOT NULL,          -- Supabase Storage 원본 URL
  thumb_url   text NOT NULL,          -- 썸네일 URL
  width_px    int NOT NULL,
  height_px   int NOT NULL,
  is_active   boolean DEFAULT true,
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE stock_photos ENABLE ROW LEVEL SECURITY;

-- 누구나 활성 사진 SELECT 가능 (사용자 갤러리 표시)
CREATE POLICY "public_read" ON stock_photos
  FOR SELECT USING (is_active = true);

-- 관리자(서비스롤)만 INSERT/UPDATE/DELETE (RLS 우회)
-- 어드민 Route Handler에서 service role 사용
