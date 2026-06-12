-- 030_orders_shipping_surcharge.sql
--
-- C3 (스튜디오 수정요청): 도서산간·제주 추가 배송비.
--   1. orders.surcharge_fee — 주문 생성 시점에 확정(스냅샷)된 추가 배송비(원).
--      육지/기본은 0. ADR-008 스냅샷 원칙(배송비처럼 주문 시점 동결).
--   2. shipping_methods.surcharge_fee_jeju / surcharge_fee_remote — 운영자가
--      배송설정에서 관리하는 제주/도서산간 추가요금. STANDARD 에만 의미 있고
--      PICKUP/QUICK 은 0.
--
-- 우편번호 판정(제주 63xxx, 도서산간 범위)은 앱 레이어 calculateSurcharge() 에서
-- 수행하고, 서버(createOrder)가 권위 있게 재계산하여 surcharge_fee 로 저장한다.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS surcharge_fee int NOT NULL DEFAULT 0
  CHECK (surcharge_fee >= 0);

COMMENT ON COLUMN orders.surcharge_fee IS
  'ADR-008 snapshot: Jeju/remote surcharge frozen at create time. 0 for mainland.';

ALTER TABLE shipping_methods
  ADD COLUMN IF NOT EXISTS surcharge_fee_jeju int NOT NULL DEFAULT 0
  CHECK (surcharge_fee_jeju >= 0);

ALTER TABLE shipping_methods
  ADD COLUMN IF NOT EXISTS surcharge_fee_remote int NOT NULL DEFAULT 0
  CHECK (surcharge_fee_remote >= 0);

COMMENT ON COLUMN shipping_methods.surcharge_fee_jeju IS
  'Surcharge (KRW) for Jeju (zip 63xxx). Meaningful for STANDARD; 0 for PICKUP/QUICK.';
COMMENT ON COLUMN shipping_methods.surcharge_fee_remote IS
  'Surcharge (KRW) for designated remote/island zip ranges. STANDARD only.';
