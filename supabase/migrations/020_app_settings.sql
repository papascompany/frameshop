-- app_settings: 어드민 설정 키-값 저장소
-- 서비스롤(Route Handler 전용)만 읽기/쓰기 — anon/auth 직접 접근 불가

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 모든 접근을 기본적으로 차단 (서비스롤은 RLS 우회)
CREATE POLICY "service_role_only" ON app_settings
  USING (false)
  WITH CHECK (false);
