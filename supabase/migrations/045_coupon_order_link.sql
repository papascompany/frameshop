-- 045_coupon_order_link.sql
--
-- 쿠폰 병렬 주문 우회 차단(보안 검토 P1-3) — 쿠폰 사용을 "주문"에 묶는다.
--
-- 배경(코드 근거, main fb0c1c4):
--   ① 쿠폰 소비는 결제 확정(PAID) 시점이다(src/lib/payment/confirm.ts settlePaidOrder).
--      createOrder 는 validateCoupon(읽기 전용)으로 할인을 "예약"만 하므로, 회원이 같은
--      쿠폰으로 CREATED 주문 N건을 먼저 만든 뒤 모두 결제하면 첫 건만 소비되고 나머지는
--      소비 실패(23505/EXHAUSTED)가 fail-open 되어 할인된 PAID 주문으로 남았다.
--      usage_limit 한정 쿠폰도 같은 방식으로 초과됐다(비회원 포함).
--   ② 042 의 coupon_redemptions 는 order_id 컬럼이 있지만 소비 경로가 쓰지 않았고,
--      취소 복원(releaseCoupon)은 coupon_id + user_id 로 무조건 DELETE 했다. 소비에 실패한
--      주문 B 를 취소하면 주문 A 의 사용 기록이 지워져 쿠폰이 다시 쓸 수 있게 됐다.
--
-- 이 파일이 하는 일:
--   §1 사전 점검 — 회원·쿠폰별 진행 중 주문이 이미 2건 이상이면 §5 인덱스를 만들 수 없으므로
--      아무것도 바꾸지 않고 예외로 멈춘다(정리 방법: docs/MIGRATIONS-APPLY.md 045 절).
--   §2 coupon_redemptions.order_no — 사용 원장 행에 주문번호 스냅샷(주문이 지워져 order_id 가
--      SET NULL 돼도 연결 근거가 남는다). 앱 feature-probe(isCouponOrderLedgerAvailable)의 대상.
--   §3 coupon_redemptions.user_id NULL 허용 — 비회원 사용도 원장에 주문 단위로 기록한다
--      (비회원 행은 order_no 필수 — CHECK). UNIQUE(coupon_id, user_id) 는 NULL 끼리 충돌하지
--      않으므로 회원 1인 1회 규칙은 그대로다.
--   §4 coupon_redemptions(order_id) 부분 UNIQUE — 주문당 사용 기록 최대 1행(소비 멱등·이중
--      차감 방지, 복원은 "그 주문이 실제로 소비했을 때만").
--   §5 orders(user_id, coupon_code) 부분 UNIQUE — 회원·쿠폰별 진행 중(CANCELLED/REFUNDED 가
--      아닌) 주문 최대 1건. 동시 createOrder 2건은 한쪽 INSERT 가 23505 로 실패한다
--      → 앱이 COUPON_ALREADY_USED 로 거부(경합 차단의 원자 근거).
--
-- 비파괴(non-destructive): 데이터 행 변경·삭제 없음. 컬럼 추가(NULL 허용), NOT NULL 해제,
--   CHECK(기존 행은 전부 user_id NOT NULL 이라 즉시 만족), 인덱스 추가만 한다.
-- 멱등(idempotent): ADD COLUMN IF NOT EXISTS, DROP NOT NULL(재실행 no-op), CHECK 는
--   pg_constraint 확인 후 추가, CREATE UNIQUE INDEX IF NOT EXISTS — 재실행 안전.
--
-- ★ 미적용 안전성(graceful, ADR-023/024): 적용하지 않아도 앱은 정상 동작한다.
--   - probe false → 원장 INSERT 에 order_no 를 넣지 않고(conditional-spread) 비회원 원장
--     기록을 생략한다. 회원 행의 order_id(042 컬럼)는 적용 여부와 무관하게 기록한다.
--   - §5 인덱스가 없을 때의 방어: validateCoupon 이 결제완료 계열 주문을 거부하고,
--     createOrder 가 같은 쿠폰의 이전 미결제 주문을 대체(CANCELLED)하며, confirmPayment 가
--     Toss 승인 직전 쿠폰을 다시 확인한다. 남는 틈은 "동시 주문 생성 + 동시 결제"뿐이다.
--   적용하면 probe 가 최대 60초 안에 켜진다(재배포 불필요).

-- ─── 1. 사전 점검: 회원·쿠폰별 진행 중 주문 중복 ─────────────────────────────────────
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT count(*) INTO dup_count
    FROM (
      SELECT 1
        FROM public.orders
       WHERE user_id IS NOT NULL
         AND coupon_code IS NOT NULL
         AND status NOT IN ('CANCELLED', 'REFUNDED')
       GROUP BY user_id, coupon_code
      HAVING count(*) > 1
    ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      '045 중단: 같은 회원·같은 쿠폰의 진행 중 주문이 2건 이상인 조합이 % 개 있습니다. '
      'docs/MIGRATIONS-APPLY.md 045 사전 점검 쿼리로 확인·정리한 뒤 다시 실행하세요.',
      dup_count;
  END IF;
END
$$;

-- ─── 2. coupon_redemptions.order_no — 주문번호 스냅샷 ───────────────────────────────
ALTER TABLE public.coupon_redemptions
  ADD COLUMN IF NOT EXISTS order_no text;

COMMENT ON COLUMN public.coupon_redemptions.order_no IS
  '이 사용을 일으킨 주문번호 스냅샷(045). 결제 확정(PAID) 소비 시 order_id 와 함께 기록. '
  '주문이 삭제돼 order_id 가 NULL 이 돼도 연결 근거로 남는다.';
COMMENT ON COLUMN public.coupon_redemptions.order_id IS
  '이 사용을 일으킨 주문(045 부터 소비 경로가 기록). 취소·환불 복원은 이 주문의 행만 지운다.';

-- ─── 3. 비회원 사용도 주문 단위로 기록 ─────────────────────────────────────────────
ALTER TABLE public.coupon_redemptions
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'coupon_redemptions_guest_has_order'
       AND conrelid = 'public.coupon_redemptions'::regclass
  ) THEN
    ALTER TABLE public.coupon_redemptions
      ADD CONSTRAINT coupon_redemptions_guest_has_order
      CHECK (user_id IS NOT NULL OR order_no IS NOT NULL);
  END IF;
END
$$;

COMMENT ON TABLE public.coupon_redemptions IS
  '쿠폰 사용 원장(ADR-026, 045). 회원 1인 1회 = UNIQUE(coupon_id, user_id). 045 부터 '
  '비회원 사용도 user_id NULL + order_no 로 기록하고, 주문당 최대 1행(order_id 부분 UNIQUE). '
  '취소·환불 복원은 그 주문의 행이 있을 때만 행 삭제 + used_count -1.';

-- ─── 4. 주문당 사용 기록 최대 1행 ──────────────────────────────────────────────────
-- 042 이전 소비분은 order_id 가 NULL 이라 부분 인덱스 대상이 아니다(충돌 없음).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_coupon_redemptions_order
  ON public.coupon_redemptions (order_id)
  WHERE order_id IS NOT NULL;

-- ─── 5. 회원·쿠폰별 진행 중 주문 최대 1건 ─────────────────────────────────────────
-- 상태 목록은 앱 ACTIVE_COUPON_ORDER_STATUSES(src/lib/db/coupons.ts)와 같은 계약이다.
-- CANCELLED/REFUNDED 로 전이하면 인덱스에서 빠져 같은 쿠폰으로 새 주문이 가능하다.
-- 인덱스 이름은 앱이 23505 를 COUPON_ALREADY_USED 로 판별하는 근거다(바꾸지 말 것).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_active_coupon_per_user
  ON public.orders (user_id, coupon_code)
  WHERE user_id IS NOT NULL
    AND coupon_code IS NOT NULL
    AND status NOT IN ('CANCELLED', 'REFUNDED');

-- ─── 검증 쿼리(적용 후 수동 실행) ──────────────────────────────────────────────────
--   -- (a) 컬럼·NULL 허용: order_no 1행, user_id is_nullable = YES.
--   SELECT column_name, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'coupon_redemptions'
--      AND column_name IN ('order_no', 'user_id');
--
--   -- (b) CHECK 존재: 1행.
--   SELECT conname FROM pg_constraint
--    WHERE conname = 'coupon_redemptions_guest_has_order';
--
--   -- (c) 인덱스 2개 존재(부분 UNIQUE).
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname IN ('uniq_coupon_redemptions_order', 'uniq_orders_active_coupon_per_user');
--
-- ─── 롤백 메모(필요 시 수동 — P1-3 경합 차단이 약해지므로 사유 기록 후에만) ──────────
--   §5  DROP INDEX IF EXISTS public.uniq_orders_active_coupon_per_user;
--   §4  DROP INDEX IF EXISTS public.uniq_coupon_redemptions_order;
--   §3  비회원 행(user_id IS NULL)이 생긴 뒤에는 NOT NULL 복원 불가 — 먼저 그 행을 정리해야
--       한다(정리하면 해당 비회원 주문의 취소 복원 근거가 사라짐).
--       ALTER TABLE public.coupon_redemptions DROP CONSTRAINT IF EXISTS coupon_redemptions_guest_has_order;
--   §2  컬럼은 남겨 두는 것을 권장(앱은 probe 로 판단 — 컬럼이 있으면 기록을 계속한다).
