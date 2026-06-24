-- 034_products_product_type.sql
--
-- 확장형 상품 기반 (1/2) — products.product_type + cart_projects 묶음 헤더.
-- 설계 SSOT: docs/specs/extended-product.md §4. 결정: ADR-023.
--
-- 비파괴(non-destructive): 신규 컬럼(DEFAULT 백필) + 신규 테이블만 추가한다.
-- 멱등(idempotent): IF NOT EXISTS / DROP POLICY IF EXISTS 로 재실행 안전.
--
-- ★ 미적용 안전성(graceful): 이 마이그레이션을 적용하지 않아도 앱은 정상 동작한다.
--   mapProduct() 가 product_type 부재/NULL 을 'single' 로 폴백하므로 카탈로그/에디터가
--   현행 단품 경로 100% 유지된다(ADR-023). 즉 034 는 확장형(P1+) 게이트이지 현행 게이트가 아니다.

-- ─── 1. products.product_type — 카탈로그/에디터/검증 1차 분기축 ────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'single'
  CHECK (product_type IN ('single', 'extended'));

COMMENT ON COLUMN products.product_type IS
  'Catalog/editor branching axis. single = 현행 단품(사진1 → 사이즈1). '
  'extended = 멀티포토·혼합 사이즈/방향·세트. 기존행은 DEFAULT single 으로 백필. '
  'App(mapProduct)은 부재/NULL 을 single 로 폴백하므로 미적용 상태에서도 안전.';

-- ─── 2. cart_projects — 확장형 묶음 헤더(공유 사진풀 + N라인) ───────────────────────
--   단품(single)은 이 테이블을 쓰지 않는다(레거시 평면 cart_items 경로 유지).
--   익명 지원: user_id NULL 이면 session_id 로 소유권 격리(ADR-010 photos 패턴 재사용).
--   클라 생성 project_local_id 로 localStorage ↔ DB dedup(ADR-011 cart_items.local_id 패턴).
CREATE TABLE IF NOT EXISTS cart_projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_local_id uuid NOT NULL,
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id       text,
  kind             text NOT NULL DEFAULT 'extended'
                     CHECK (kind IN ('basic', 'extended')),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  title            text NOT NULL DEFAULT '',
  -- set_template_id 는 036 set_templates 도입 시 FK 추가(좌표 有=벽모드, 無=그리드모드).
  -- 034 를 036 보다 먼저 적용할 수 있도록 지금은 FK 없이 컬럼만 둔다.
  set_template_id  uuid,
  photo_pool       jsonb NOT NULL DEFAULT '[]'::jsonb,
  pricing          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- 회원 또는 익명 세션 중 하나는 반드시 소유자여야 한다(ADR-010 패턴).
  CONSTRAINT cart_projects_owner_present
    CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

COMMENT ON TABLE cart_projects IS
  '확장형 묶음(프로젝트) 헤더: 공유 사진풀 + N개의 cart_items 라인. '
  'single 단품은 사용하지 않음(레거시 평면 경로 유지).';

-- dedup 유니크: 회원은 (user_id, project_local_id), 익명은 (session_id, project_local_id).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_project_user_local
  ON cart_projects (user_id, project_local_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_project_session_local
  ON cart_projects (session_id, project_local_id) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_cart_projects_user ON cart_projects (user_id);
CREATE INDEX IF NOT EXISTS idx_cart_projects_session ON cart_projects (session_id);

-- ─── 3. RLS — 본인 것만 SELECT, 쓰기는 서비스롤(서버) 경유(익명 지원) ──────────────
--   cart_items 와 동일 운영: 서버가 service-role + 코드 레벨 소유권 검증으로 쓴다.
--   RLS 는 심층 방어로 회원 SELECT 만 허용(익명 행은 서버 라우트에서만 노출).
ALTER TABLE cart_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cart_projects_owner_select ON cart_projects;
CREATE POLICY cart_projects_owner_select ON cart_projects
  FOR SELECT TO authenticated USING (user_id = auth.uid());
