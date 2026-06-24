-- 035_cart_items_project_link.sql
--
-- 확장형 상품 기반 (2/2) — cart_items / order_items 에 프로젝트 링크(전부 nullable).
-- 설계 SSOT: docs/specs/extended-product.md §4. 결정: ADR-023.
--
-- 비파괴: NULL 허용 컬럼만 추가한다. NULL = 레거시 단품(현행 경로 100% 유지).
-- 멱등: ADD COLUMN IF NOT EXISTS.
--
-- ★ 미적용 안전성(graceful): P0 코드는 이 컬럼들을 읽거나 쓰지 않는다(카트 DB SELECT/
--   UPSERT 가 명시적 컬럼 목록이라 새 컬럼을 건드리지 않음). 확장형 라인을 생성하는
--   편집기(P1)부터 사용하므로, 035 는 P1 게이트이지 현행 게이트가 아니다.

-- ─── 1. cart_items — 묶음 자식 라인 링크 + 혼합 방향 ───────────────────────────────
ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS project_id  uuid REFERENCES cart_projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS project_seq int,
  ADD COLUMN IF NOT EXISTS orientation text
    CHECK (orientation IS NULL OR orientation IN ('landscape', 'portrait'));

CREATE INDEX IF NOT EXISTS idx_cart_items_project ON cart_items (project_id);

COMMENT ON COLUMN cart_items.project_id IS
  '확장형 묶음 헤더(cart_projects). NULL = 레거시 단품(현행 경로). '
  '같은 project_id 를 가진 N행 = 한 프로젝트의 라인들(공유 사진풀).';
COMMENT ON COLUMN cart_items.project_seq IS
  '프로젝트 내 라인 표시 순번. NULL = 단품.';
COMMENT ON COLUMN cart_items.orientation IS
  '라인 방향(혼합 방향 지원). NULL = variant 기하(가로/세로)에서 파생되는 레거시 단품.';

-- ─── 2. order_items — 묶음을 같은 group_id N행으로 평면 전개 ────────────────────────
--   project_group_id 는 cart_projects FK 가 아니다(카트는 휘발, 주문은 영구 스냅샷).
--   createOrder 가 서버에서 새 group_id 를 부여한다. 015 "행당 단일 렌더메타·bleedMm
--   동결" 인쇄 불변식을 그대로 보존(재작성 불요).
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS project_group_id uuid,
  ADD COLUMN IF NOT EXISTS project_seq      int,
  ADD COLUMN IF NOT EXISTS orientation      text
    CHECK (orientation IS NULL OR orientation IN ('landscape', 'portrait'));

CREATE INDEX IF NOT EXISTS idx_order_items_project_group
  ON order_items (project_group_id);

COMMENT ON COLUMN order_items.project_group_id IS
  '확장형 묶음을 같은 group_id 를 가진 N개의 order_items 행으로 평면 전개. '
  'cart_projects FK 아님(서버가 주문 생성 시 부여). NULL = 단품.';
COMMENT ON COLUMN order_items.project_seq IS
  '묶음 내 라인 표시 순번. NULL = 단품.';
COMMENT ON COLUMN order_items.orientation IS
  '라인 방향 스냅샷(혼합 방향). NULL = 레거시(variant 기하에서 파생).';
