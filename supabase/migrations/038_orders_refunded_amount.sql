-- 038_orders_refunded_amount.sql
--
-- B-2 (부분환불): orders.refunded_amount — 누적 환불액(원) 스냅샷.
-- 결정: FS-EC-00 (이커머스 완성 웨이브 계약 동결). ADR-021 정합 근거.
--
-- 비파괴(non-destructive): 신규 컬럼(DEFAULT 0 백필)만 추가한다.
-- 멱등(idempotent): ADD COLUMN IF NOT EXISTS 로 재실행 안전.
--
-- ★ 미적용 안전성(graceful): 이 마이그레이션을 적용하지 않아도 앱은 정상 동작한다.
--   mapOrder() 가 refunded_amount 부재를 0 으로 폴백하고, 부분환불 기능은
--   feature-probe(isPartialRefundAvailable)가 false 를 돌려 UI/로직에서 숨긴다.
--   orders INSERT/UPDATE 는 구현 에이전트가 conditional-spread 로 처리(42703 방지).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refunded_amount int NOT NULL DEFAULT 0
  CHECK (refunded_amount >= 0);

COMMENT ON COLUMN orders.refunded_amount IS
  '부분환불 누적액(KRW). 0 = 환불 없음. 불변식: refunded_amount <= total_price. '
  '행(order_items) 단위 환불 산정은 행 가격 합계와 정합해야 한다 — ADR-021: 세트는 '
  '행별 비례배분으로 행 가격 합 = 세트가가 항상 유지되므로 행 기준 산정이 안전. '
  '전액 환불(status=REFUNDED)과 별개로, PAID 이후의 부분환불을 여기 누적한다.';
