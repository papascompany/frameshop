-- 044_security_hardening.sql
--
-- 정식 오픈 전 보안 검토 후속 — DB 권한 하드닝 + 적립금 원장 멱등 인덱스.
--
-- 배경(코드 근거):
--   P0-1  012 orders_owner_insert(FOR INSERT TO authenticated WITH CHECK user_id = auth.uid())
--         때문에 로그인 사용자가 공개 anon key 로 PostgREST `POST /rest/v1/orders` 에
--         status / total_price / points_redeemed / payment_id 를 임의로 넣을 수 있었다.
--         이후 고객 취소(CREATED + payment_id null → Toss 없이 CANCELLED)나 결제 스윕
--         만료가 주문 행 스냅샷 points_redeemed 만큼 적립금을 복원 → 무한 발행.
--         앱의 orders / order_items 쓰기는 전부 service-role(createOrder 등)이다.
--   P1-5  014 가 next_order_no(date) EXECUTE 를 authenticated 에 줬다 — 로그인 사용자가
--         RPC 로 하루 주문번호를 소진(seq > 9999 → `^\d{8}-\d{4}$` 위반)시켜 결제 마비.
--   P1-6  023 reviews own_insert / own_update — 주문 검증 없이 리뷰 작성, 관리자가 숨긴
--         리뷰(is_public=false)를 본인이 되돌림.
--   P2-3  012 photos authenticated INSERT/UPDATE — storage_path 를 타인 경로로 바꿔 인쇄
--         렌더(service-role 서명 URL)로 타인 비공개 사진 유출 가능.
--   P2-6  031 apply_points_transaction SECURITY DEFINER 에 SET search_path 없음.
--   P1-1  user_points_ledger 에 (order_id, transaction_type) UNIQUE 가 없어 동시 취소/
--         구매확정 시 check-then-insert 경쟁으로 이중 복원·이중 적립 가능.
--
-- 앱 쓰기 경로 감사(044 적용 후에도 동작해야 하는 경로):
--   - orders / order_items : 전부 getServiceRoleSupabase() (src/lib/db/order.ts,
--     src/lib/payment/confirm.ts, src/lib/render/pipeline.ts, src/app/admin/orders/actions.ts).
--     관리자 화면도 service-role 이다 — 사용자 세션으로 orders 를 UPDATE 하는 곳 0건.
--   - photos : createPhoto(src/lib/db/photo.ts) service-role. 사용자 세션 쓰기 0건.
--   - reviews : 관리자 숨김(toggleReviewPublic)은 service-role, 그러나 작성(createReview,
--     src/lib/db/reviews.ts)은 **사용자 세션(getServerSupabase)** 으로 INSERT 한다.
--     → own_insert 를 그냥 DROP 하면 리뷰 작성이 깨지므로, 앱 라우트(/api/reviews)와
--       같은 조건(본인 주문 + DELIVERED)을 DB 에서 강제하는 정책으로 **교체**한다.
--       own_update 는 앱 사용처가 없어 DROP.
--   - next_order_no : generateOrderNo(src/lib/db/order.ts) service-role.
--   - apply_points_transaction : src/lib/db/points.ts service-role.
--
-- 비파괴(non-destructive): 데이터 행 변경·삭제 없음. 정책 DROP/CREATE, 권한 REVOKE,
--   함수 본문 교체(반환형·시그니처 동일), 함수 설정, 인덱스 추가만 한다.
-- 멱등(idempotent): DROP POLICY IF EXISTS → CREATE POLICY, REVOKE(이미 없으면 no-op),
--   CREATE OR REPLACE FUNCTION, ALTER FUNCTION ... SET(재설정 no-op),
--   CREATE UNIQUE INDEX IF NOT EXISTS — 재실행 안전.
--
-- ★ 사전 점검(적용 전 반드시 실행) — 결과가 0행이어야 §5 UNIQUE 인덱스가 생성된다.
--   중복이 있으면 인덱스 생성이 실패하고 이 파일 전체(트랜잭션)가 롤백된다:
--
--     SELECT order_id, transaction_type, count(*) AS n
--       FROM public.user_points_ledger
--      WHERE order_id IS NOT NULL
--      GROUP BY order_id, transaction_type
--     HAVING count(*) > 1;
--
--   0행이 아니면 이중 복원/이중 적립이 이미 발생한 것 — 운영자가 원장·잔액을 검토해
--   ADJUSTMENT(order_id NULL)로 보정한 뒤, 중복 행의 order_id 를 정리하고 재실행한다
--   (원장은 불변 감사 로그이므로 이 마이그레이션은 행을 지우지 않는다).
--
-- ★ 미적용 안전성(graceful): 적용하지 않아도 앱은 동작한다(취약점만 남는다).
--   src/lib/db/points.ts 는 원장 사전 조회(check)를 유지하고, 인덱스가 있으면
--   23505(UNIQUE 위반)를 멱등 성공으로 처리한다.

-- ─── 1. orders / order_items — 클라이언트 직접 쓰기 차단 (P0-1) ─────────────────
-- orders_owner_select / order_items_owner_select(SELECT)는 유지 — 마이페이지 등 읽기용.
DROP POLICY IF EXISTS orders_owner_insert ON orders;

-- 테이블 권한 자체를 회수한다(RLS 보다 앞서 평가). service_role 은 영향 없음.
-- TRUNCATE 는 RLS 를 우회하므로 같은 문장에서 함께 회수한다(PostgREST 노출은 없음).
-- 참고: orders_admin_update(FOR UPDATE TO authenticated USING is_admin())는 남겨 두지만,
--   UPDATE 권한이 없으므로 더 이상 도달하지 않는다. 관리자 상태 전이는 전부
--   service-role 서버 액션(src/app/admin/orders/actions.ts)이라 영향 없음.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders, public.order_items
  FROM anon, authenticated;

-- ─── 2. next_order_no — 서비스롤 전용 + 일일 상한 명시 (P1-5) ─────────────────────
-- 본문은 014 와 동일, seq 9999 초과 시 명시적 예외만 추가. 예외는 RPC 트랜잭션 전체를
-- 롤백하므로 order_sequences.seq 는 9999 에 머무른다(형식 위반 주문번호를 만들지 않음).
-- CREATE OR REPLACE 는 기존 소유자·권한·COMMENT 를 유지한다.
CREATE OR REPLACE FUNCTION public.next_order_no(day_kst date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result int;
BEGIN
  -- Single-statement atomic increment. `RETURNING seq` is evaluated AFTER
  -- the row is locked & updated, so concurrent callers serialize on the
  -- per-day row and each receives a distinct, monotonically increasing seq.
  INSERT INTO public.order_sequences (day, seq)
       VALUES (day_kst, 1)
  ON CONFLICT (day) DO UPDATE
       SET seq = public.order_sequences.seq + 1
  RETURNING seq INTO result;

  -- order_no 형식은 YYYYMMDD-NNNN(4자리). 초과분은 형식 위반이므로 할당하지 않는다.
  IF result > 9999 THEN
    RAISE EXCEPTION 'next_order_no: daily order sequence exhausted for % (seq=%)',
      day_kst, result
      USING ERRCODE = 'P0001';
  END IF;

  RETURN result;
END;
$$;

-- Supabase 기본 권한(default privileges)은 public 함수에 anon 에도 EXECUTE 를 줄 수
-- 있으므로 anon 도 함께 회수한다. service_role GRANT(014)는 유지.
REVOKE EXECUTE ON FUNCTION public.next_order_no(date) FROM anon, authenticated;

-- ─── 3. reviews — 주문 검증 없는 작성/본인 숨김 해제 차단 (P1-6) ───────────────────
-- own_update: 앱 사용처 없음(관리자 숨김 토글은 service-role). DROP 하면 UPDATE 정책이
--   없어 RLS 가 모든 클라이언트 UPDATE 를 거부한다.
DROP POLICY IF EXISTS "own_update" ON reviews;

-- own_insert: createReview 가 사용자 세션으로 INSERT 하므로 DROP 대신 교체한다.
--   /api/reviews 라우트의 검증(본인 주문 + status = 'DELIVERED')을 DB 에서도 강제한다.
--   서브쿼리는 호출자 권한으로 orders 를 읽는다 — orders_owner_select 가 본인 주문만 노출.
DROP POLICY IF EXISTS "own_insert" ON reviews;
DROP POLICY IF EXISTS reviews_owner_insert_verified ON reviews;
CREATE POLICY reviews_owner_insert_verified ON reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND order_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = reviews.order_id
         AND o.user_id = auth.uid()
         AND o.status = 'DELIVERED'
    )
  );

-- ─── 4. photos — 클라이언트 INSERT/UPDATE 차단 (P2-3) ─────────────────────────────
-- 업로드(createPhoto)는 service-role. 사용자 세션 쓰기 0건.
-- photos_owner_select / photos_owner_delete 는 유지.
DROP POLICY IF EXISTS photos_owner_insert ON photos;
DROP POLICY IF EXISTS photos_owner_update ON photos;

-- ─── 5. user_points_ledger — 주문별 거래유형 1회 (P1-1) ────────────────────────────
-- order_id 가 연결되는 원장 행은 주문당 유형별 최대 1회가 정상 흐름이다
-- (src/lib/db/points.ts 근거):
--   ACCRUAL    accruePointsForOrder — 구매확정 1회(기존 코드도 존재 시 skip)
--   ADJUSTMENT reversePointsForOrder 복원 다리 — 주문당 1회(기존 코드도 존재 시 skip)
--   REFUND     reversePointsForOrder 회수 다리 — 주문당 1회(기존 코드도 존재 시 skip)
--   REDEMPTION createOrder 는 order_id NULL 로 기록(주문 INSERT 전) — 인덱스 대상 밖.
--              향후 사후 링크가 생겨도 주문당 1회다.
--   주문 생성 실패 보상 ADJUSTMENT(refundRedeemedPoints)도 order_id NULL.
-- 따라서 유형을 좁히지 않고 order_id 가 있는 모든 행에 건다. 운영 수동 보정은
-- order_id NULL(설명란에 주문번호)로 기록한다.
-- 위반 시 apply_points_transaction 의 INSERT 가 23505 로 실패 → 같은 트랜잭션의
-- 잔액 UPDATE 도 롤백(원자) → 앱은 23505 를 "이미 처리됨"으로 취급한다.
CREATE UNIQUE INDEX IF NOT EXISTS user_points_ledger_order_type_uniq
  ON public.user_points_ledger (order_id, transaction_type)
  WHERE order_id IS NOT NULL;

-- ─── 6. apply_points_transaction — search_path 고정 (P2-6) ───────────────────────
-- 시그니처는 031 그대로. 본문은 public 테이블과 pg_catalog(now())만 참조한다.
ALTER FUNCTION public.apply_points_transaction(uuid, uuid, text, int, text)
  SET search_path = public;

-- ─── 적용 후 검증 쿼리 ──────────────────────────────────────────────────────────
--
--   -- (a) 정책 목록: orders 에 INSERT 정책 없음, reviews 는 public_read +
--   --     reviews_owner_insert_verified 만, photos 는 select/delete 만.
--   SELECT tablename, policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('orders', 'order_items', 'reviews', 'photos')
--    ORDER BY tablename, policyname;
--
--   -- (b) 테이블 권한: 모두 false 여야 한다(SELECT 는 true 유지).
--   SELECT r AS role, t AS tbl,
--          has_table_privilege(r, t, 'INSERT') AS ins,
--          has_table_privilege(r, t, 'UPDATE') AS upd,
--          has_table_privilege(r, t, 'DELETE') AS del,
--          has_table_privilege(r, t, 'SELECT') AS sel
--     FROM unnest(ARRAY['anon', 'authenticated']) AS r,
--          unnest(ARRAY['public.orders', 'public.order_items']) AS t;
--
--   -- (c) 함수 권한: authenticated/anon false, service_role true.
--   SELECT has_function_privilege('authenticated', 'public.next_order_no(date)', 'EXECUTE') AS auth_exec,
--          has_function_privilege('anon', 'public.next_order_no(date)', 'EXECUTE')          AS anon_exec,
--          has_function_privilege('service_role', 'public.next_order_no(date)', 'EXECUTE')  AS svc_exec;
--
--   -- (d) search_path 설정: 두 함수 모두 {search_path=public}.
--   SELECT p.proname, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('apply_points_transaction', 'next_order_no');
--
--   -- (e) 인덱스 존재(부분 UNIQUE).
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname = 'user_points_ledger_order_type_uniq';
--
-- ─── 롤백 메모(필요 시 수동 — 보안 회귀이므로 사유 기록 후에만) ────────────────────
--   §1  CREATE POLICY orders_owner_insert ON orders FOR INSERT TO authenticated
--         WITH CHECK (user_id = auth.uid());
--       GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.orders, public.order_items
--         TO anon, authenticated;   -- (Supabase 기본값 복원. P0 벡터 재개방 주의)
--   §2  014 본문으로 CREATE OR REPLACE(상한 검사 제거) +
--       GRANT EXECUTE ON FUNCTION public.next_order_no(date) TO authenticated;
--   §3  DROP POLICY IF EXISTS reviews_owner_insert_verified ON reviews;
--       CREATE POLICY "own_insert" ON reviews FOR INSERT WITH CHECK (user_id = auth.uid());
--       CREATE POLICY "own_update" ON reviews FOR UPDATE USING (user_id = auth.uid());
--   §4  012 의 photos_owner_insert / photos_owner_update 재생성.
--   §5  DROP INDEX IF EXISTS public.user_points_ledger_order_type_uniq;
--       (앱은 23505 처리와 사전 조회를 모두 갖고 있어 인덱스 없이도 동작)
--   §6  ALTER FUNCTION public.apply_points_transaction(uuid, uuid, text, int, text)
--         RESET search_path;
