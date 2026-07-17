-- 036_set_templates.sql
--
-- P2 (세트 프리셋): set_templates — 어드민이 정의하는 세트 구성 프리셋 +
-- cart_projects.set_template_id FK 이행(034 주석의 예고).
-- 설계 SSOT: docs/specs/extended-product.md §4. 결정: ADR-026 (FS-X-00 계약 동결).
--
-- 비파괴(non-destructive): 신규 테이블 + 기존 nullable 컬럼(034)에 FK "추가"만 한다.
--   데이터 변경 없음. FK 는 ON DELETE SET NULL 이라 템플릿 삭제가 카트를 파괴하지 않는다.
-- 멱등(idempotent): IF NOT EXISTS / DROP POLICY IF EXISTS / DO 블록 constraint 존재 확인.
--   ※ `ADD CONSTRAINT ... IF NOT EXISTS` 는 Postgres 문법에 없다 — pg_constraint 확인 후 추가.
--
-- ★ 미적용 안전성(graceful): 이 마이그레이션을 적용하지 않아도 앱은 정상 동작한다.
--   feature-probe(isSetTemplatesAvailable)가 false 를 돌려 세트 템플릿 UI(어드민 탭·
--   카탈로그 세트 노출)를 숨긴다. cart_projects.set_template_id 는 034 부터 이미 존재하는
--   NULL 컬럼이라 읽기/쓰기 경로 무영향(FK 없던 기간의 값은 전부 NULL — 위반 데이터 없음).

CREATE TABLE IF NOT EXISTS set_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name             text NOT NULL,
  -- [{slotIndex, sizeCode, orientation, slotPos{xMm,yMm,wMm,hMm}}]
  -- slotPos 有 = 벽모드(WallCanvas 미니맵 좌표 배치), 無 = 그리드모드.
  slots            jsonb NOT NULL DEFAULT '[]'::jsonb,
  wall_w_mm        int CHECK (wall_w_mm IS NULL OR wall_w_mm > 0),
  wall_h_mm        int CHECK (wall_h_mm IS NULL OR wall_h_mm > 0),
  set_price        int CHECK (set_price IS NULL OR set_price >= 0),
  set_discount_bps int CHECK (set_discount_bps IS NULL
                              OR (set_discount_bps BETWEEN 0 AND 10000)),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE set_templates IS
  '어드민 세트 구성 프리셋(확장형 상품 P2). slots jsonb 의 slotPos(mm) 유무로 '
  '벽모드/그리드모드를 분기한다. 세트가/세트할인의 createOrder 적용은 ADR-026 에서 '
  '보류 — 이번 웨이브는 프리셋 정의·표시까지만 사용한다.';
COMMENT ON COLUMN set_templates.slots IS
  'jsonb 배열: [{slotIndex int, sizeCode text, orientation landscape|portrait, '
  'slotPos?{xMm,yMm,wMm,hMm}}]. 앱 검증 SSOT 는 src/types/set.ts setTemplateSlotSchema.';
COMMENT ON COLUMN set_templates.wall_w_mm IS
  '벽모드 벽 폭(mm). NULL = 그리드모드.';
COMMENT ON COLUMN set_templates.wall_h_mm IS
  '벽모드 벽 높이(mm). NULL = 그리드모드.';
COMMENT ON COLUMN set_templates.set_price IS
  '세트 정가(KRW, flat). NULL = 미사용. 적용은 ADR-026 보류(폼·저장까지만).';
COMMENT ON COLUMN set_templates.set_discount_bps IS
  '세트 할인(bps, 10000 = 100%). NULL = 미사용. 적용은 ADR-026 보류(폼·저장까지만).';

CREATE INDEX IF NOT EXISTS idx_set_templates_product ON set_templates (product_id);

-- ─── RLS: 공개 SELECT(is_active — 카탈로그 노출용), 쓰기는 service-role 전용 ─────────
ALTER TABLE set_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS set_templates_public_read ON set_templates;
CREATE POLICY set_templates_public_read ON set_templates
  FOR SELECT USING (is_active);
-- 쓰기 정책 없음 = anon/authenticated 쓰기 전면 차단(어드민 서버 액션의 service-role 만).

-- ─── cart_projects.set_template_id FK 이행(034 예고) ────────────────────────────────
--   034 는 "036 을 나중에 적용할 수 있도록 FK 없이 컬럼만" 두었다. 이제 테이블이
--   생겼으니 FK 를 건다. ADD CONSTRAINT 에는 IF NOT EXISTS 문법이 없으므로
--   pg_constraint 존재 확인 DO 블록으로 멱등화한다. cart_projects 자체가 없으면
--   (034 미적용 순서 역전 방어) 아무것도 하지 않는다 — 001~042 순차 적용에선 항상 존재.
DO $$
BEGIN
  IF to_regclass('public.cart_projects') IS NULL THEN
    RETURN; -- 034 미적용(순차 적용에선 발생하지 않음) — FK/인덱스/코멘트 전부 생략.
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'cart_projects_set_template_fk'
      AND conrelid = 'public.cart_projects'::regclass
  ) THEN
    ALTER TABLE cart_projects
      ADD CONSTRAINT cart_projects_set_template_fk
      FOREIGN KEY (set_template_id) REFERENCES set_templates(id) ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_cart_projects_set_template
    ON cart_projects (set_template_id);

  COMMENT ON COLUMN cart_projects.set_template_id IS
    'set_templates 좌표 프리셋 참조(036 에서 FK 이행). 有 = 벽모드, NULL = 그리드모드/'
    '자유구성. 템플릿 삭제 시 SET NULL — 프로젝트는 그리드모드로 폴백한다.';
END $$;
