-- 037_bundle_rules.sql
--
-- P2 (구성 규칙): bundle_rules — 확장형 상품 1:1 구성 검증/가격 규칙(선언적 규칙 엔진).
-- 설계 SSOT: docs/specs/extended-product.md §4. 결정: ADR-026 (FS-X-00 계약 동결).
--
-- 비파괴(non-destructive): 신규 테이블만 추가한다. 데이터 변경 없음.
-- 멱등(idempotent): IF NOT EXISTS / DROP POLICY IF EXISTS 로 재실행 안전.
--
-- ★ 미적용 안전성(graceful): 이 마이그레이션을 적용하지 않아도 앱은 정상 동작한다.
--   feature-probe(isBundleRulesAvailable)가 false 를 돌려 어드민 구성규칙 탭·구성
--   검증을 숨긴다. 규칙이 없는 상품은 규칙 검증 자체가 없던 현행 경로 그대로다.
--   ※ ADR-026: 세트가 재계산·할인 적용(createOrder)은 보류 — 이번 웨이브는
--   폼·저장·타입까지만 구현하므로 pricing_strategy/discount_bps/flat_price 는
--   아직 금전 경로에 닿지 않는다(현행 라인별 가격 검증 유지).

CREATE TABLE IF NOT EXISTS bundle_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 상품 1:1 — UNIQUE 가 FK 인덱스를 겸한다.
  product_id            uuid NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  min_slots             int NOT NULL DEFAULT 1 CHECK (min_slots >= 1),
  max_slots             int NOT NULL DEFAULT 1 CHECK (max_slots >= 1),
  -- 빈 배열 = 제한 없음(전체 허용) — src/types/set.ts BundleRule 주석과 동일 계약.
  allowed_size_codes    text[] NOT NULL DEFAULT '{}',
  allowed_orientations  text[] NOT NULL DEFAULT '{}',
  allow_size_mix        boolean NOT NULL DEFAULT true,
  allow_orientation_mix boolean NOT NULL DEFAULT true,
  allow_photo_reuse     boolean NOT NULL DEFAULT true,
  pricing_strategy      text NOT NULL DEFAULT 'sum'
                          CHECK (pricing_strategy IN ('sum', 'sum_with_discount', 'flat')),
  discount_bps          int CHECK (discount_bps IS NULL
                                   OR (discount_bps BETWEEN 0 AND 10000)),
  flat_price            int CHECK (flat_price IS NULL OR flat_price >= 0),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_rules_slots_range CHECK (max_slots >= min_slots)
);

COMMENT ON TABLE bundle_rules IS
  '확장형 상품의 구성 검증/가격 규칙(상품 1:1). 클라 편집기 + 서버 검증이 같은 행을 '
  '읽는 공통 SSOT. 앱 입력 검증은 src/types/set.ts bundleRuleInputSchema. '
  '가격 전략의 createOrder 적용은 ADR-026 보류(폼·저장까지만).';
COMMENT ON COLUMN bundle_rules.allowed_size_codes IS
  '허용 sizeCode 목록. 빈 배열 = 제한 없음(전체 허용).';
COMMENT ON COLUMN bundle_rules.allowed_orientations IS
  '허용 방향(landscape/portrait) 목록. 빈 배열 = 제한 없음.';
COMMENT ON COLUMN bundle_rules.pricing_strategy IS
  'sum = 라인 합산(현행) | sum_with_discount = 합산 후 discount_bps 할인 | '
  'flat = flat_price 고정가. sum 외 전략의 주문 적용은 ADR-026 보류.';

-- ─── RLS: 공개 SELECT(클라 편집기 구성 검증용 — 규칙은 비밀 아님), 쓰기 service-role ──
ALTER TABLE bundle_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bundle_rules_public_read ON bundle_rules;
CREATE POLICY bundle_rules_public_read ON bundle_rules
  FOR SELECT USING (true);
-- 쓰기 정책 없음 = anon/authenticated 쓰기 전면 차단(어드민 서버 액션의 service-role 만).
