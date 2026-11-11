# 마이그레이션 적용 가이드 (CTO 수동 적용)

> **누가/어디서**: FrameShop DB 는 `yohan73@gmail.com` 계정 소유라 Claude 의 Supabase MCP
> (papascompany 계정)로는 접근 불가. **CTO 가 Supabase 대시보드 → SQL Editor 에서 직접 실행**해야 한다.
> **안전성**: 아래 마이그레이션은 전부 **비파괴(non-destructive) + 멱등(idempotent)** — `IF NOT EXISTS` /
> `OR REPLACE` / `DROP POLICY IF EXISTS` 로 작성돼 **여러 번 실행해도 안전**하다. 적용 중에도 앱은 정상.
> 최종 갱신: 2026-11-12 (045 쿠폰 주문 연결 작성 — 권장, 043·044·045 적용 대기 — 001~042 는 전부 적용됨. 044 는 **런칭 전 필수**).
>
> **✅ 1차 적용 완료 (2026-07-06):** 029~035 + 038/039 전부 프로덕션 DB(yohan73/frameshop)에 적용됨 —
> CTO 브라우저 로그인 후 SQL Editor에서 통합 실행, 검증 쿼리 24행 일치, 런타임 자동 활성화 확증
> (체크아웃 probe `points/receipt/surcharge` 전부 true). 상세: `shared/BLOCKERS.md` BL-010(Resolved).
> **✅ 2차 적용 완료 (2026-08-01):** 036/037/040/041/042 — 아래 절 참조. 이 문서는 이후 신규
> 마이그레이션 적용 시의 절차 참고용으로 유지한다.

---

## ★★ 런칭 전 필수 — 044 (보안 하드닝, 2026-11-11 작성)

> **정식 오픈·Toss 키 입력 전에 반드시 적용.** 정식 오픈 전 보안 검토의 P0(로그인 사용자가 PostgREST
> 로 `orders` 를 직접 INSERT → 적립금 무한 발행)를 닫는다. 코드만 배포해서는 막히지 않는다.
> **비파괴 + 멱등**: 데이터 행 변경·삭제 없음. 정책 DROP/CREATE·권한 REVOKE·함수 교체(시그니처 동일)·
> 인덱스 추가만. 재실행 안전.

| # | 파일 | 바뀌는 것 |
|---|---|---|
| 044 | `044_security_hardening.sql` | ① orders/order_items 클라이언트 쓰기 차단(정책 DROP + anon·authenticated INSERT/UPDATE/DELETE/TRUNCATE 회수) ② `next_order_no` 서비스롤 전용 + 일 9999 초과 시 예외 ③ reviews: 본인 숨김 해제 정책 DROP, 작성은 "본인·배송완료 주문"만 허용하는 정책으로 교체 ④ photos 클라이언트 INSERT/UPDATE 정책 DROP ⑤ 적립금 원장 `(order_id, transaction_type)` 부분 UNIQUE 인덱스 ⑥ `apply_points_transaction` search_path 고정 |

### 적용 순서

1. **사전 점검(결과 0행이어야 함)** — 0행이 아니면 이중 적립/복원이 이미 있었던 것. 적용을 멈추고 보고:
   ```sql
   SELECT order_id, transaction_type, count(*) AS n
     FROM public.user_points_ledger
    WHERE order_id IS NOT NULL
    GROUP BY order_id, transaction_type
   HAVING count(*) > 1;
   ```
2. **위조 주문 감사(셋 다 0행이어야 함)** — 044 는 *앞으로의* 직접 INSERT 만 막는다. 044 이전에 PostgREST 로
   들어간 위조 행이 있으면 취소·스윕 만료·구매확정으로 여전히 적립금이 나간다(최종 리뷰 지적). 행이 나오면
   적용을 멈추고 보고 — 임의 삭제 금지(해당 주문 CANCELLED 정리 + 적립금 ADJUSTMENT 보정은 검토 후):
   ```sql
   -- 2-a. 적립금 사용 스냅샷은 있는데 대응하는 REDEMPTION 원장이 없는 주문
   --      (createOrder 는 description '주문 {order_no} 적립금 사용' 으로 원장을 남긴다)
   SELECT o.order_no, o.user_id, o.status, o.points_redeemed, o.created_at
     FROM public.orders o
    WHERE COALESCE(o.points_redeemed, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.user_points_ledger l
         WHERE l.user_id = o.user_id
           AND l.transaction_type = 'REDEMPTION'
           AND l.points_delta = -o.points_redeemed
           AND l.description LIKE '%' || o.order_no || '%'
      );

   -- 2-b. 결제 이후 상태인데 결제 이벤트가 없는 주문 (결제 없이 PAID·DELIVERED 로 위조)
   SELECT o.order_no, o.status, o.total_price, o.payment_id, o.created_at
     FROM public.orders o
    WHERE o.status IN ('PAID', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'REFUNDED')
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_events pe
         WHERE pe.order_id = o.id OR pe.order_no = o.order_no
      );

   -- 2-c. 잔액과 원장 합계가 어긋나는 회원 + 2-d. 미래 날짜 주문번호(번호 선점)
   SELECT p.user_id, p.points_balance, COALESCE(SUM(l.points_delta), 0) AS ledger_sum
     FROM public.user_profiles p
     LEFT JOIN public.user_points_ledger l ON l.user_id = p.user_id
    GROUP BY p.user_id, p.points_balance
   HAVING p.points_balance <> COALESCE(SUM(l.points_delta), 0);

   SELECT order_no, status, created_at FROM public.orders
    WHERE left(order_no, 8) > to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD');
   ```
3. `044_security_hardening.sql` 전체를 **`BEGIN;` … `COMMIT;` 으로 감싸 한 번에** 실행(파일에 명시적
   트랜잭션이 없다 — 중간 실패 시 일부만 적용되는 것을 막는다).
4. 파일 하단 주석의 검증 쿼리 (a)~(e) 실행 — 기대값: orders 에 INSERT 정책 없음 · anon/authenticated 의
   orders/order_items INSERT·UPDATE·DELETE 모두 false(SELECT true) · `next_order_no` 실행권 service_role 만 ·
   두 함수 `search_path=public` · 인덱스 `user_points_ledger_order_type_uniq` 존재.
5. 앱 스모크: 로그인 → 마이페이지 주문 목록 표시(SELECT 유지 확인) · 배송완료 주문 리뷰 작성 성공.
6. `/admin/launch` 는 044 적용 여부를 표시하지 않는다 — 위 4번 검증 결과로 확인한다.

롤백 메모는 파일 하단 주석 참고(보안 회귀이므로 사유 기록 후에만).

## ★ 적용 권장 — 045 (쿠폰 주문 연결 · 병렬 주문 차단, 2026-11-12 작성)

> 보안 검토 **P1-3**(쿠폰 1인 1회·전체 한도를 병렬 주문으로 우회) 후속. **비파괴 + 멱등**: 데이터 행
> 변경·삭제 없음. 컬럼 추가(NULL 허용)·NOT NULL 해제·CHECK·부분 UNIQUE 인덱스 2개만. 재실행 안전.
> **미적용이어도 앱은 정상**(probe `isCouponOrderLedgerAvailable` + conditional-spread) — 앱 방어선
> (결제완료 계열 주문 거부 · 이전 미결제 주문 대체 · Toss 승인 직전 쿠폰 확인)은 이미 동작한다.
> 적용하면 남은 틈인 **"동시 주문 생성 + 동시 결제"** 와 비회원 취소 복원 정밀도가 닫힌다.
> 적용 후 최대 60초 안에 재배포 없이 켜진다. 044 와 순서 무관(044 를 먼저 적용해도 된다).

| # | 파일 | 바뀌는 것 |
|---|---|---|
| 045 | `045_coupon_order_link.sql` | ① 사전 점검 — 회원·쿠폰별 진행 중 주문 2건 이상이면 아무것도 바꾸지 않고 예외로 중단 ② `coupon_redemptions.order_no` 추가(사용을 일으킨 주문번호 스냅샷, probe 대상) ③ `coupon_redemptions.user_id` NULL 허용 + CHECK `coupon_redemptions_guest_has_order`(비회원 사용도 주문 단위 기록) ④ `uniq_coupon_redemptions_order` — 주문당 사용 기록 1행(부분 UNIQUE) ⑤ `uniq_orders_active_coupon_per_user` — 회원·쿠폰별 진행 중(CANCELLED/REFUNDED 아님) 주문 1건(부분 UNIQUE, 앱이 23505 를 COUPON_ALREADY_USED 로 판별 — 이름 변경 금지) |

### 적용 순서

1. **사전 점검(결과 0행이어야 함)** — 0행이 아니면 같은 회원이 같은 쿠폰으로 진행 중 주문을 여러 건
   가진 것(⑤ 인덱스 생성 불가 — 파일이 스스로 예외로 멈춘다):
   ```sql
   SELECT user_id, coupon_code, count(*) AS n,
          array_agg(order_no ORDER BY created_at) AS order_nos,
          array_agg(status   ORDER BY created_at) AS statuses
     FROM public.orders
    WHERE user_id IS NOT NULL AND coupon_code IS NOT NULL
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY user_id, coupon_code
   HAVING count(*) > 1;
   ```
   행이 나오면: **CREATED(미결제)** 주문은 `/admin/orders` 에서 취소(적립금 자동 복원)한다. **결제완료 계열이
   2건 이상**이면 P1-3 우회가 실제로 일어난 것 — 적용을 멈추고 보고(할인 회수·환불은 운영 판단).
2. `045_coupon_order_link.sql` 전체 실행.
3. 파일 하단 주석의 검증 쿼리 (a)~(c) — 기대값: `order_no` 컬럼 존재 · `user_id` is_nullable = YES ·
   CHECK `coupon_redemptions_guest_has_order` 1행 · 인덱스 `uniq_coupon_redemptions_order`·
   `uniq_orders_active_coupon_per_user` 2행.
4. 앱 확인(60초 후): `/admin/launch`(런칭 준비 점검) 마이그레이션 항목에서 045 가 적용으로 표시.
   쿠폰 실결제 스모크 때 `coupon_redemptions` 새 행에 `order_id`·`order_no` 가 채워지는지 확인.

### 미적용 상태의 동작(배포~적용 창)

- 회원 사용 기록에는 `order_id`(042 컬럼)를 이미 기록 — 취소 복원은 **그 주문이 소비했을 때만** 동작한다.
- 비회원 사용은 기록되지 않아 취소 시 기존 동작(used_count −1)을 유지한다(정밀 판정은 045 이후).
- 같은 회원의 **동시** 주문 생성은 둘 다 성공할 수 있고, 두 결제가 **동시에** 승인되면 둘 다 할인된다
  (순차 결제는 승인 직전 확인이 막는다). → 045 적용 전까지는 고액·한정 쿠폰 발행 자제(기존 운영 완화책) 유지.

### 롤백 메모 (045)

파일 하단 주석 참고. 인덱스 DROP 은 P1-3 경합 차단을 약화시키므로 사유 기록 후에만. 비회원 행
(`user_id IS NULL`)이 생긴 뒤에는 NOT NULL 복원 불가(그 행을 지우면 해당 주문의 복원 근거가 사라짐).

## ★ 3차 적용 대기 — 043 (결제 웹훅 정합성, 2026-10-28 작성)

> **비파괴 + 멱등**(신규 테이블만). **미적용이어도 웹훅 상태 반영은 정상** — 감사 기록만 생략된다
> (probe `isWebhookAuditAvailable`). 적용하면 최대 60초 안에 재배포 없이 기록이 켜진다.

| # | 파일 | 활성화되는 것 | 적용 |
|---|---|---|---|
| 043 | `043_payment_webhook_events.sql` | Toss 웹훅 수신 감사 로그 — 같은 결제의 후속 상태(CANCELED·PARTIAL_CANCELED 등)까지 전부 기록(결제 조회로 확인한 `toss_status` + 처리 `outcome`). RLS on, 정책 없음(service-role 전용) | ⏳ 대기 |

### 검증 쿼리 (043)

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_name = 'payment_webhook_events')                         AS table_exists,   -- 1
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'payment_webhook_events')                            AS rls_enabled,    -- true
  (SELECT count(*) FROM pg_policies
     WHERE tablename = 'payment_webhook_events')                          AS policy_count;   -- 0
```

### 롤백 메모 (043)

`DROP TABLE IF EXISTS payment_webhook_events;` — 감사 기록만 사라지고 앱 동작은 그대로(probe false).

---

## ★ 2차 적용 완료 — 036/037/040/041/042 (2026-08-01 프로덕션 적용)

> FS-X 웨이브(브랜치 `feat/p2-p3-commerce`, ADR-026)에서 작성된 5본. 전부 **비파괴 + 멱등**.
> **✅ 2026-08-01 적용 완료** — CTO 브라우저 로그인(yohan73) 후 Claude 가 SQL Editor 에서
> 036→042 통합 실행(1회, "Success. No rows returned"). **검증 쿼리 21행 전부 일치**(테이블 6 ·
> FK 1 · orders 컬럼 2 · RLS 6 전부 true · 정책 6). **런타임 자동 활성화 확증** — 프로덕션
> `/checkout` RSC flight 에서 probe `coupons:true`(+기존 points/receipt/surcharge true), 재배포 0.

| # | 파일 | 활성화되는 것 | 적용 |
|---|---|---|---|
| 036 | `036_set_templates.sql` | 세트 프리셋: 어드민 세트템플릿 탭(슬롯 빌더+미니맵)·카탈로그 세트 노출 + `cart_projects.set_template_id` FK 이행(034 예고) | ✅ 2026-08-01 — probe `isSetTemplatesAvailable` |
| 037 | `037_bundle_rules.sql` | 구성 검증/가격 규칙 폼(어드민 구성규칙 탭). **세트할인 createOrder 적용은 ADR-026 보류** — 금전 경로 무영향 | ✅ 2026-08-01 — probe `isBundleRulesAvailable` |
| 040 | `040_inquiries.sql` | 1:1 문의: account 작성/목록 + admin 답변 + 답변 이메일. 비밀글 고정(공개 정책 없음) | ✅ 2026-08-01 — probe `isInquiriesAvailable` |
| 041 | `041_wishlists.sql` | 위시리스트(로그인 전용): 하트 아일랜드 + `/account/wishlist` | ✅ 2026-08-01 — probe `isWishlistAvailable` |
| 042 | `042_coupons.sql` | 쿠폰: 체크아웃 쿠폰 카드·`/api/coupons/validate`·createOrder 쿠폰 경로(원자 소비+보상)·admin 쿠폰 CRUD + orders 스냅샷 2컬럼 | ✅ 2026-08-01 — probe `isCouponsAvailable`, 체크아웃 RSC `coupons:true` 확증 |

### 적용 후 검증 쿼리 (2차 — SQL Editor 에서 실행)

#### 036 — 세트 템플릿
```sql
SELECT to_regclass('public.set_templates');                          -- set_templates 면 OK
SELECT conname FROM pg_constraint
 WHERE conname='cart_projects_set_template_fk'
   AND conrelid='public.cart_projects'::regclass;                    -- 1행(FK 이행 확인)
```
앱 검증(probe TTL 60초 후): admin 상품 워크스페이스(extended 상품)에 세트템플릿 탭 노출 →
mm 폼 저장 + WallCanvas 미니맵 프리뷰 렌더.

#### 037 — 구성 규칙
```sql
SELECT to_regclass('public.bundle_rules');                           -- bundle_rules 면 OK
```
앱 검증(probe TTL 60초 후): admin 상품 워크스페이스(extended 상품)에 구성규칙 탭 노출 → 폼 저장.
가격 전략(sum 외)은 저장만 되고 주문 금전 경로에는 미적용(ADR-026 보류)이 정상.

#### 040 — 1:1 문의
```sql
SELECT to_regclass('public.inquiries');                              -- inquiries 면 OK
```
앱 검증(probe TTL 60초 후): `/account/inquiries` 작성폼 노출 → 접수(OPEN) → admin/inquiries 에서
답변 저장 시 ANSWERED + `answered_at` 기록 + contact_email 로 답변 메일 발송.

#### 041 — 위시리스트
```sql
SELECT to_regclass('public.wishlists');                              -- wishlists 면 OK
```
앱 검증(probe TTL 60초 후): 로그인 상태에서 카탈로그/상세 하트 노출·토글(멱등) →
`/account/wishlist` 목록 반영. 비로그인은 하트 미노출(로그인 전용)이 정상.

#### 042 — 쿠폰
```sql
SELECT to_regclass('public.coupons');                                -- coupons 면 OK
SELECT to_regclass('public.coupon_redemptions');                     -- coupon_redemptions 면 OK
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders'
   AND column_name IN ('coupon_code','coupon_discount');             -- 2행
```
앱 검증(probe TTL 60초 후): admin/coupons 에서 쿠폰 생성 → 체크아웃 쿠폰 카드에 코드 입력 →
할인 반영(쿠폰→적립금 순서, net totalPrice) → 주문 스냅샷(coupon_code/coupon_discount) 확인.
회원 재사용 시 `COUPON_ALREADY_USED`, 한도 소진 시 `COUPON_EXHAUSTED`(422) 거부.

### 롤백 메모 (2차)

전부 추가 전용 — 필요 시 신규 컬럼/테이블만 DROP 하면 된다(DROP 후에도 probe 가 기능을 다시 숨겨 앱 정상):
```sql
-- 예: 036/037/040/041/042 되돌리기 (필요 시에만 — 역순 권장)
ALTER TABLE orders DROP COLUMN IF EXISTS coupon_code, DROP COLUMN IF EXISTS coupon_discount;
DROP TABLE IF EXISTS coupon_redemptions;
DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS wishlists;
DROP TABLE IF EXISTS inquiries;
DROP TABLE IF EXISTS bundle_rules;
ALTER TABLE cart_projects DROP CONSTRAINT IF EXISTS cart_projects_set_template_fk;  -- 036 FK 선해제
DROP TABLE IF EXISTS set_templates;
```
적용 후 데이터(세트 프리셋·문의·위시·쿠폰 원장/주문 스냅샷)가 쌓이기 시작하면 롤백 비권장.

---

## 적용 순서 (번호 오름차순, 한 번에 또는 나눠서)

각 SQL 본문은 `supabase/migrations/<파일>` 에 있다. SQL Editor 에 파일 내용을 그대로 붙여넣고 실행하면 된다.
**029 → 039 오름차순**으로 적용한다(같은 테이블을 건드리는 마이그레이션이 있어 순서 권장).
036/037 은 이 절(1차) 시점엔 결번이었으나 **FS-X 웨이브(2026-07-16)에서 040/041/042 와 함께 작성 완료**
— 위 "2차 적용 대기" 절 참조. 아래 표(1차분)는 적용 완료 이력이다.

| # | 파일 | 활성화되는 것 | 지금 적용? |
|---|---|---|---|
| 029 | `029_orders_order_memo.sql` | 관리자 주문 메모(Phase A) | ✅ 권장 — 라이브 기능 활성화 |
| 030 | `030_orders_shipping_surcharge.sql` | 제주/도서산간 추가배송비(EC 웨이브 연결됨) | ✅ 권장 — 적용 시 자동 활성화 |
| 031 | `031_user_points.sql` | 적립금 earn/redeem + `/account/points`(EC 웨이브 연결됨) | ✅ 권장 — 적용 시 자동 활성화 |
| 032 | `032_user_addresses.sql` | 회원 주소록(Phase B-1) | ✅ 권장 — 라이브 기능 활성화 |
| 033 | `033_orders_confirmed_at.sql` | 구매확정(Phase B-1) + 적립 earn 게이트 | ✅ 권장 — 라이브 기능 활성화 |
| 034 | `034_products_product_type.sql` | 확장형 기반: `products.product_type` + `cart_projects` | ✅ 권장 — **P1 라이브**, 적용 시 로그인 묶음 카트 동기화 자동 활성화(probe) |
| 035 | `035_cart_items_project_link.sql` | 확장형 기반: cart/order 프로젝트 링크 컬럼 | ✅ 권장 — **P1 라이브**, 적용 시 로그인 묶음 카트 동기화 자동 활성화(probe) |
| 038 | `038_orders_refunded_amount.sql` | 부분환불 누적액(EC 웨이브) | ✅ 권장 — 적용 시 자동 활성화 |
| 039 | `039_orders_cash_receipt.sql` | 현금영수증 신청·Toss 발급(EC 웨이브) | ✅ 권장 — 적용 시 자동 활성화 |

- **✅ 029/032/033**: 코드는 이미 라이브이고 DB 컬럼/테이블만 없어서 해당 기능이 비활성 상태다. 적용하면 곧바로
  동작한다.
- **✅ 030/031/038/039 (EC 웨이브, 2026-07-03)**: 이를 쓰는 코드가 이 웨이브에서 연결됐다.
  **적용해도/안 해도 앱 무변화(무해)** — 미적용이면 feature-probe 가 해당 기능(추가배송비/적립금/부분환불/
  현금영수증)을 UI·로직에서 숨기고, 적용하면 **코드 배포 없이 자동 활성화**(probe 캐시 TTL 60초 내).
  orders INSERT 는 conditional-spread 라 미적용 DB 에서도 에러(42703)가 없다. ADR-024 참조.
  - **031 적용 시**: 적립금이 자동 활성화 — 체크아웃 적립금 사용(redeem), 구매확정 시 1% 적립(earn),
    마이페이지 `/account/points` 잔액·내역. earn 은 구매확정(033 `confirmed_at`) 게이트와 연동되므로
    031 과 033 을 함께 적용하는 것을 권장.
  - **038 적용 시**: 관리자 부분환불(Toss cancelAmount + 누적 추적) 자동 활성화.
  - **039 적용 시**: 체크아웃 현금영수증 신청 캡처 + Toss 발급 훅(현금성 결제만) 자동 활성화.
- **✅ 034/035 (확장형 P1 라이브, 2026-07-06)**: 확장형 편집기 P1 이 라이브되어 이를 쓰는 코드가
  연결됐다(ADR-025). **미적용이어도 앱 정상** — 익명 확장형 플로우는 034/035 무관 완전 동작(localStorage),
  로그인 카트 동기화만 probe 폴백(평면 저장, 묶음 정보는 주문 스냅샷 jsonb 에 보존). **적용 시 로그인
  묶음 카트 동기화(cart_projects 헤더 + cart_items project 컬럼)가 코드 배포 없이 자동 활성화**
  (probe TTL 60초). 현행 단품(베이직) 경로는 적용 여부와 무관하게 100% 유지(ADR-023).

> 권장 묶음: **029~039 전부 적용**(라이브/EC/확장형 P1 기능 전부 활성화). P1 라이브로 034/035 도
> 권장으로 격상됐다. 한 번에 다 적용해도 전부 안전하다(비파괴·멱등, 미적용 상태에서도 앱 정상).

---

## 적용 후 검증 쿼리 (SQL Editor 에서 실행)

### 029 — 주문 메모
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name='order_memo';   -- 1행이면 OK
```
앱 검증: 관리자 주문 상세에서 메모 저장 → 새로고침 후 유지되는지.

### 030 — 제주/도서산간 추가배송비
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name='surcharge_fee';                                -- 1행
SELECT column_name FROM information_schema.columns
 WHERE table_name='shipping_methods'
   AND column_name IN ('surcharge_fee_jeju','surcharge_fee_remote');                       -- 2행
```
앱 검증(probe TTL 60초 후): 체크아웃에서 제주(63xxx)/도서산간 우편번호 입력 시 추가배송비 표시.

### 031 — 적립금
```sql
SELECT to_regclass('public.user_profiles');                 -- user_profiles 면 OK
SELECT to_regclass('public.user_points_ledger');            -- user_points_ledger 면 OK
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name IN ('points_redeemed','points_accrued');       -- 2행
SELECT proname FROM pg_proc WHERE proname='apply_points_transaction';                     -- 1행
```
앱 검증(probe TTL 60초 후): 로그인 → `/account/points` 잔액/내역 표시, 체크아웃에서 적립금 사용,
구매확정 시 1% 적립(033 `confirmed_at` 함께 적용 권장).

### 032 — 주소록
```sql
SELECT to_regclass('public.user_addresses');               -- user_addresses 면 OK
```
앱 검증: 로그인 후 체크아웃에서 배송지 저장 → 다음 주문 때 불러오기.

### 033 — 구매확정
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name='confirmed_at';  -- 1행이면 OK
```
앱 검증: 배송완료(DELIVERED) 주문에서 "구매확정" → confirmed_at 기록.

### 034 — 확장형 기반 (1)
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='products' AND column_name='product_type';        -- 1행
SELECT to_regclass('public.cart_projects');                          -- cart_projects
SELECT count(*) FROM products WHERE product_type='single';           -- 기존 상품 전부 single 백필
```
앱 검증(probe TTL 60초 후): 로그인 상태에서 확장형(`mode=multi`) 묶음 담기 → 새로고침 후 카트 유지
(cart_projects 헤더 동기화). 베이직 경로(카탈로그/주문/인쇄)는 적용 전후 동일해야 정상.

### 035 — 확장형 기반 (2)
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='cart_items'  AND column_name IN ('project_id','project_seq','orientation');   -- 3행
SELECT column_name FROM information_schema.columns
 WHERE table_name='order_items' AND column_name IN ('project_group_id','project_seq','orientation'); -- 3행
```
앱 검증(probe TTL 60초 후): 로그인 묶음 담기 시 cart_items 에 project_id/project_seq/orientation 저장,
주문 생성 시 order_items 컬럼에도 그룹 동결(미적용에서는 주문 스냅샷 jsonb 에만 보존 — 손실 없음).

### 038 — 부분환불 누적액
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name='refunded_amount';   -- 1행이면 OK
```
앱 검증(probe TTL 60초 후): 관리자 주문 상세에 부분환불 입력 노출 → 금액 환불 시 누적액 반영.
미적용이어도 앱 무변화(feature-probe 가 기능을 숨김) — 적용 시 자동 활성화.

### 039 — 현금영수증
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders'
   AND column_name IN ('receipt_type','receipt_info','receipt_url','receipt_issued_at');  -- 4행
```
앱 검증(probe TTL 60초 후): 체크아웃에 현금영수증 신청(소득공제/지출증빙) 노출 → 주문에 스냅샷 저장.
Toss 발급은 **현금성 결제만** 훅 동작(카드는 N/A). 미적용이어도 앱 무변화 — 적용 시 자동 활성화.

---

## 롤백 메모

전부 추가 전용이라 롤백이 필요하면 신규 컬럼/테이블만 DROP 하면 된다(데이터 손실 없음):
```sql
-- 예: 034/035 되돌리기 (필요 시에만)
ALTER TABLE order_items DROP COLUMN IF EXISTS project_group_id, DROP COLUMN IF EXISTS project_seq, DROP COLUMN IF EXISTS orientation;
ALTER TABLE cart_items  DROP COLUMN IF EXISTS project_id, DROP COLUMN IF EXISTS project_seq, DROP COLUMN IF EXISTS orientation;
DROP TABLE IF EXISTS cart_projects;
ALTER TABLE products DROP COLUMN IF EXISTS product_type;

-- 예: 038/039 되돌리기 (필요 시에만 — DROP 후에도 feature-probe 가 기능을 다시 숨겨 앱은 정상)
ALTER TABLE orders DROP COLUMN IF EXISTS refunded_amount;
ALTER TABLE orders DROP COLUMN IF EXISTS receipt_type, DROP COLUMN IF EXISTS receipt_info,
  DROP COLUMN IF EXISTS receipt_url, DROP COLUMN IF EXISTS receipt_issued_at;
```
029/032/033 은 이미 라이브 기능이 의존하므로 적용 후 롤백 비권장. 030/031/038/039 도 적용 후
데이터(환불 누적액·적립 원장·영수증 스냅샷)가 쌓이기 시작하면 롤백 비권장.
