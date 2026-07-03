# CONTEXT PACKAGE — FS-EC-02 (주문 서버 코어: 적립금 earn/redeem + 추가배송비)
작성: orchestrator @ 2026-07-03 · 수신 역할: backend-dev (배치 1)

## 1. Goal
createOrder에 적립금 redeem·제주/도서산간 surcharge·현금영수증 신청 저장을, confirmPurchase에 적립금 earn(1%)을 연결한다. **금전 경로 — 서버 권위 재계산, fail-closed, 마이그 미적용 graceful.**

## 2. Scope
### In-scope
- `src/lib/db/order.ts` (createOrder, confirmPurchase)
- `src/lib/db/points.ts` (신규)
- `src/lib/shipping/calc.ts` (필요 시 — surcharge는 별도 모듈이므로 최소 변경)
- 신규 테스트
### Out-of-scope (수정 금지)
- `src/types/**`, `src/lib/db/mappers.ts`, `src/lib/db/feature-probe.ts`, `src/lib/shipping/surcharge.ts` — FROZEN 소비만.
- `src/app/(shop)/**`(frontend-dev 병렬), `src/lib/payment/**`·`src/app/admin/**`(admin 에이전트 병렬), `src/app/api/account/**`(frontend-dev 소유).

## 3. 환경 사실
- TS strict, any 금지, select('*') 금지. 검증: `npx tsc --noEmit` · `npx eslint` · `npx vitest run`(기존 전부 green 유지).
- 031 RPC: `apply_points_transaction(p_user_id, p_order_id, p_type, p_delta, p_description) RETURNS int(new balance)` — SECURITY DEFINER, 서비스롤 전용. CHECK(points_balance>=0)가 이중지불 차단(초과 차감 시 RPC 에러).
- 031 주석 계약: **orders.total_price는 points_redeemed를 이미 차감한 최종 금액** → confirm.ts의 `order.totalPrice === input.amount` 검증 무변경 유지.
- 030 컬럼: orders.surcharge_fee(int, DEFAULT 0), shipping_methods.surcharge_fee_jeju/remote. **029~035+038/039 전부 미적용 가정** — orders INSERT에 신규 컬럼은 **값이 있을 때만 conditional-spread**(redeem>0 → points_redeemed, surcharge>0 → surcharge_fee, receipt 있음 → receipt_type/receipt_info). 0/NULL 기본이면 미포함 → 미적용 DB에서도 INSERT 성공.

## 4. 알려진 함정 (금전 경로 — 정독)
- **redeem 순서/보상**: (1) `isPointsAvailable()` false + redeemPoints>0 → `CreateOrderError('POINTS_UNAVAILABLE')` fail-closed(암묵 전액결제 금지). (2) redeemPoints > maxRedeemable(balance, payable) → `POINTS_INSUFFICIENT`. (3) RPC REDEMPTION 차감 → 이후 주문 INSERT 실패 시 **보상 트랜잭션**(ADJUSTMENT +delta, description='주문 생성 실패 환급') try/catch + 실패 시 구조화 로그(silent 금지). RPC 차감은 order INSERT **직전**에 수행해 보상 창 최소화.
- **surcharge**: `classifyZip(shipping.zip)` + shipping_methods의 surcharge 필드(mapper가 미적용 시 0 폴백)로 `calcSurcharge` — 서버 권위 계산. totalPrice = subtotal + shippingFee + surcharge − redeem. clientShippingFee 검증(SHIPPING_FEE_MISMATCH)은 기존 의미(기본 배송비)를 유지하되 surcharge 불일치도 동일 에러로. FE는 같은 순수 함수를 쓰므로 일치.
- **receipt**: input.receipt 존재 시 `isReceiptAvailable()` false → `RECEIPT_UNAVAILABLE` fail-closed(UI가 숨기지만 방어). 있으면 receipt_type/receipt_info conditional-spread 저장. 발급(Toss API)은 admin/payment 에이전트 소유 — 여기선 저장만.
- **earn(confirmPurchase)**: confirmed_at 갱신 성공 **후** `calcEarnPoints(totalPrice)`(1%, floor) ACCRUAL RPC + orders.points_accrued UPDATE(conditional — 031 미적용이면 skip). **멱등**: user_points_ledger에 해당 order_id·ACCRUAL 존재 시 skip(명시 컬럼 SELECT). earn 실패는 확정을 되돌리지 않음(graceful, 구조화 로그) — 적립은 후속 보정 가능.
- CANCELLED/REFUNDED 시 적립 회수·redeem 환급은 이번 범위 제외(관리자 수동 ADJUSTMENT) — open_questions에 명시만.
- `src/lib/db/points.ts`는 'server-only' import. 함수: `getPointsSummary(userId): {balance, available}`, `getPointsLedger(userId, limit)`, `redeemPoints(userId, orderId, amount)`, `refundRedeemedPoints(...)`(보상), `accruePointsForOrder(orderId, userId, totalPrice)`(멱등). 전부 probe-graceful.

## 5. 읽기 목록
1. `src/lib/db/order.ts` — createOrder 전문(검증→가격 재계산→INSERT 162~173 부근→items), confirmPurchase(~780-830)
2. `supabase/migrations/031_user_points.sql` · `030_orders_shipping_surcharge.sql`
3. `src/types/order.ts`(확장된 CreateOrderInput/에러코드) · `src/types/points.ts` · `src/lib/shipping/surcharge.ts` · `src/lib/db/feature-probe.ts`
4. `src/lib/payment/confirm.ts` — totalPrice===amount 검증 위치(무변경 확인용, 수정 금지)
5. 기존 테스트: tests/unit/modules/ 중 order/checkout 관련 — 패턴 준수

## 6. 계약
- CreateOrderInput.redeemPoints/receipt은 FROZEN 타입 그대로. 에러코드 POINTS_UNAVAILABLE/POINTS_INSUFFICIENT/RECEIPT_UNAVAILABLE 사용.
- 응답/기존 시그니처 무변경(옵션 추가만). 기존 단품 주문(redeem 0·mainland·no receipt)의 totalPrice 산식은 기존과 완전 동일해야 함(회귀 0).

## 7. Done Criteria
- [ ] tsc 0 · eslint 0 · vitest 전체 green + **신규 테스트 ≥6**: redeem 성공/불가(unavailable)/초과(insufficient)/보상 경로, surcharge jeju/remote/mainland·PICKUP 0, receipt fail-closed, earn 멱등
- [ ] 기존 주문 경로 회귀 0(기존 테스트 무수정 통과 — 수정 필요 시 사유 명시)
- [ ] 마이그 미적용 시나리오 테스트: redeem 미요청+mainland 주문이 신규 컬럼 없이 INSERT 성공(mock)
- [ ] diff In-scope 내

## 8. 핸드오프
마지막 응답 = 페이로드 JSON. 커밋 금지.
