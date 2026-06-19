-- 032_user_addresses.sql
--
-- Phase B-1: 회원 배송지 주소록.
-- 체크아웃마다 주소를 다시 입력하지 않도록 저장된 배송지를 관리한다.
-- 형태는 orders.shipping (ShippingAddress) 와 호환: recipient_name/phone/zip/addr1/addr2/memo.
-- 서버는 service-role + 코드 레벨 user_id 소유권 검증으로 접근(다른 테이블과 동일).
-- RLS 는 심층 방어로 함께 적용.

CREATE TABLE IF NOT EXISTS user_addresses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label          text NOT NULL DEFAULT '',            -- '집' / '회사' 등 사용자 라벨
  recipient_name text NOT NULL,
  phone          text NOT NULL,
  zip            text NOT NULL,
  addr1          text NOT NULL,
  addr2          text NOT NULL DEFAULT '',
  memo           text NOT NULL DEFAULT '',
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON user_addresses(user_id);

-- 사용자당 기본 배송지는 최대 1개 (부분 유니크 인덱스).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_default_address
  ON user_addresses(user_id) WHERE is_default;

ALTER TABLE user_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_addresses_owner ON user_addresses;
CREATE POLICY user_addresses_owner ON user_addresses
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
