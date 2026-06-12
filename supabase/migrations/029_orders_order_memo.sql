-- 029_orders_order_memo.sql
--
-- C5 (스튜디오 수정요청): 주문자 추가 메모.
-- 배송 메모(shipping.memo, 배송기사 대상)와 구분되는 주문 단위 자유 메모.
-- 사이즈 변경 요청 / 지급(서류) 신청 등 주문자가 운영팀에 남기는 요청사항.
-- nullable, 앱 레이어에서 최대 200자 검증.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_memo text;

COMMENT ON COLUMN orders.order_memo IS
  'Orderer-level free-form note (size change / payment request). Distinct from '
  'shipping.memo (courier instructions). Nullable; max 200 chars enforced in app.';
