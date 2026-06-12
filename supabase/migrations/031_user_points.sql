-- 031_user_points.sql
--
-- C2 (스튜디오 수정요청): 적립금(reward points). 1 point = 1 KRW, 정수.
--
-- 설계:
--   - user_profiles: 사용자별 가변 상태. points_balance 가 차감의 권위.
--     (auth.users 는 Supabase 관리 테이블이라 앱 마이그레이션에서 ALTER 하지 않음.)
--   - user_points_ledger: 불변 감사 로그(적립/차감/조정/환불 복원).
--   - orders.points_redeemed / points_accrued: 주문 스냅샷.
--       * total_price 는 points_redeemed 를 이미 차감한 최종 금액으로 저장 →
--         confirm.ts 의 (order.totalPrice === input.amount) 검증을 변경 없이 유지.
--   - apply_points_transaction(): 잔액 갱신 + 원장 기록을 원자적으로 수행.
--       CHECK(points_balance >= 0) 으로 초과 차감(이중지불)을 DB 레벨에서 차단.
--       SECURITY DEFINER 이므로 anon/authenticated 의 EXECUTE 를 회수하고
--       서버(서비스롤) 코드에서만 호출한다.

-- ─── 1. 잔액 ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  points_balance int NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_profiles IS
  'Per-user mutable state. points_balance is authoritative for redemption.';

-- ─── 2. 원장(불변) ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_points_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id         uuid REFERENCES orders(id) ON DELETE SET NULL,
  transaction_type text NOT NULL CHECK (
    transaction_type IN ('ACCRUAL','REDEMPTION','ADJUSTMENT','REFUND')
  ),
  points_delta     int NOT NULL,
  balance_after    int NOT NULL CHECK (balance_after >= 0),
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_points_ledger_user_idx
  ON user_points_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_points_ledger_order_idx
  ON user_points_ledger (order_id);
COMMENT ON TABLE user_points_ledger IS
  'Immutable audit log. Idempotency: check existing ACCRUAL per order_id before re-accruing.';

-- ─── 3. 주문 스냅샷 컬럼 ──────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_redeemed int NOT NULL DEFAULT 0
  CHECK (points_redeemed >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_accrued  int NOT NULL DEFAULT 0
  CHECK (points_accrued >= 0);
COMMENT ON COLUMN orders.points_redeemed IS
  'Points (=KRW 1:1) deducted at order create. orders.total_price ALREADY nets this out.';
COMMENT ON COLUMN orders.points_accrued IS
  'Points earned on PAID; recorded so a refund can reverse them.';

-- ─── 4. 원자적 트랜잭션 RPC ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_points_transaction(
  p_user_id uuid, p_order_id uuid, p_type text, p_delta int, p_description text
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new int;
BEGIN
  INSERT INTO user_profiles (user_id, points_balance) VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
  -- The CHECK(points_balance >= 0) aborts the statement (and the whole tx) when
  -- a redemption would overdraw — this is the double-spend guard.
  UPDATE user_profiles
     SET points_balance = points_balance + p_delta, updated_at = now()
   WHERE user_id = p_user_id
   RETURNING points_balance INTO v_new;
  INSERT INTO user_points_ledger
    (user_id, order_id, transaction_type, points_delta, balance_after, description)
  VALUES (p_user_id, p_order_id, p_type, p_delta, v_new, p_description);
  RETURN v_new;
END;
$$;

-- SECURITY DEFINER + arbitrary p_user_id ⇒ must NOT be callable by clients.
REVOKE ALL ON FUNCTION apply_points_transaction(uuid, uuid, text, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_points_transaction(uuid, uuid, text, int, text) FROM anon, authenticated;

-- ─── 5. RLS — 사용자는 본인 잔액/원장만 SELECT, 쓰기는 서비스롤(RPC)만 ──────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_profiles_owner_select ON user_profiles;
CREATE POLICY user_profiles_owner_select ON user_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE user_points_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_points_ledger_owner_select ON user_points_ledger;
CREATE POLICY user_points_ledger_owner_select ON user_points_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());
