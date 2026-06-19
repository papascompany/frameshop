-- 033_orders_confirmed_at.sql
--
-- Phase B-1: 구매확정(purchase confirmation).
-- 배송완료(DELIVERED) 후 고객이 "구매확정"하면 set 되는 시각.
-- ORDER_STATUSES 열거형은 FROZEN 이므로 새 상태를 추가하지 않고 timestamptz 컬럼으로 표현한다.
-- 적립금 적립(B-2)·리뷰 작성 등의 게이트로 사용된다. nullable; 한 번 set 되면 불변(앱 레이어 보장).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

COMMENT ON COLUMN orders.confirmed_at IS
  'Purchase-confirmed time. Set when the customer confirms receipt after DELIVERED. '
  'Gate for points accrual (Phase B-2) and review eligibility. NULL = not yet confirmed.';
