# 마이그레이션 적용 가이드 (CTO 수동 적용)

> **누가/어디서**: FrameShop DB 는 `yohan73@gmail.com` 계정 소유라 Claude 의 Supabase MCP
> (papascompany 계정)로는 접근 불가. **CTO 가 Supabase 대시보드 → SQL Editor 에서 직접 실행**해야 한다.
> **안전성**: 아래 마이그레이션은 전부 **비파괴(non-destructive) + 멱등(idempotent)** — `IF NOT EXISTS` /
> `OR REPLACE` / `DROP POLICY IF EXISTS` 로 작성돼 **여러 번 실행해도 안전**하다. 적용 중에도 앱은 정상.
> 최종 갱신: 2026-06-24.

---

## 적용 순서 (번호 오름차순, 한 번에 또는 나눠서)

각 SQL 본문은 `supabase/migrations/<파일>` 에 있다. SQL Editor 에 파일 내용을 그대로 붙여넣고 실행하면 된다.
**029 → 035 오름차순**으로 적용한다(034/035 의 일부가 029~033 와 같은 테이블을 건드리므로 순서 권장).

| # | 파일 | 활성화되는 것 | 지금 적용? |
|---|---|---|---|
| 029 | `029_orders_order_memo.sql` | 관리자 주문 메모(Phase A) | ✅ 권장 — 라이브 기능 활성화 |
| 030 | `030_orders_shipping_surcharge.sql` | 제주/도서산간 추가배송비 컬럼 | ⏸ 선택 — 비파괴·안전하나 미연결(Phase C) |
| 031 | `031_user_points.sql` | 적립금 테이블/RPC | ⏸ 선택 — 비파괴·안전하나 미연결(B-2) |
| 032 | `032_user_addresses.sql` | 회원 주소록(Phase B-1) | ✅ 권장 — 라이브 기능 활성화 |
| 033 | `033_orders_confirmed_at.sql` | 구매확정(Phase B-1) | ✅ 권장 — 라이브 기능 활성화 |
| 034 | `034_products_product_type.sql` | 확장형 기반: `products.product_type` + `cart_projects` | 🟦 선택 — 적용해도 앱 무변화(P1 대비) |
| 035 | `035_cart_items_project_link.sql` | 확장형 기반: cart/order 프로젝트 링크 컬럼 | 🟦 선택 — 적용해도 앱 무변화(P1 대비) |

- **✅ 029/032/033**: 코드는 이미 라이브이고 DB 컬럼/테이블만 없어서 해당 기능이 비활성 상태다. 적용하면 곧바로
  동작한다. **이번에 먼저 적용 권장.**
- **⏸ 030/031**: 비파괴라 적용해도 무해하지만, 이를 쓰는 코드(Phase B-2 적립금·Phase C 추가배송비)가 아직
  없어 적용해도 사용자 변화는 없다. 해당 Phase 착수 때 적용해도 된다.
- **🟦 034/035**: 확장형 상품 P0 기반. **앱은 적용 여부와 무관하게 현행 단품 경로 100% 유지**되도록
  격리/폴백 설계됨(ADR-023). 즉 지금 적용해도 화면 변화는 없고, **P1 확장형 편집기 착수 전까지 적용하면
  된다**. 미리 적용해두면 P1 배포가 매끄럽다.

> 권장 묶음: **이번 세션엔 029/032/033 만 적용**(라이브 기능 즉시 활성화). 034/035 는 P1 직전에 적용.
> 단, 한 번에 029~035 를 다 적용해도 전부 안전하다(앱 무변화 보장).

---

## 적용 후 검증 쿼리 (SQL Editor 에서 실행)

### 029 — 주문 메모
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name='order_memo';   -- 1행이면 OK
```
앱 검증: 관리자 주문 상세에서 메모 저장 → 새로고침 후 유지되는지.

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
앱 검증 불필요(현행 무변화). 적용 후에도 카탈로그/주문/인쇄가 동일해야 정상.

### 035 — 확장형 기반 (2)
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='cart_items'  AND column_name IN ('project_id','project_seq','orientation');   -- 3행
SELECT column_name FROM information_schema.columns
 WHERE table_name='order_items' AND column_name IN ('project_group_id','project_seq','orientation'); -- 3행
```
앱 검증 불필요(현행 무변화).

---

## 롤백 메모

전부 추가 전용이라 롤백이 필요하면 신규 컬럼/테이블만 DROP 하면 된다(데이터 손실 없음):
```sql
-- 예: 034/035 되돌리기 (필요 시에만)
ALTER TABLE order_items DROP COLUMN IF EXISTS project_group_id, DROP COLUMN IF EXISTS project_seq, DROP COLUMN IF EXISTS orientation;
ALTER TABLE cart_items  DROP COLUMN IF EXISTS project_id, DROP COLUMN IF EXISTS project_seq, DROP COLUMN IF EXISTS orientation;
DROP TABLE IF EXISTS cart_projects;
ALTER TABLE products DROP COLUMN IF EXISTS product_type;
```
029/032/033 은 이미 라이브 기능이 의존하므로 적용 후 롤백 비권장.
