# 마이그레이션 적용 가이드 (CTO 수동 적용)

> **누가/어디서**: FrameShop DB 는 `yohan73@gmail.com` 계정 소유라 Claude 의 Supabase MCP
> (papascompany 계정)로는 접근 불가. **CTO 가 Supabase 대시보드 → SQL Editor 에서 직접 실행**해야 한다.
> **안전성**: 아래 마이그레이션은 전부 **비파괴(non-destructive) + 멱등(idempotent)** — `IF NOT EXISTS` /
> `OR REPLACE` / `DROP POLICY IF EXISTS` 로 작성돼 **여러 번 실행해도 안전**하다. 적용 중에도 앱은 정상.
> 최종 갱신: 2026-07-16 (FS-X 웨이브 — 036/037/040/041/042 "2차 적용 대기" 절 신설).
>
> **✅ 적용 완료 (2026-07-06):** 029~035 + 038/039 전부 프로덕션 DB(yohan73/frameshop)에 적용됨 —
> CTO 브라우저 로그인 후 SQL Editor에서 통합 실행, 검증 쿼리 24행 일치, 런타임 자동 활성화 확증
> (체크아웃 probe `points/receipt/surcharge` 전부 true). 이 문서는 이후 신규 마이그레이션(036/037 등)
> 적용 시의 절차 참고용으로 유지한다. 상세: `shared/BLOCKERS.md` BL-010(Resolved).

---

## ★ 2차 적용 대기 — 036/037/040/041/042 (2026-07-16 작성, FS-X 웨이브)

> FS-X 웨이브(브랜치 `feat/p2-p3-commerce`, ADR-026)에서 작성된 5본. 전부 **비파괴 + 멱등**.
> **미적용 상태에서도 앱 정상** — feature-probe 게이트가 해당 기능 UI 를 숨긴다(42P01/42703 노출 금지).
> **적용 시점: 이 웨이브 머지·배포 후 브라우저 세션으로 적용(CTO 승인済).** 적용하면 코드 배포 없이
> 자동 활성화(probe TTL 60초). **036 → 042 오름차순** 적용 권장(036 이 034 의 cart_projects 에 FK 를 건다).

| # | 파일 | 활성화되는 것 | 지금 적용? |
|---|---|---|---|
| 036 | `036_set_templates.sql` | 세트 프리셋: 어드민 세트템플릿 탭(슬롯 빌더+미니맵)·카탈로그 세트 노출 + `cart_projects.set_template_id` FK 이행(034 예고) | ⏳ 배포 후 — probe `isSetTemplatesAvailable` |
| 037 | `037_bundle_rules.sql` | 구성 검증/가격 규칙 폼(어드민 구성규칙 탭). **세트할인 createOrder 적용은 ADR-026 보류** — 금전 경로 무영향 | ⏳ 배포 후 — probe `isBundleRulesAvailable` |
| 040 | `040_inquiries.sql` | 1:1 문의: account 작성/목록 + admin 답변 + 답변 이메일. 비밀글 고정(공개 정책 없음) | ⏳ 배포 후 — probe `isInquiriesAvailable` |
| 041 | `041_wishlists.sql` | 위시리스트(로그인 전용): 하트 아일랜드 + `/account/wishlist` | ⏳ 배포 후 — probe `isWishlistAvailable` |
| 042 | `042_coupons.sql` | 쿠폰: 체크아웃 쿠폰 카드·`/api/coupons/validate`·createOrder 쿠폰 경로(원자 소비+보상)·admin 쿠폰 CRUD + orders 스냅샷 2컬럼 | ⏳ 배포 후 — probe `isCouponsAvailable` |

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
