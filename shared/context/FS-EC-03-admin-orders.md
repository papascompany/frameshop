# CONTEXT PACKAGE — FS-EC-03 (관리자 주문: 부분환불 + 현금영수증 발급 + 주문 ZIP)
작성: orchestrator @ 2026-07-03 · 수신 역할: backend-dev (배치 1, admin/payment 담당)

## 1. Goal
(a) Toss cancel에 cancelAmount 지원 → 부분환불(누적 추적, 038), (b) 결제 확정(PAID) 후 현금영수증 Toss 발급 훅(현금성 결제만, graceful), (c) 관리자 주문 상세에 부분환불 폼·영수증 카드·주문 인쇄파일 ZIP 다운로드.

## 2. Scope
### In-scope
- `src/lib/payment/toss.ts` (cancel 확장 + cash-receipts 함수 추가)
- `src/lib/payment/confirm.ts` (영수증 발급 훅 — 최소 diff)
- `src/app/admin/orders/**` (actions.ts, 상세 클라이언트/페이지)
- `src/app/api/admin/orders/[id]/zip/route.ts` (신규)
- `package.json` (jszip 추가 — 이 배치에서 package.json은 너만 수정)
- 신규 테스트
### Out-of-scope (수정 금지)
- `src/types/**`·`src/lib/db/mappers.ts`·`feature-probe.ts` FROZEN. `src/lib/db/order.ts`(backend 병렬), `src/app/(shop)/**`(frontend 병렬).

## 3. 환경 사실
- 038(refunded_amount)/039(receipt_*) 마이그레이션 파일은 존재하나 **DB 미적용 가정** — `isPartialRefundAvailable()`/`isReceiptAvailable()` probe로 분기.
- Toss API: cancel = `POST /v1/payments/{paymentKey}/cancel` body `{cancelReason, cancelAmount?}` (cancelAmount 생략=전액). cash receipts = `POST /v1/cash-receipts` `{amount, orderId, orderName, customerIdentityNumber, type: '소득공제'|'지출증빙'}` — 위젯 결제(카드)에는 불필요; **결제수단이 계좌이체/가상계좌/현금성일 때만** 발급. confirm 응답의 method 필드로 판정(코드에서 Toss confirm 응답 저장 위치 확인).
- 프로덕션 Toss 키 placeholder — 실호출 검증 불가. **단위 테스트는 fetch mock**으로.
- 검증 게이트 동일(tsc/eslint/vitest). requireAdmin 이중 게이트 패턴(기존 admin API 참조) 필수.

## 4. 알려진 함정
- **부분환불 정합**: 0 < cancelAmount ≤ totalPrice − refundedAmount(서버 검증). Toss cancel 성공 **후** refunded_amount 누적 UPDATE(명시 컬럼). UPDATE 실패 시 구조화 로그(Toss는 이미 환불됨 — 은폐 금지, admin 에러 메시지에 수동 보정 안내). 누적==totalPrice 도달 시 REFUNDED 전이 + notifyRefunded(기존 전액환불 플로우와 동일 훅). 부분 상태에서는 상태 무변경(PAID/IN_PRODUCTION 유지).
- 038 미적용 시: 부분환불 UI 비노출(서버 액션도 probe false면 명시 에러 "마이그레이션 038 적용 필요"). **전액환불 기존 동작은 무변경**.
- 영수증 발급 훅(confirm.ts): PAID 확정 직후, orders.receipt_type 존재(신청) + 현금성 결제일 때만 발급 시도. 성공 → receipt_url/receipt_issued_at UPDATE(conditional). 실패/미지원 → 구조화 로그만, 주문 흐름 무영향. confirm.ts의 기존 결제 검증·렌더 enqueue 로직은 절대 건드리지 말 것(폴백 enqueue 이력 있음 — 최소 diff).
- ZIP route: requireAdmin + 주문 items의 print_file_url(있는 것만) fetch → jszip STORE(무압축, JPEG) → `{orderNo}_print.zip` 스트림 응답. 파일 0건이면 404 JSON. 개별 fetch 실패는 skip+manifest.txt에 기록. URL은 Supabase Storage 공개 URL(서버 fetch).
- 관리자 상세 UI: 기존 AdminOrderDetailClient 패턴(액션 버튼·카드) 준수. 부분환불 입력(금액+사유) + 누적 환불액/잔여 표시. 영수증 카드: 신청 유형(소득공제/지출증빙)·식별번호 마스킹(뒤 4자리)·발급 상태·URL 링크.

## 5. 읽기 목록
1. `src/app/admin/orders/actions.ts` — refundOrderAction(~188-238)·기존 액션 패턴(requireAdmin, revalidate)
2. `src/lib/payment/toss.ts` — 클라이언트 구조(cancel ~116-124), 인증 헤더
3. `src/lib/payment/confirm.ts` — PAID 확정 지점(~26-162)
4. 관리자 주문 상세 컴포넌트(AdminOrderDetailClient.tsx — 인쇄파일 링크 ~244-273)
5. `src/types/order.ts`(refundedAmount/receipt 필드) · `feature-probe.ts` · 기존 admin API route(export 등) — requireAdmin 패턴

## 6. 계약
- refundOrderAction(orderId, opts?: { cancelAmount?: number; reason?: string }) — 하위호환(무인자=전액).
- Toss 함수는 기존 toss.ts 스타일(에러 래핑) 유지. 시크릿 하드코딩 금지(기존 env 경유).

## 7. Done Criteria
- [ ] tsc 0 · eslint 0 · vitest green + 신규 테스트 ≥5 (부분환불 검증 경계 3종, 누적→REFUNDED 전이, cash-receipt 현금성 판정/graceful, zip manifest skip)
- [ ] 038/039 미적용 시나리오: 전액환불 무변경 동작 + 부분환불 명시 에러 (probe mock)
- [ ] diff In-scope 내 (package.json은 jszip 1줄)

## 8. 핸드오프
마지막 응답 = 페이로드 JSON. 커밋 금지.
