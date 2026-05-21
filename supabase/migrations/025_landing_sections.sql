-- 025_landing_sections.sql
-- 랜딩 페이지 섹션별 이미지/텍스트 관리 테이블

-- update_updated_at 함수가 없을 수 있으므로 존재 여부 확인 후 생성
-- (008_shipping_methods.sql 에 touch_updated_at 함수가 있지만 이름이 다름)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TABLE landing_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key  text NOT NULL UNIQUE,  -- 'hero_1', 'hero_2', 'hero_3', 'masterpiece_1' 등
  section_type text NOT NULL          -- 'hero' | 'masterpiece' | 'landscape' | 'lifestyle' | 'member_benefit'
                 CHECK (section_type IN ('hero', 'masterpiece', 'landscape', 'lifestyle', 'member_benefit')),
  sort_order   int  NOT NULL DEFAULT 0,
  is_active    boolean DEFAULT true,
  image_url    text,                  -- 업로드된 이미지 URL (null이면 static 기본값 사용)
  payload      jsonb DEFAULT '{}'::jsonb,  -- 섹션별 텍스트 필드
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS landing_sections_type_idx
  ON landing_sections (section_type, sort_order);

ALTER TABLE landing_sections ENABLE ROW LEVEL SECURITY;

-- anon read (랜딩 페이지 공개 조회)
CREATE POLICY "public_read" ON landing_sections
  FOR SELECT USING (true);

-- 관리자 전체 쓰기 (is_admin 함수는 기존 마이그레이션에서 정의됨)
CREATE POLICY "admin_write" ON landing_sections
  FOR ALL USING (is_admin());

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS landing_sections_updated_at ON landing_sections;
CREATE TRIGGER landing_sections_updated_at
  BEFORE UPDATE ON landing_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE landing_sections IS '랜딩 페이지 섹션별 이미지/텍스트 CMS (ADR-025).';
COMMENT ON COLUMN landing_sections.section_key IS 'hero_1 ~ hero_3, masterpiece_1 ~ masterpiece_6, landscape_1 ~ landscape_5, lifestyle_1, member_benefit_1 ~ member_benefit_3';
COMMENT ON COLUMN landing_sections.image_url IS 'null이면 landing-curation.ts의 정적 기본값 사용';
COMMENT ON COLUMN landing_sections.payload IS '섹션별 텍스트 필드 JSON (eyebrow, headline, subhead 등)';
