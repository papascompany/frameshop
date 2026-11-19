-- 046_reviews_one_per_order.sql
--
-- 리뷰 주문당 1개 — DB 제약(보안 검토 후속, 2026-11-19).
--
-- 배경(코드 근거): POST /api/reviews 는 getOrderReview(orderId) 사전 조회로 중복을 막지만
--   check-then-insert 라, 같은 주문에 대한 동시 요청 두 개가 함께 사전 조회를 통과하면
--   리뷰가 2개 생긴다(평점 조작·중복 노출). 044 의 reviews_owner_insert_verified 정책은
--   "본인·배송완료 주문"만 검사하고 개수는 보지 않는다.
--
-- 이 파일이 하는 일:
--   §1 사전 점검 — 같은 주문에 리뷰가 이미 2개 이상이면 인덱스를 만들 수 없으므로 아무것도
--      바꾸지 않고 예외로 멈춘다(정리: 중복 중 하나를 어드민에서 숨기고 운영 판단으로 삭제).
--   §2 reviews(order_id) 부분 UNIQUE — 주문당 리뷰 최대 1행. order_id 가 NULL 인 행(주문 삭제로
--      SET NULL 된 과거 리뷰)은 대상이 아니다.
--
-- 앱 짝: src/lib/db/reviews.ts createReview 가 23505 를 DuplicateReviewError 로 바꾸고,
--   라우트가 409 "이미 리뷰를 작성하셨습니다." 로 응답한다(사전 조회와 같은 메시지).
--   인덱스가 없어도 앱은 기존처럼 동작한다(사전 조회만으로 막음 — 동시 요청 틈만 남음).
--
-- 비파괴(non-destructive): 데이터 행 변경·삭제 없음. 인덱스 추가만.
-- 멱등(idempotent): CREATE UNIQUE INDEX IF NOT EXISTS — 재실행 안전.
-- 기존 028 의 reviews_order_idx(비UNIQUE)는 그대로 둔다(이름·용도 유지, 비파괴 원칙).

-- ─── 1. 사전 점검: 주문당 리뷰 중복 ────────────────────────────────────────────────
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT count(*) INTO dup_count
    FROM (
      SELECT 1
        FROM public.reviews
       WHERE order_id IS NOT NULL
       GROUP BY order_id
      HAVING count(*) > 1
    ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      '046 중단: 리뷰가 2개 이상인 주문이 % 건 있습니다. '
      'docs/MIGRATIONS-APPLY.md 046 사전 점검 쿼리로 확인·정리한 뒤 다시 실행하세요.',
      dup_count;
  END IF;
END
$$;

-- ─── 2. 주문당 리뷰 최대 1행 ──────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS reviews_order_uniq
  ON public.reviews (order_id)
  WHERE order_id IS NOT NULL;

-- ─── 검증 쿼리(적용 후 수동 실행) ──────────────────────────────────────────────────
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname = 'public' AND indexname = 'reviews_order_uniq';   -- 1행
--
-- ─── 롤백 메모(필요 시 수동 — 중복 리뷰 경합이 다시 열린다) ──────────────────────────
--   DROP INDEX IF EXISTS public.reviews_order_uniq;
