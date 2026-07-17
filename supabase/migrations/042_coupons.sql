-- 042_coupons.sql
--
-- 쿠폰: coupons + coupon_redemptions + orders 스냅샷 2컬럼.
-- 결정: ADR-026 (FS-X-00 계약 동결 — 쿠폰 정책 전문).
--
-- 비파괴(non-destructive): 신규 테이블 2개 + orders 신규 컬럼(DEFAULT 백필)만 추가한다.
-- 멱등(idempotent): IF NOT EXISTS / DROP POLICY IF EXISTS 로 재실행 안전.
--
-- ★ 미적용 안전성(graceful): 이 마이그레이션을 적용하지 않아도 앱은 정상 동작한다.
--   feature-probe(isCouponsAvailable)가 false 를 돌려 체크아웃 쿠폰 입력 카드를
--   숨기고 createOrder 쿠폰 경로를 거부한다. orders INSERT 는 conditional-spread
--   (42703 방지), mapOrder 는 coupon_discount 부재를 0 으로 폴백한다.
--
-- 정책(ADR-026 확정):
-- - type: fixed(value=KRW 정액) | percent(value=bps, subtotal 기준, 상한 payable).
-- - 할인 순서: subtotal + shipping + surcharge − 쿠폰할인 − 적립금 = total_price
--   (net 저장, 031 계약 유지 — confirm.ts 무변경).
-- - 전체 한도: 조건부 UPDATE 원자 차감 —
--     UPDATE coupons SET used_count = used_count + 1
--      WHERE id = ? AND is_active
--        AND (usage_limit IS NULL OR used_count < usage_limit);
--   0행 = 소진 거부(COUPON_EXHAUSTED). 주문 INSERT 실패 시 보상: used_count 원복(-1)
--   + coupon_redemptions 행 삭제(redeem 보상 패턴 미러).
-- - 회원 1인 1회: coupon_redemptions UNIQUE(coupon_id, user_id). 비회원은 미기록
--   (식별 불가 — 전체 한도만 적용).

-- ─── 1. coupons — 쿠폰 정의 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 대문자 정규화 코드(normalizeCouponCode: trim+upper) — 앱과 DB 가 같은 계약.
  code         text NOT NULL UNIQUE CHECK (code = upper(btrim(code))),
  type         text NOT NULL CHECK (type IN ('fixed', 'percent')),
  value        int  NOT NULL CHECK (value > 0),
  min_subtotal int  NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  expires_at   timestamptz,
  usage_limit  int CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count   int NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- percent 는 100%(10000bps) 초과 금지.
  CONSTRAINT coupons_percent_value_bounds
    CHECK (type <> 'percent' OR value <= 10000)
);

COMMENT ON TABLE coupons IS
  '쿠폰 정의(ADR-026). SELECT 는 service-role 전용(RLS 정책 없음) — 코드 열거 방지, '
  '검증은 서버 API(/api/coupons/validate) 경유. 앱 검증 SSOT: src/types/coupon.ts.';
COMMENT ON COLUMN coupons.code IS
  '대문자 정규화 코드(trim+upper). 조회/저장 모두 normalizeCouponCode 를 거친다.';
COMMENT ON COLUMN coupons.value IS
  'fixed = 할인액(KRW), percent = 할인율(bps, 10000 = 100%). 할인 계산: '
  'src/lib/coupon/calc.ts calcCouponDiscount — percent 는 subtotal 기준, 상한 payable.';
COMMENT ON COLUMN coupons.used_count IS
  '사용 누계. 조건부 UPDATE 원자 차감(0행 = 소진 거부) — 주문 실패 시 -1 보상.';

-- ─── 2. coupon_redemptions — 회원 1인 1회 원장 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id  uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 주문 삭제/정리 시에도 사용 이력은 남긴다(1인 1회 근거 유지).
  order_id   uuid REFERENCES orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 회원 1인 1회의 유일성 근거. INSERT 충돌(23505) = COUPON_ALREADY_USED.
  CONSTRAINT uniq_coupon_redemption_per_user UNIQUE (coupon_id, user_id)
);

COMMENT ON TABLE coupon_redemptions IS
  '회원 쿠폰 사용 원장(1인 1회 — UNIQUE(coupon_id, user_id), ADR-026). 비회원 사용은 '
  '미기록(식별 불가 — coupons.used_count 전체 한도만 적용). 주문 INSERT 실패 시 '
  '보상 삭제 대상.';

-- UNIQUE(coupon_id, user_id) 가 coupon_id 선행 인덱스를 겸한다.
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON coupon_redemptions (user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_order ON coupon_redemptions (order_id);

-- ─── 3. orders 스냅샷 2컬럼 — 주문 시점 쿠폰 동결 ──────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_discount int NOT NULL DEFAULT 0
    CHECK (coupon_discount >= 0);

COMMENT ON COLUMN orders.coupon_code IS
  '주문에 적용된 쿠폰 코드 스냅샷(정규화 코드). NULL = 쿠폰 미사용. 쿠폰 원본이 '
  '수정/삭제돼도 주문 표시가 불변하도록 코드 문자열을 동결한다.';
COMMENT ON COLUMN orders.coupon_discount IS
  '쿠폰 할인액 스냅샷(KRW). 0 = 미사용. total_price 는 쿠폰·적립금 차감 후 net 저장'
  '(031 계약 유지 — confirm.ts 의 totalPrice === amount 검증 무변경).';

-- ─── 4. RLS ────────────────────────────────────────────────────────────────────────
-- coupons: 정책 없음 = anon/authenticated 전면 차단(service-role 전용) — 코드 열거 방지.
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

-- coupon_redemptions: 본인 사용 이력만 SELECT. 쓰기는 service-role(주문 경로) 전용.
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coupon_redemptions_owner_select ON coupon_redemptions;
CREATE POLICY coupon_redemptions_owner_select ON coupon_redemptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
