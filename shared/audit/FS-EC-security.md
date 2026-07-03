# FS-EC Security & Secrets Review — feat/ecommerce-basics-photowall

- Reviewer: security-reviewer (adversarial — 반려 결함 우선)
- Date: 2026-07-03
- Scope: git diff HEAD + 41 untracked files (B-2 적립금/부분환불/현금영수증, 030 배송비, 법적고지, admin 통계/ZIP, 포토월 /wall)
- Tooling: `tsc --noEmit` PASS(exit 0) · `vitest run`(wave 13 files) 120/120 PASS · `gitleaks detect --no-git` (src/supabase/shared) NO LEAKS
- Verdict: **NO-GO** — P0-1(결제 정확성) 미해결. 031/039 적용 시 즉시 발현. P0 수정 후 GO.

---

## P0

### P0-1 — /api/orders 브리지가 redeemPoints·receipt 를 createOrder 로 전달하지 않음 (결제 금액 표시≠청구, 유상기능 무력화)
- **Severity:** P0 (payment correctness)
- **File:** `src/app/api/orders/route.ts:84-98` (input 객체 수동 구성 — redeemPoints/receipt 누락). 이 파일은 이번 웨이브에서 **미변경**(git diff HEAD 빈결과).
- **Evidence chain:**
  - Client 는 보냄: `src/app/(shop)/checkout/CheckoutClient.tsx:327-328` (`redeemPoints`, `receipt`).
  - Schema 는 받음: `src/types/order.ts` `createOrderInputSchema` (redeemPoints/receipt optional), route `bodySchema`(route.ts:34-36)로 파싱됨 → `parsed.data.redeemPoints/receipt` 존재.
  - createOrder 는 소비함: `src/lib/db/order.ts:160`(redeemRequested), `:195`(receipt).
  - 그러나 route 의 `const input: CreateOrderInput = {...}`(route.ts:84-98)에 두 필드가 **복사되지 않음** → 항상 `undefined` 로 유입.
  - Toss 청구액 = 서버 반환 `order.totalPrice`(CheckoutClient.tsx:350). redeem 이 드롭되면 totalPrice = 전액 payable.
- **Activation:** `features.points/receipt` 는 feature-probe(031/039)로 게이트(`checkout/page.tsx:24-25`). 현재 031/039 미적용이라 UI 숨김 → **잠복**. CTO 가 031/039(이 웨이브 산출물) 적용 즉시 발현.
- **Impact (발현 시):** ①고객이 요약카드의 할인총액(`payable − redeemApplied`)이 아닌 **전액**을 청구받음(표시≠청구, 전자상거래 표시의무 위반 소지). ②적립금이 **차감되지 않음**(썼다고 표시되나 잔액 그대로). ③현금영수증 신청이 **드롭**되어 세금 증빙(법정문서)이 발급되지 않음. 방향은 과소청구가 아니라 과대청구/기능누락 — 상점 손실은 없으나 소비자 피해.
- **Secondary:** route 의 에러 매핑(route.ts:104-111)이 신규 코드 `POINTS_UNAVAILABLE`/`POINTS_INSUFFICIENT`/`RECEIPT_UNAVAILABLE`(order.ts:262-268 정의)를 처리하지 않아 500 으로 샘.
- **Why tests missed it:** 유닛/통합 테스트는 `createOrder` 를 직접 호출(order-create-ec.test.ts)하고, /api/orders 경유 redeem/receipt 통합 테스트가 없음 → 120 PASS 여도 브리지 공백 미탐지.
- **Recommendation:** route input 에 `redeemPoints: parsed.data.redeemPoints`, `receipt: parsed.data.receipt ?? null` 전달 + 신규 3개 에러코드 422 매핑 추가. /api/orders 통합 테스트(redeem>0, receipt 신청)로 회귀 고정. **본 브리지 수정 전 031/039 적용 금지.**

---

## P1

### P1-1 — 환불/취소 경로가 적립금 원장을 되돌리지 않음 (적립 회수 누락 + 사용분 미복원)
- **Severity:** P1 (money-path correctness / abuse)
- **File:** `src/app/admin/orders/actions.ts` `fullRefund`(:239-278), `partialRefund`(:288-406); `src/lib/db/order.ts` `customerCancelOrder`(:849-916).
- **Issue:** `refundRedeemedPoints` 는 오직 createOrder 보상(order.ts:265)에서만 호출. 환불/취소 액션 어디에서도 (a)사용 적립금 복원, (b)적립 포인트 회수를 하지 않음. `accruePointsForOrder` 는 confirmPurchase(order.ts:983)에서 route 와 무관하게 **정상 동작**하므로, 031 적용 후 실제로 적립이 쌓인다.
- **Impact (031 적용 후):** ①남용 벡터 — 구매→배송완료→구매확정(1% 적립)→환불→적립 유지(반복 시 적립 파밍). ②고객 피해 — (P0-1 수정 후) 사용 적립금이 환불 시 복원되지 않아 소멸. 타입 주석(order.ts `pointsAccrued`="환불 시 회수 근거")이 존재하나 이를 소비하는 코드가 없음(불완전 구현).
- **Aggravating:** REDEMPTION 원장행이 `order_id=null`(order.ts:249)로 기록되어 주문과 결합되지 않음 → 회수 로직 작성 시 description 문자열 파싱 의존(취약).
- **Recommendation:** 환불(전액/부분 도달) 및 취소 시 원장 정합 로직 추가 — 사용분 ADJUSTMENT(+), 적립분 REFUND(−)를 멱등 키(order_id)로. REDEMPTION 을 order_id 결합으로 재기록하거나, 사후 링크 UPDATE.

---

## P2

### P2-1 — receipt_info(식별번호 PII, 휴대폰/사업자번호)가 마스킹 전 원문 그대로 클라이언트 props 로 직렬화
- **Severity:** P2 (PII minimization / defense-in-depth)
- **File:** `src/app/admin/orders/[id]/page.tsx:40-43`(전체 `order` 를 client comp 로 전달) → `AdminOrderDetailClient.tsx:341` `maskReceiptInfo` 는 **렌더 시점**에만 마스킹. 원문 `order.receiptInfo` 는 RSC/props 페이로드(페이지 소스·devtools·네트워크)에 노출. 동일 패턴: `getOrdersByUser`(order.ts:529) → `/account/orders`.
- **Root:** `mapOrder`(mappers.ts) `receiptInfo` + `getOrder` `select('*')` 가 원문을 항상 실어보냄.
- **Note:** confirm.ts 발급 훅은 식별번호를 로그에 남기지 않음(정상). 게스트 lookup 은 whitelisted projection 으로 receiptInfo 미포함(정상, `/api/orders/lookup/route.ts` 반환부).
- **Recommendation:** 서버에서 마스킹 후 전달하거나, 클라이언트로 넘기는 뷰모델에서 receiptInfo 원문 제외. orders RLS 가 receipt_info 를 소유자/관리자에게만 노출하는지 확인.

### P2-2 — ZIP 라우트가 print_file_url 을 host allowlist 없이 서버 fetch (SSRF 심층방어)
- **Severity:** P2 (low — 출처가 DB/렌더파이프라인이라 사용자입력 아님)
- **File:** `src/app/api/admin/orders/[id]/zip/route.ts:94` `fetch(item.printFileUrl)`.
- **Assessment:** printFileUrl 은 createOrder 가 null 로 넣고(order.ts:384) 렌더 파이프라인이 서버 생성 Storage URL 로 채움 — 사용자 조작 불가. requireAdmin 이중 게이트. 실질 위험 낮음. 다만 URL 이 손상되면 임의 호스트 fetch 가능.
- **Recommendation:** fetch 대상을 Supabase Storage origin 으로 제한(allowlist), 또는 서명 URL 재발급 경유.

### P2-3 — 현금영수증 식별번호 regex 가 숫자 0개(전부 하이픈) 입력 허용
- **Severity:** P2
- **File:** `src/types/order.ts` `cashReceiptRequestSchema`(regex `^[0-9-]+$`, min 8), `src/types/checkout.ts` `RECEIPT_INFO_REGEX`.
- **Issue:** `"--------"`(하이픈8) 통과. Toss 발급 시 거부(fail-closed, 로그, 주문 무영향)되고 maskReceiptInfo 는 digit 0 을 graceful 처리하나, 스키마 단계에서 최소 숫자 개수를 강제하지 않음.
- **Recommendation:** `.refine(v => v.replace(/-/g,'').length >= 8)` 등 최소 자릿수 검증 추가.

### P2-4 — 법적 SSOT 에 placeholder 값이 공개 페이지(/terms /privacy /Footer)로 노출
- **Severity:** P2 (법적 표기 정확성 — 보안 취약점 아님)
- **File:** `src/lib/legal/company.ts` — `email: 'help@...(확정 필요)'`, `hosting: 'AWS'`(실 인프라는 Vercel/Supabase — mapper/ADR 주석과 불일치), `mailOrderSalesNo`/`LEGAL_EFFECTIVE_DATE`/PRIVACY_PROCESSORS 다수 `(확정 필요)`. 사업자번호·특허번호는 실값이나 기존 Footer 에 이미 공개돼 있던 정보라 수용 가능.
- **Recommendation:** 공개 런칭 전 CTO 실값 확정. 전자상거래법 표기의무(통신판매신고번호·호스팅사업자 정확성) 충족 확인.

---

## Positive Findings (검증 통과)

- **도서산간 surcharge 우회 불가:** surcharge 는 배송 목적지인 `shipping.zip` 자체에서 파생(order.ts:136-138). 서버가 동일 순수함수로 재계산 후 `clientShippingFee` 비교(order.ts:145-153, SHIPPING_FEE_MISMATCH). clientShippingFee 생략 시에도 서버 계산분으로 청구 → 제주 배송받으며 육지요금 낼 방법 없음.
- **적립금 사용 안전장치:** 서버 권위 `maxRedeemable`+`POINTS_MIN_PAYABLE`(0원 결제 차단), 익명·미가용 fail-closed(order.ts:168-187), 차감 실패 시 주문 abort, 주문 INSERT/order_items 실패 시 보상 트랜잭션(order.ts:262-293), DB `CHECK(balance>=0)` 이중지불 가드. 음수/소수/Infinity/문자열 redeem 은 order.ts:161 + points.ts:165 + zod 로 차단.
- **부분환불 정합:** cancelAmount 서버검증(zod int positive + 잔여액 상한, actions.ts:303-331), Toss-우선 순서, 낙관적 잠금(`.eq('refunded_amount', prevRefunded)`, actions.ts:353), 기록 실패 시 은폐 없이 수동보정 안내(actions.ts:356-376). 과환불은 Toss 잔액이 백스톱.
- **결제 무결성 무훼손:** totalPrice 는 redeem 차감 후 net 저장(031) → confirm.ts `totalPrice===amount` 검증 불변(confirm.ts:44), Toss 응답 필드 재검증(confirm.ts:75-107), payment_events UNIQUE 락(confirm.ts:115) 그대로.
- **현금영수증 훅 격리:** fire-and-forget, 멱등 `.is('receipt_issued_at', null)` 가드(confirm.ts:237), 식별번호 미로깅(confirm.ts:265).
- **클라이언트 경계:** 신규 서버 모듈 전부 `server-only`(points/admin-stats/wall/feature-probe/points-data/route 확인). client comp 에 SERVICE_ROLE 유입 0, NEXT_PUBLIC 오남용 0, dangerouslySetInnerHTML 0. wall localStorage 는 zod 검증(unknown key strip → proto pollution 벡터 아님). gitleaks NO LEAKS.
