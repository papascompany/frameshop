-- 041_wishlists.sql
--
-- 위시리스트(로그인 전용 — CTO 확정). 결정: ADR-026 (FS-X-00 계약 동결).
--
-- 비파괴(non-destructive): 신규 테이블만 추가한다. 데이터 변경 없음.
-- 멱등(idempotent): IF NOT EXISTS / DROP POLICY IF EXISTS 로 재실행 안전.
--
-- ★ 미적용 안전성(graceful): 이 마이그레이션을 적용하지 않아도 앱은 정상 동작한다.
--   feature-probe(isWishlistAvailable)가 false 를 돌려 하트 아일랜드·account/wishlist
--   UI 를 숨긴다(42P01 노출 금지).
--
-- 정책(ADR-026): 로그인 전용 — user_id NOT NULL, 익명 localStorage 위시 없음.
--   (user_id, product_id) UNIQUE 로 토글이 멱등(중복 하트 불가).

CREATE TABLE IF NOT EXISTS wishlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_wishlist_user_product UNIQUE (user_id, product_id)
);

COMMENT ON TABLE wishlists IS
  '위시리스트(로그인 전용, ADR-026). (user_id, product_id) UNIQUE — 토글 멱등. '
  '상품/회원 삭제 시 함께 삭제(부모 없이는 의미 없는 데이터).';

-- UNIQUE(user_id, product_id) 가 user_id 선행 인덱스를 겸한다. product_id 는 별도.
CREATE INDEX IF NOT EXISTS idx_wishlists_product ON wishlists (product_id);

-- ─── RLS: 032(user_addresses) 스타일 owner FOR ALL — 본인 행만 CRUD ────────────────
ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wishlists_owner ON wishlists;
CREATE POLICY wishlists_owner ON wishlists
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
