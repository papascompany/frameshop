-- user_integrations: 소셜 서비스 OAuth 토큰 저장 (Google Photos 등)

CREATE TABLE user_integrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider       text NOT NULL,         -- 'google_photos'
  access_token   text NOT NULL,
  refresh_token  text,
  expires_at     timestamptz,
  created_at     timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;

-- 본인 레코드만 SELECT/UPDATE/DELETE
CREATE POLICY "own_only" ON user_integrations
  USING (user_id = auth.uid());
