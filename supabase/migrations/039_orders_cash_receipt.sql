-- 039_orders_cash_receipt.sql
--
-- B-2 (현금영수증): orders 에 신청·발급 결과 컬럼 4개.
-- 결정: FS-EC-00 (이커머스 완성 웨이브 계약 동결).
--
-- 비파괴(non-destructive): NULL 허용 컬럼만 추가한다. NULL = 미신청(현행 주문 동일).
-- 멱등(idempotent): ADD COLUMN IF NOT EXISTS 로 재실행 안전.
--
-- ★ 미적용 안전성(graceful): 이 마이그레이션을 적용하지 않아도 앱은 정상 동작한다.
--   mapOrder() 가 receipt_* 부재를 null 로 폴백하고, 현금영수증 기능은
--   feature-probe(isReceiptAvailable)가 false 를 돌려 UI/로직에서 숨긴다.
--   orders INSERT 는 구현 에이전트가 conditional-spread 로 처리(42703 방지).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS receipt_type text
    CHECK (receipt_type IS NULL OR receipt_type IN ('income', 'proof')),
  ADD COLUMN IF NOT EXISTS receipt_info text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS receipt_issued_at timestamptz;

COMMENT ON COLUMN orders.receipt_type IS
  '현금영수증 신청 유형. income = 소득공제(개인), proof = 지출증빙(사업자), '
  'NULL = 미신청. 주문 생성 시 스냅샷.';
COMMENT ON COLUMN orders.receipt_info IS
  '현금영수증 식별번호(숫자·하이픈). income = 휴대폰번호 등, proof = 사업자등록번호. '
  'NULL = 미신청.';
COMMENT ON COLUMN orders.receipt_url IS
  'Toss cashReceipt 발급 결과의 영수증 URL. 발급 전/미신청 = NULL.';
COMMENT ON COLUMN orders.receipt_issued_at IS
  'Toss cashReceipt 발급 완료 시각. 발급 전/미신청 = NULL.';
