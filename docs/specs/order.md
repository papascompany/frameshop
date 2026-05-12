# Module: Order (State Machine)

## Purpose
M-Order는 주문의 생성과 상태 전이를 책임지는 핵심 도메인 모듈이다. 상태 머신은 `CREATED → PAID → IN_PRODUCTION → SHIPPED → DELIVERED`의 정방향 흐름과 `CANCELLED`/`REFUNDED` 분기로 구성되며, 잘못된 전이(예: `DELIVERED → PAID`)는 차단된다. 주문 생성 시 일별 시퀀스 기반의 `order_no`(예: `20260512-0001`)를 발급하고, 각 cart 아이템을 `order_items.variant_snapshot`으로 동결하여 사후 가격/옵션 변경의 영향에서 격리한다. **배송 방법/배송비도 주문 시점에 `orders.shipping_method` + `orders.shipping_fee` 컬럼으로 스냅샷 동결한다(ADR-008).** 비회원 주문은 `userId=null`로 저장되고 `findOrderByGuest(orderNo, phone)`로 조회된다. UC-03 운영자 처리 흐름과 UC-05 비회원 분기를 지원한다.

## User Stories
- B2C 구매자로서, 체크아웃에서 결제 직전 주문이 생성되고 고유 주문번호가 부여되길 원한다.
- B2C 구매자로서, 결제 완료 후 주문 완료 페이지에서 주문번호와 예상 배송일을 확인하고 싶다.
- B2C 구매자(회원)로서, 마이페이지 주문 내역에서 상태(결제완료/제작중/배송중/배송완료)를 한눈에 보고 싶다.
- B2C 구매자(비회원)로서, 이메일 또는 주문번호 + 전화번호로 주문 상태를 조회하고 싶다.
- 운영자로서, 어드민에서 신규 주문을 보고 "제작 시작" 버튼을 누르면 상태가 IN_PRODUCTION으로 바뀌길 원한다.
- 운영자로서, 운송장 번호를 입력하면 상태가 SHIPPED로 바뀌고 사용자에게 알림이 가길 원한다.
- 운영자로서, 잘못된 상태 전이 시도(예: 배송 완료 후 다시 결제 완료로 되돌리기)는 시스템이 차단해주길 원한다.
- 운영자로서, 결제 실패/취소된 주문은 명시적으로 CANCELLED로 변경할 수 있길 원한다.

## Acceptance Criteria
1. **GIVEN** M-Checkout이 cart 3개 아이템, 배송지, `shippingMethod`를 전달한다 **WHEN** `createOrder({ cartItems, orderer, shipping, shippingMethod, userId? })`가 호출된다 **THEN** (a) 일별 시퀀스로 `order_no = '20260512-0001'` 생성, (b) 서버 측에서 `calculateShippingFee(shippingMethod, subtotal, settings)`로 배송비 재계산, (c) `orders` 레코드 insert (status=CREATED, `total_price = subtotal + shipping_fee`, `shipping_method`, `shipping_fee` 컬럼 포함), (d) 각 cart 아이템을 `order_items`로 snapshot insert (price/options/variant 정보 동결), (e) `Order` 객체 반환.
2. **GIVEN** 같은 날 이미 3건의 주문이 존재한다 **WHEN** 4번째 주문이 생성된다 **THEN** `order_no = '20260512-0004'` 형식으로 부여된다. 시퀀스는 동시성 안전(SELECT FOR UPDATE 또는 DB sequence).
3. **GIVEN** 주문 `O1`이 CREATED 상태다 **WHEN** `transitionTo(O1.id, 'PAID')`가 호출된다 **THEN** `orders.status = 'PAID'`, `paid_at = now()` 저장 후 성공 반환.
4. **GIVEN** 주문 `O1`이 DELIVERED 상태다 **WHEN** `transitionTo(O1.id, 'PAID')` 호출 **THEN** `InvalidStateTransitionError` throw + 상태 변경 없음. (PLAN.md UT-05, TDD 1순위)
5. **GIVEN** 허용 전이 표는 다음과 같다:
   - `CREATED → PAID | CANCELLED`
   - `PAID → IN_PRODUCTION | CANCELLED | REFUNDED`
   - `IN_PRODUCTION → SHIPPED | CANCELLED`
   - `SHIPPED → DELIVERED`
   - `DELIVERED → REFUNDED` (배송 후 환불은 운영자 수동만)
   - `CANCELLED`/`REFUNDED`: 종료 상태(전이 불가)
   **WHEN** 표에 없는 전이 시도 **THEN** throw + Sentry 경고.
6. **GIVEN** 동일 상태로 재전이(예: PAID → PAID) **WHEN** 호출된다 **THEN** idempotent 처리(no-op, 성공 반환, paid_at 갱신 안 함). 결제 웹훅 중복 도착 대비.
7. **GIVEN** 주문 `O1`이 SHIPPED로 전이된다 **WHEN** `transitionTo(O1.id, 'SHIPPED', { trackingNumber: 'CJ123', courier: 'CJ대한통운' })`가 호출된다 **THEN** `shipped_at = now()` + tracking 정보 저장 + 사용자 알림 트리거(Phase 1: 이메일만, Phase 2: SMS).
8. **GIVEN** 비회원 주문(userId=null)이 `O1`로 저장되어 있다 **WHEN** `findOrderByGuest('20260512-0001', '010-1234-5678')`이 호출된다 **THEN** orderer.phone과 일치하면 주문 반환, 불일치 또는 미존재면 null 반환(에러 메시지 동일하게 처리하여 enumeration 공격 방지).
9. **GIVEN** 사용자가 `getOrder('20260512-0001')`를 호출한다 **WHEN** 회원이고 본인 주문이거나 관리자다 **THEN** 주문 + `order_items` 전체 반환. 권한 없으면 null 또는 권한 에러.
10. **GIVEN** order_items 스냅샷에는 cart 시점 가격/옵션/cropTransform이 모두 포함된다 **WHEN** 이후 어드민이 variant 가격을 바꿔도 **THEN** 스냅샷은 영향받지 않아야 한다.
11. **GIVEN** 주문 생성 직전 cart에 variant `is_active=false` 또는 미존재 아이템이 있다 **WHEN** createOrder가 호출된다 **THEN** 검증 단계에서 throw + 어떤 항목이 문제인지 반환.
12. **GIVEN** transitionTo는 서버 전용 함수다 **WHEN** 클라이언트 컴포넌트에서 호출 시도 **THEN** `'server-only'` import로 빌드/런타임 에러. RLS 정책으로도 status 변경 차단(이중 안전망).
13. **GIVEN** 주문 생성 시점에 STANDARD `fee=3000`, `free_threshold=30000`이 활성이고 subtotal=25,000 **WHEN** `createOrder(..., shippingMethod='STANDARD')`가 호출된다 **THEN** `orders.shipping_method='STANDARD'`, `orders.shipping_fee=3000`, `orders.total_price=28000`이 저장되며 이후 관리자가 fee를 변경해도 이 주문의 스냅샷은 불변. (ADR-008)
14. **GIVEN** 주문이 `CREATED` 상태로 생성되었고 `total_price=28000` **WHEN** 결제 webhook이 도착한다 **THEN** M-Payment 검증 단계에서 `paymentAmount === orders.total_price (subtotal + shipping_fee)`를 확인하고, 불일치 시 PAID 전이 차단 + Sentry 경고. (ADR-008)
15. **GIVEN** `shippingMethod='PICKUP'`인 주문이 PAID로 전이된 후 IN_PRODUCTION을 거친다 **WHEN** 운영자가 완성 후 다음 단계로 전이한다 **THEN** Phase 1은 단순화하여 기존 SHIPPED 상태를 "픽업 가능"으로 재사용한다(운영자 UI 라벨만 "픽업 준비 완료"로 분기 표시 권장). Phase 2에서 `READY_FOR_PICKUP` 상태 신설 검토. (ADR-008)
16. **GIVEN** `createOrder` 호출 시 클라이언트가 보낸 `shippingFee`가 서버 재계산값과 다르다 **WHEN** 서버 검증한다 **THEN** 422 + `SHIPPING_FEE_MISMATCH` 에러 throw. 클라이언트 값은 신뢰하지 않고 항상 서버가 권위 있는 값.
17. **GIVEN** `createOrder` 호출 시 `shippingMethod`가 비활성(`is_active=false`)이거나 미존재 코드 **WHEN** 검증한다 **THEN** `INVALID_SHIPPING_METHOD` throw.

## Edge Cases
- **시퀀스 동시성:** 같은 millisecond에 2개 주문 생성 → DB sequence 또는 SELECT FOR UPDATE로 직렬화. 트랜잭션 외부에서 시퀀스 부여 X. 자율 결정: Postgres `BIGINT` advisory lock 또는 별도 `order_sequences(date date primary, seq int)` 테이블.
- **자정 경계:** 23:59:59에 생성된 주문과 00:00:00에 생성된 주문은 다른 일자 prefix를 갖는다. 시퀀스는 KST(`Asia/Seoul`) 기준.
- **transitionTo 권한:** 사용자 측에서 호출 가능한 전이는 없음(모든 전이는 서버/관리자). 클라이언트는 결제 SDK 콜백/관리자 UI 트리거를 통해 간접적으로 발생.
- **상태 + 사이드이펙트 동결 트랜잭션:** PAID 전이 시 `orders.paid_at` + `payment_id` + (Phase 1) 인쇄 큐 enqueue가 함께 발생. 모두 같은 트랜잭션 내에서 처리하거나, 실패 시 보상 로직(현재 Phase 1은 단순 트랜잭션으로 일관성 보장).
- **CANCELLED 후 결제 도착:** 사용자가 CANCELLED 처리 후 웹훅이 늦게 도착 → `CANCELLED → PAID` 차단 + Sentry 경고("late webhook for cancelled order"). 운영자 수동 검토.
- **REFUNDED 자동화:** Phase 1은 운영자가 수동으로 transitionTo(REFUNDED) 호출(토스 부분/전체 취소 API는 Phase 2). 환불 처리 별도 ADR 후보.
- **삭제 vs 상태:** 주문은 절대 hard delete 하지 않음. CANCELLED/REFUNDED로 상태만 변경. soft delete 컬럼 추가는 Phase 2.
- **order_no 보안:** 순차 번호라 추측 가능 → 비회원 조회는 phone과 함께 매칭 강제. 회원은 본인 + 관리자만(RLS).
- **다국가 시퀀스 충돌:** 단일 region이라 영향 없음.
- **printable file 생성 트리거:** PAID 전이 시 Edge Function으로 300dpi 인쇄용 PNG 생성 요청 (PLAN.md UC-01 17단계). Phase 1은 미리보기 PNG 재사용 OK(스펙 명시).
- **배송비 스냅샷 불변(ADR-008):** 주문 생성 후 관리자가 `shipping_methods.fee`를 변경하거나 퀵배송 가격을 인상해도 기존 주문의 `orders.shipping_fee`는 유지된다. 이미 결제된 주문의 환불 금액도 스냅샷 기준.
- **PICKUP 주문 분기(ADR-008):** Phase 1은 SHIPPED 상태를 "픽업 가능"으로 재사용 — 운영자 UI에서 `order.shipping_method === 'PICKUP'`이면 버튼 라벨/이메일 템플릿을 분기. Phase 2 `READY_FOR_PICKUP` 상태 신설 시 마이그레이션 필요.
- **QUICK 주문 가격 변경 후 결제 콜백:** 사용자가 checkout 진입 → 관리자가 QUICK 가격 변경 → 사용자 결제 → 주문은 사용자 진입 시점의 가격으로 생성됨(검증 시 그 시점 settings로 재계산 권장). Phase 1은 createOrder 시점 settings로 검증.
- **shipping_fee + subtotal 검증:** 결제 webhook 처리 시 `confirmedAmount === orders.total_price`만 검증하고, 내부적으로 `total_price = sum(items.price * qty) + shipping_fee`가 보장되어야 한다(createOrder가 책임).

## Out of Scope
- **부분 환불 / 부분 취소** — Phase 3.
- **배송 추적 자동화(택배사 API)** — Phase 3.
- **반품 처리** — Phase 3.
- **주문 합치기/분리** — Out of Scope.
- **반복 주문(구독)** — Out of Scope.
- **국제 배송 추적** — Phase 4.
- **300dpi 인쇄용 자동 재렌더링** — Phase 3 (Phase 1은 미리보기 PNG 재사용).
- **소프트 삭제 컬럼** — Phase 2.
- **상태 변경 이력 audit log** — Phase 2 (`order_status_history` 테이블 신설).
- **`READY_FOR_PICKUP` 별도 상태** — Phase 2 (ADR-008, Phase 1은 SHIPPED 재사용).
- **부분 환불 시 배송비 환불 정책** — Phase 3.

## Dependencies
- **Depends on:**
  - Supabase 테이블: `orders` (**ADR-008 컬럼 추가: `shipping_method` text, `shipping_fee` int**), `order_items` (PLAN.md §6, RLS: 본인+관리자만 SELECT, 생성 본인, 상태 변경 관리자)
  - **`shipping_methods` 테이블 (또는 `shipping_settings` 단일 row) — 배송비 재계산 시 읽기 (ADR-008)**
  - Supabase 시퀀스/잠금 메커니즘 (order_no 생성)
  - `src/types/order.ts` — `Order`, `OrderItem`, `OrderStatus`, `OrderStatusTransition`, **`ShippingMethod`(union: 'STANDARD'|'PICKUP'|'QUICK'), `ShippingMethodConfig`** (Architect 동결)
  - 이메일 알림 (Phase 1: Supabase Edge Function + Resend 또는 단순 SMTP — 자율 결정 검토)
  - `'server-only'` import (transitionTo 보호)
  - M-Cart — `clearCart`(주문 생성 후 호출)
  - M-Payment — paid_at, payment_id 동기화, `total_price` 검증
  - **M-Checkout 또는 M-Order 내부의 `calculateShippingFee` 순수 함수 (ADR-008) — Architect가 배치 결정**
- **Used by:**
  - M-Payment (`transitionTo(orderId, 'PAID')`)
  - M-Checkout (`createOrder` 위임)
  - M-Admin (`transitionTo`, `getOrder` 관리자 UI)
  - 페이지: `/order/complete/[orderNo]`, `/account/orders`, `/admin/orders/...`

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다. 상태 전이는 **순수 함수(룩업 테이블) + 부수효과 함수**로 분리한다.

- **OrderStatus union (PLAN.md 부록 A):**
  `'CREATED' | 'PAID' | 'IN_PRODUCTION' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED'`

- **ShippingMethod union (ADR-008):**
  `'STANDARD' | 'PICKUP' | 'QUICK'`

- **Order 객체 필드 추가 (ADR-008):**
  - `shippingMethod: ShippingMethod` — 주문 시점 선택값(스냅샷)
  - `shippingFee: number` — 주문 시점 계산 금액(스냅샷, 0 가능)
  - `totalPrice = sum(items.price * qty) + shippingFee`

- **전이 룩업 표 (TypeScript const map):**
  ```
  TRANSITIONS: Record<OrderStatus, OrderStatus[]>
  // 'CREATED': ['PAID', 'CANCELLED'],
  // 'PAID': ['IN_PRODUCTION', 'CANCELLED', 'REFUNDED'],
  // ...
  ```

- `canTransition(from: OrderStatus, to: OrderStatus): boolean`
  - **순수 함수, TDD 1순위 (PLAN.md UT-05).**
  - 동일 상태(`from === to`)는 true(idempotent).

- `createOrder(input: { cartItems: CartItem[]; orderer: Orderer; shipping: ShippingAddress; shippingMethod: ShippingMethod; userId?: string | null }): Promise<Order>`
  **(ADR-008로 시그니처 확장: `shippingMethod` 필수 추가)**
  - **동작:**
    1. cartItems 검증 (variant 활성 확인)
    2. **shippingMethod 검증 (`is_active=true` 확인) → 실패 시 INVALID_SHIPPING_METHOD**
    3. **`calculateShippingFee(shippingMethod, subtotal, settings)`로 배송비 서버 측 계산 (클라이언트 값 신뢰 X)**
    4. `order_no` 발급 (트랜잭션 내 시퀀스 lock)
    5. orders insert (status=CREATED, `total_price = subtotal + shipping_fee`, **`shipping_method`, `shipping_fee` 컬럼 포함**)
    6. order_items insert (variant_snapshot, photo_url, crop_transform, price, quantity)
    7. Order 반환
  - **에러:** `INVALID_VARIANT`, `EMPTY_CART`, `SEQUENCE_FAILED`, `INVALID_SHIPPING_METHOD`, `SHIPPING_FEE_MISMATCH`(선택적)

- `transitionTo(orderId: string, target: OrderStatus, meta?: TransitionMeta): Promise<Order>` (서버 전용, `'server-only'`)
  - **TransitionMeta:** `{ paymentKey?: string; trackingNumber?: string; courier?: string; reason?: string }`
  - **동작:**
    1. 현재 status 조회
    2. canTransition 검증 (실패 시 throw)
    3. status + 부수 컬럼(paid_at/shipped_at/payment_id) 업데이트 (트랜잭션)
    4. PAID 전이 시: M-Cart.clearCart(orderItem ids), 인쇄 큐 enqueue (Phase 1 skip), 알림 트리거
    5. SHIPPED 전이 시: 사용자 이메일 발송
    6. Order 반환

- `getOrder(orderNoOrId: string): Promise<OrderWithItems | null>`
  - **OrderWithItems:** `Order & { items: OrderItem[] }`
  - **권한:** RLS로 본인 + 관리자만. 비회원 케이스는 `findOrderByGuest` 별도 함수 사용.

- `findOrderByGuest(orderNo: string, phone: string): Promise<OrderWithItems | null>`
  - **동작:** orderNo + orderer.phone 모두 일치 시 반환. 시간 비교 일정(timing-safe)일 필요는 없으나 에러 메시지 동일화로 enumeration 방어.

- `generateOrderNo(today: Date, txClient): Promise<string>` (내부)
  - **TDD 1순위 후보:** 시퀀스 생성 로직 단위 테스트.
  - **형식:** `YYYYMMDD-NNNN` (KST 기준).

## Test Scenarios

### Unit (Vitest, TDD 1순위)
- `canTransition`: 모든 valid 전이 → true.
- `canTransition`: 모든 invalid 전이 → false (16x16 매트릭스 일부 샘플).
- `canTransition`: 동일 상태 idempotent → true.
- `canTransition`: 종료 상태(CANCELLED/REFUNDED)에서 다른 상태로 → false.
- `generateOrderNo`: 동일 날짜 연속 호출 → 0001, 0002, 0003 순차.
- `generateOrderNo`: 다음 날 호출 → 0001로 리셋.
- `createOrder`: 빈 cart → throw EMPTY_CART.
- `createOrder`: 비활성 variant 포함 cart → throw INVALID_VARIANT.
- `findOrderByGuest`: phone 불일치 → null (에러 메시지 노출 안 함).
- **`createOrder`: 비활성 shippingMethod → throw INVALID_SHIPPING_METHOD. (ADR-008)**
- **`createOrder`: subtotal=25000 + STANDARD → orders.shipping_fee=3000 + total_price=28000. (ADR-008)**
- **`createOrder`: subtotal=50000 + STANDARD + freeThreshold=30000 → shipping_fee=0 + total_price=50000.**
- **`createOrder`: PICKUP → shipping_fee=0 + 배송지 필드 미검증.**

### Integration (Testing Library + Supabase test client)
- `createOrder` → orders + order_items 양쪽에 행 생성, 카운트 일치.
- `transitionTo(CREATED → PAID)` → paid_at 세팅.
- `transitionTo(PAID → IN_PRODUCTION)` → 정상.
- `transitionTo(DELIVERED → PAID)` → InvalidStateTransitionError throw + DB 변경 없음.
- 동시 createOrder 100건 동시 호출 → 100개의 유니크 order_no 생성 (시퀀스 race condition 검증).
- 비회원 주문 생성 → userId=null로 저장, RLS로 익명 사용자 SELECT 차단되지만 findOrderByGuest는 service_role로 우회.

### E2E (Playwright)
- **E2E-Order-01:** 결제 완료 → 주문 완료 페이지에 주문번호 노출 (`20260512-XXXX` 형식).
- **E2E-Order-02:** 어드민이 "제작 시작" 클릭 → 상태가 IN_PRODUCTION으로 변경 + 사용자 마이페이지에 반영.
- **E2E-Order-03 (PLAN.md UC-03):** 어드민 운송장 입력 → SHIPPED → 사용자 이메일 발송 mock 호출.
- **E2E-Order-04 (비회원):** 주문번호 + 전화번호로 주문 조회 페이지 접근 → 정상 표시.
- **E2E-Order-05:** 잘못된 전화번호로 조회 → "주문을 찾을 수 없습니다"(enumeration 방어).
- **E2E-Order-06:** 같은 날 5개 주문 생성 → order_no가 -0001 ~ -0005 부여.
- **E2E-Order-07 (ADR-008):** STANDARD 선택 + 주문 생성 → 결제 완료 후 관리자가 fee를 인상 → 기존 주문 상세에 변경 전 가격 유지.
- **E2E-Order-08 (ADR-008):** PICKUP 주문 → IN_PRODUCTION → SHIPPED 전이 시 운영자 UI에 "픽업 준비 완료" 라벨로 분기 표시.
