# Module: Payment

## Purpose
M-Payment는 결제 단일 책임 모듈로 ADR-004(토스페이먼츠 단일 PG, Phase 1)에 따라 구현된다. 핵심 흐름: (1) M-Checkout으로부터 생성된 `CREATED` 주문을 받아 클라이언트 SDK로 `requestPayment` 호출, (2) 사용자가 PG 결제창에서 결제 완료/실패 → success/fail URL로 콜백 수신, (3) `/api/payment/confirm` 서버 라우트에서 토스 confirm API로 금액 위변조 검증 및 최종 승인, (4) `/api/webhook/payment` 라우트에서 서명 검증 후 비동기 결제 결과 처리, (5) 검증 통과 시 M-Order.transitionTo(PAID)로 위임. PLAN.md §14 리스크 "결제 위변조"에 대응하기 위해 **서버 측 금액 검증**, **웹훅 서명 검증**, **`SUPABASE_SERVICE_ROLE_KEY`/토스 시크릿 키의 서버 전용 보관**을 강제한다.

## User Stories
- B2C 구매자로서, 체크아웃에서 결제하기를 누르면 토스 결제창이 즉시 열리고 카드/카카오페이/네이버페이/계좌이체 등 다양한 수단으로 결제하고 싶다.
- B2C 구매자로서, 결제 완료 직후 주문 완료 페이지(주문번호 표시)로 자동 이동하길 원한다.
- B2C 구매자로서, 결제 실패 시 명확한 사유(잔액 부족/한도 초과/사용자 취소 등)와 함께 다시 시도할 수 있길 원한다.
- B2C 구매자로서, 결제창에서 뒤로가기를 눌렀을 때 주문이 잘못 진행되지 않고 다시 체크아웃으로 돌아가길 원한다.
- 운영자로서, 클라이언트에서 조작된 가격으로 결제가 승인되지 않길 원한다(서버 검증 필수).
- 운영자로서, 토스 웹훅이 도착했을 때 서명을 검증해 위조된 콜백을 차단하고 싶다.
- 운영자로서, 동일 주문번호로 결제가 두 번 승인되지 않길 원한다(idempotency).
- 운영자로서, 결제 실패/오류가 Sentry로 추적되어 빠르게 대응하고 싶다.

## Acceptance Criteria
1. **GIVEN** M-Order가 `CREATED` 상태 주문 `O1`(orderNo='20260512-0001', totalPrice=12000)을 생성했다 **WHEN** `requestPayment(order)`가 클라이언트에서 호출된다 **THEN** 토스 SDK `tossPayments.requestPayment(...)`이 트리거되어 결제창이 열리고, `orderId`(orderNo)와 `amount`가 SDK에 전달된다.
2. **GIVEN** 사용자가 결제를 완료한다 **WHEN** 토스가 success URL(`/payment/success?paymentKey=...&orderId=...&amount=...`)로 리다이렉트한다 **THEN** 클라이언트는 즉시 서버 라우트 `POST /api/payment/confirm`에 paymentKey/orderId/amount를 전달한다.
3. **GIVEN** `/api/payment/confirm`이 호출되었다 **WHEN** 서버가 처리한다 **THEN** (a) DB에서 `orders.order_no = orderId`인 주문 조회, (b) `orders.total_price === amount` 검증(불일치 시 즉시 reject), (c) 토스 `confirm API` 호출 (서버 시크릿 키 + Basic Auth), (d) 토스 응답 OK → M-Order.transitionTo(orderId, 'PAID') + paymentKey 저장, (e) 응답 결과를 클라이언트에 반환.
4. **GIVEN** 결제 금액 위변조 시도(`amount`가 DB와 불일치) **WHEN** confirm 라우트가 처리한다 **THEN** HTTP 400 + `PAYMENT_AMOUNT_MISMATCH` 코드 반환, 토스 confirm 호출 안 함, 주문 상태 변경 안 함, Sentry 경고 로그.
5. **GIVEN** 동일 orderId로 confirm이 두 번 호출된다 **WHEN** 두 번째 호출이 도착한다 **THEN** 주문 상태가 이미 `PAID`이면 idempotent 응답(이미 결제됨, 200 OK + 동일 결과). 토스 API는 중복 호출 안 함.
6. **GIVEN** 토스 confirm API가 실패 응답(잔액 부족 등)을 반환한다 **WHEN** 서버가 처리한다 **THEN** 주문 상태는 `CREATED` 유지, fail URL 라우팅 + 사용자에게 사유 표시.
7. **GIVEN** 토스 웹훅(`POST /api/webhook/payment`)이 도착한다 **WHEN** 서명 검증을 수행한다 **THEN** `Toss-Signature` 헤더(또는 토스 정의 헤더)와 webhook secret으로 HMAC 검증. 검증 실패 시 401 + 처리 중단.
8. **GIVEN** 검증된 웹훅이 처리된다 **WHEN** payload status가 `DONE`이고 주문이 아직 `CREATED`이면 **THEN** M-Order.transitionTo(PAID) 호출. 이미 PAID면 idempotent 처리. 다른 status(`CANCELED`/`PARTIAL_CANCELED`/`ABORTED` 등)는 대응되는 상태로 매핑.
9. **GIVEN** 사용자가 토스 결제창에서 취소를 누른다 **WHEN** fail URL로 리다이렉트된다 **THEN** 주문은 `CREATED` 상태 유지(자동 CANCELLED 처리 안 함, Phase 1). 사용자는 cart/checkout으로 돌아가 재시도 가능.
10. **GIVEN** 토스 시크릿 키와 webhook secret이 환경변수에 정의되어 있다 **WHEN** 클라이언트 번들을 검사한다 **THEN** 비밀 키가 클라이언트에 노출되지 않아야 한다(빌드 검증). `NEXT_PUBLIC_TOSS_CLIENT_KEY`만 노출 허용.
11. **GIVEN** 결제 처리 중 서버 에러 발생 **WHEN** confirm 또는 webhook 라우트가 throw 한다 **THEN** Sentry로 상세 에러(주문번호, paymentKey, 사유) 기록 + 클라이언트에는 일반화된 에러 메시지만 노출.
12. **GIVEN** 비회원 주문이 결제된다 **WHEN** webhook이 처리한다 **THEN** 정상 처리되어야 한다(`userId IS NULL` 케이스 RLS 우회 필요 — service_role_key 사용).

## Edge Cases
- **시크릿 키 노출 방지:** `SUPABASE_SERVICE_ROLE_KEY`, `TOSS_SECRET_KEY`, `TOSS_WEBHOOK_SECRET`은 **반드시 `process.env.*`로 서버 라우트에서만 읽기**. 어떤 클라이언트 컴포넌트에도 직접 import 금지. `.env.local.example`에 placeholder만 기록.
- **이중 결제 방어:** 같은 paymentKey가 두 번 confirm 시도 → DB unique constraint(`orders.payment_id`) + 응용 레벨 idempotent 처리.
- **금액 변경 후 결제:** 결제창 열린 동안 어드민이 가격을 바꿔도, requestPayment에 보낸 amount와 confirm 시 amount가 일치하면 통과. DB의 `orders.total_price`는 주문 생성 시점 동결되어 있어야 함(M-Order 책임).
- **웹훅 재시도:** 토스가 같은 이벤트를 여러 번 보내도 idempotent. 처리 완료된 paymentKey는 `payment_events` 테이블(자율 결정: 추가 검토)로 dedup.
- **순서 역전:** success URL 리다이렉트와 webhook이 동시 도착할 수 있음 → 두 경로 모두 같은 transitionTo(PAID)를 호출하되, M-Order가 중복 전이를 무시.
- **타이머/타임아웃:** confirm API 호출은 10초 타임아웃. 실패 시 사용자에게 "잠시 후 다시 시도" 안내 + 백그라운드에서 토스 조회 API로 상태 재확인(Phase 2).
- **다른 PG 대비:** Phase 1은 토스 단일이지만 인터페이스를 `PaymentAdapter`로 추상화하여 Phase 3 포트원 통합 시 다형성 보장.
- **테스트 환경:** 토스 test secret key로 e2e 진행. Playwright는 결제창 자동화 어려우므로 mock 모드(클라이언트 SDK를 직접 mock) 사용.
- **PCI/개인정보:** 카드번호/비밀번호는 절대 서버 통과 X. 토스 SDK가 PG 직접 처리. 우리는 paymentKey만 보관.
- **금액 0원 주문:** 0원 주문은 결제 SDK 거부 가능 → 무료 시제품/쿠폰 100% 적용 케이스는 Phase 3에서 별도 처리.
- **자율 결정 (payment_events 테이블):** 웹훅 dedup 및 감사 추적을 위해 `payment_events`(paymentKey UNIQUE, raw payload jsonb, received_at) 테이블 추가를 Architect에게 제안 — ADR 후보.

## Out of Scope
- **포트원/다중 PG** — Phase 3.
- **결제수단 별 분기 UI** — 토스 SDK가 통합 처리, 별도 UI 불필요.
- **부분 환불** — Phase 3.
- **간편결제 토큰 저장(원클릭 결제)** — Phase 3.
- **할부/무이자** — 토스 SDK 기본 제공으로 위임.
- **결제 통계/대시보드** — Phase 3 (운영 대시보드).
- **포인트/쿠폰 적용** — Phase 3.
- **결제 SDK 자체 추상화(어댑터 패턴)** — Phase 1은 단일 PG, Phase 3에서 패턴화.

## Dependencies
- **Depends on:**
  - **토스페이먼츠 v2 SDK** (`@tosspayments/payment-sdk` 또는 v2 latest, 클라이언트)
  - 토스 confirm API (`https://api.tosspayments.com/v1/payments/confirm`)
  - 환경변수:
    - `NEXT_PUBLIC_TOSS_CLIENT_KEY` (클라이언트, 공개 OK)
    - `TOSS_SECRET_KEY` (서버 전용)
    - `TOSS_WEBHOOK_SECRET` (서버 전용)
    - `SUPABASE_SERVICE_ROLE_KEY` (서버 전용, webhook RLS 우회)
  - M-Order — `transitionTo(orderId, state)`, `getOrder(orderNo)`
  - Sentry (에러 로깅)
  - 신규 테이블(자율 결정): `payment_events`
- **Used by:**
  - M-Checkout — submit 후 `requestPayment(order)` 호출
  - 페이지: `app/(shop)/payment/success`, `/payment/fail`, `/order/complete/[orderNo]`
  - Route Handlers: `app/api/payment/confirm/route.ts`, `app/api/webhook/payment/route.ts`

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다. **시크릿은 서버 전용임을 타입 수준으로 강제**(서버 모듈은 `'server-only'` import).

- `requestPayment(order: { orderNo: string; totalPrice: number; orderName: string; customerName: string; customerEmail: string; successUrl: string; failUrl: string }): Promise<void>` (클라이언트)
  - **동작:** 토스 SDK `tossPayments.requestPayment('카드', { ... })` 호출. 결제창 모달 표시. SDK가 성공 시 successUrl로 자동 라우팅.

- `confirmPayment(input: { paymentKey: string; orderId: string; amount: number }): Promise<ConfirmResult>` (서버, `app/api/payment/confirm/route.ts`)
  - **ConfirmResult:** `{ ok: true; order: Order } | { ok: false; code: 'AMOUNT_MISMATCH'|'ORDER_NOT_FOUND'|'TOSS_REJECTED'|'ALREADY_PAID'; message: string }`
  - **동작 순서:**
    1. orderId로 주문 조회 → 미존재 시 ORDER_NOT_FOUND
    2. 이미 PAID면 ALREADY_PAID (idempotent 200)
    3. `orders.total_price !== amount` → AMOUNT_MISMATCH
    4. 토스 confirm API 호출 (Basic Auth: `Buffer.from(TOSS_SECRET_KEY + ':').toString('base64')`)
    5. 토스 응답 OK → DB transaction으로 paymentKey 저장 + M-Order.transitionTo(PAID)
    6. Sentry 결과 로그

- `verifyWebhook(payload: unknown, signature: string): { valid: boolean; event?: WebhookEvent }` (서버)
  - **동작:** HMAC-SHA256(`TOSS_WEBHOOK_SECRET`, raw body) === signature 비교 (상세 알고리즘은 토스 문서 기준).
  - **TDD 1순위 (PLAN.md UT 추가): payment signature verification.**

- `handleWebhook(payload: WebhookEvent): Promise<void>` (서버, `app/api/webhook/payment/route.ts`)
  - **동작:**
    1. `payment_events` 테이블에서 paymentKey 중복 체크 (있으면 200 즉시 반환)
    2. payload.status → OrderStatus 매핑 (`DONE` → PAID, `CANCELED` → CANCELLED, `ABORTED` → CANCELLED, 기타는 로그만)
    3. M-Order.transitionTo 호출
    4. `payment_events` 레코드 insert (raw payload 보관)

- `tossClient` (서버 헬퍼, `lib/payment/toss.ts`)
  - `'server-only'` import 강제.
  - `confirm`, `cancel`, `getPayment` 메서드 wrap.

- 상수: `MAX_PAYMENT_RETRY_SECONDS = 600` (결제창 열린 후 최대 10분 안에 confirm 도착해야 함; Phase 1 안내만, Phase 2 강제).

## Test Scenarios

### Unit (Vitest, TDD 1순위)
- `verifyWebhook` 정상 서명 → `{ valid: true }`. (PLAN.md TDD 1순위)
- `verifyWebhook` 잘못된 서명 → `{ valid: false }`.
- `verifyWebhook` raw body 변조 → `{ valid: false }`.
- 금액 매칭 검증 함수: `confirmPayment` 내부에서 amount mismatch 시 즉시 reject (mock으로).
- idempotency: 이미 PAID 주문에 대한 confirm 호출 → 토스 API 호출 안 됨.
- 상태 매핑: `DONE` → PAID, `CANCELED` → CANCELLED 매핑 표 테스트.
- 토스 API 실패 응답 시 주문 상태 변경 안 됨.

### Integration (Testing Library + MSW)
- `/api/payment/confirm` 라우트: 정상 입력 → 200 + order 반환.
- `/api/payment/confirm`: amount mismatch → 400 + 코드 반환 + 토스 API mock 미호출 검증.
- `/api/webhook/payment`: 유효 서명 + 신규 paymentKey → M-Order.transitionTo(PAID) 호출.
- `/api/webhook/payment`: 중복 paymentKey → 토스 처리 skip, 200 응답.
- `/api/webhook/payment`: 무효 서명 → 401 + 처리 중단.

### E2E (Playwright)
- **E2E-Payment-01 (mock):** checkout submit → 토스 SDK mock에서 success 시뮬레이션 → /payment/success → /order/complete/<orderNo> 도달.
- **E2E-Payment-02:** SDK mock에서 fail 시뮬레이션 → /payment/fail → 재시도 안내.
- **E2E-Payment-03:** 결제 성공 후 cart가 비워짐(M-Cart.clearCart 호출 검증).
- **E2E-Payment-04 (PLAN.md E2E-06):** 결제 실패 시 주문 상태가 CREATED로 유지되고 사용자가 재시도 가능.
- **E2E-Payment-05:** 빌드 산출물에 `TOSS_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY` 문자열이 포함되지 않음 (grep 검증).
