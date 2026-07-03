# CONTEXT PACKAGE — FS-EC-00 (Foundation: 계약 동결 + 마이그레이션)
작성: orchestrator @ 2026-07-03 · 수신 역할: architect

## 1. Goal
이커머스 완성 웨이브(B-2 적립금/부분환불/현금영수증 + 030 배송비 + 실판매)의 **타입 계약·마이그레이션·graceful 프로브**를 먼저 동결한다. 이후 구현 에이전트 6팀이 이 계약만 소비한다(계약 파일은 이후 FROZEN).

## 2. Scope
### In-scope (수정 가능)
- `supabase/migrations/038_orders_refunded_amount.sql` (신규)
- `supabase/migrations/039_orders_cash_receipt.sql` (신규)
- `src/types/order.ts`, `src/types/checkout.ts`, `src/types/shipping.ts` (옵셔널 추가만)
- `src/types/points.ts` (신규)
- `src/lib/db/mappers.ts` (mapOrder/mapShippingMethod graceful 매핑만)
- `src/lib/db/feature-probe.ts` (신규, server-only)
- `src/lib/shipping/surcharge.ts` (신규, 순수 함수)
### Out-of-scope (수정 금지)
- 그 외 전부. 특히 `src/lib/db/order.ts`, `CheckoutClient.tsx`, `src/lib/payment/**` — 후속 에이전트 소유.

## 3. 환경 사실
- 프로젝트: /Users/yohan/Developer/frameshop, 브랜치 feat/ecommerce-basics-photowall
- Next.js 16(커스텀 — AGENTS.md: node_modules/next/dist/docs 참조), TS strict, any 금지, select('*') 금지(신규 쿼리), Zod v4
- 검증: `npx tsc --noEmit` · `npx eslint <files>` · `npx vitest run` (현재 239 passed)
- DB 마이그레이션은 CTO 수동 적용 — **029~035 전부 미적용 상태로 가정**. 036/037은 set_templates/bundle_rules 예약(스펙 §8) — 사용 금지.

## 4. 알려진 함정
- FROZEN 타입은 **옵셔널 추가만** 허용(기존 리터럴/픽스처 무파손) — ADR-020/023 선례.
- `cart_items`/상품 SELECT 명시 컬럼 목록에 신규 컬럼 추가 금지(미적용 시 쿼리 파손 — ADR-023).
- orders INSERT에 신규 컬럼을 무조건 넣으면 미적용 DB에서 42703 — 구현 에이전트가 conditional-spread로 처리(너는 타입만).
- 031(user_points)은 이미 존재: `apply_points_transaction(p_user_id uuid, p_order_id uuid, p_type text, p_delta int, p_description text) RETURNS int`, orders.points_redeemed/points_accrued 컬럼 포함. totalPrice는 redeem 차감 후 최종 금액으로 저장(031 주석 — confirm.ts 검증 유지).

## 5. 읽기 목록
1. `supabase/migrations/031_user_points.sql` — RPC 시그니처·컬럼 (earn/redeem 계약 근거)
2. `supabase/migrations/030_orders_shipping_surcharge.sql` — surcharge_fee, shipping_methods.surcharge_fee_jeju/remote
3. `src/types/order.ts`, `src/types/checkout.ts`, `src/types/shipping.ts` — 기존 계약 스타일
4. `src/lib/db/mappers.ts` — graceful 매핑 선례(orderMemo/confirmedAt undefined-safe, mapProduct productType)
5. `shared/DECISIONS.md` ADR-020~023 — 옵셔널 추가/graceful 원칙

## 6. 산출 계약 (구현 지시)
### 6-1. 마이그레이션 (전부 비파괴·멱등, 034/035와 동일 스타일 주석)
- **038**: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_amount int NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);` + COMMENT(부분환불 누적액, 행 가격 합계와의 정합).
- **039**: orders에 `receipt_type text CHECK (receipt_type IN ('income','proof'))` NULL, `receipt_info text` NULL, `receipt_url text` NULL, `receipt_issued_at timestamptz` NULL + COMMENT(현금영수증: income=소득공제, proof=지출증빙, NULL=미신청; info=식별번호; url/issued_at=Toss 발급 결과).
### 6-2. `src/lib/db/feature-probe.ts` (server-only import)
- `probeFeature(key, table, column?)` — `select <column> limit 0` 실행, 42703/42P01/PGRST 계열 에러 → false, 성공 → true. 모듈 레벨 Map 캐시 TTL 60초(성공은 영구 캐시 가능).
- 노출: `isPointsAvailable()`(user_profiles), `isSurchargeAvailable()`(shipping_methods.surcharge_fee_jeju), `isReceiptAvailable()`(orders.receipt_type), `isPartialRefundAvailable()`(orders.refunded_amount), `isConfirmAvailable()`(orders.confirmed_at).
### 6-3. `src/lib/shipping/surcharge.ts` (순수, 클라/서버 공용 — server-only 금지)
- `ZIP_REGION` = 'mainland'|'jeju'|'remote'. `classifyZip(zip: string): ZipRegion` — 제주 63000~63644, 도서산간 대표 범위(인천 옹진 23004~23010·백령 등, 울릉 40200~40240 등 통상 리스트, 주석으로 출처 명시). `calcSurcharge(region, method: {code, surchargeFeeJeju, surchargeFeeRemote}): number` — STANDARD만, PICKUP/QUICK 0 (030 주석 준수).
### 6-4. 타입 (옵셔널 추가만 + zod 동기화)
- `order.ts`: Order에 `refundedAmount?: number`, `receiptType?: 'income'|'proof'|null`, `receiptInfo?: string|null`, `receiptUrl?: string|null`, `receiptIssuedAt?: IsoTimestamp|null`, `pointsRedeemed?: number`, `pointsAccrued?: number`, `surchargeFee?: number`. CreateOrderInput에 `redeemPoints?: number`, `receipt?: { type: 'income'|'proof'; info: string } | null`. CreateOrderErrorCode에 `'POINTS_UNAVAILABLE' | 'POINTS_INSUFFICIENT' | 'RECEIPT_UNAVAILABLE'`. createOrderInputSchema 동기화(redeemPoints int ≥0 optional, receipt object nullable optional — info는 min 8 max 20, 숫자·하이픈만 regex).
- `checkout.ts`: CheckoutFormData(및 스키마)에 `redeemPoints?: number`, `receiptRequested?: boolean`, `receiptType?: 'income'|'proof'`, `receiptInfo?: string`, `agreePrivacy: boolean`(신규 필수 — 스키마 refine으로 true 강제), `agreePurchase: boolean`(동일). **주의**: 기존 폼 사용처가 깨지지 않게 두 agree 필드는 `.default(false)`+refine 또는 optional+상위 검증 중 기존 코드 스타일에 맞는 방식 선택 — 반드시 기존 CheckoutClient의 스키마 사용 방식을 읽고 결정.
- `shipping.ts`: ShippingMethodConfig에 `surchargeFeeJeju?: number`, `surchargeFeeRemote?: number`.
- `points.ts`(신규): `PointsTransactionType = 'ACCRUAL'|'REDEMPTION'|'ADJUSTMENT'|'REFUND'`, `PointsLedgerEntry`, `PointsSummary { balance: number; available: boolean }`, `POINTS_EARN_RATE_BPS = 100`(1%), `POINTS_MIN_PAYABLE = 100`(redeem 후 최소 결제액), `calcEarnPoints(totalPrice)` 순수 함수, `maxRedeemable(balance, payable)` 순수 함수 = `Math.max(0, Math.min(balance, payable - POINTS_MIN_PAYABLE))`.
### 6-5. 매퍼
- mapOrder: 신규 컬럼 undefined-safe 매핑(refunded_amount→refundedAmount??0, receipt_*→null 폴백, points_*→0, surcharge_fee→0). OrderRow 타입에 옵셔널 필드 추가.
- mapShippingMethod: surcharge_fee_jeju/remote → 0 폴백.

## 7. Done Criteria (증거 필수)
- [ ] `npx tsc --noEmit` 0 에러 — 출력 첨부
- [ ] `npx eslint src/types src/lib/db/mappers.ts src/lib/db/feature-probe.ts src/lib/shipping/surcharge.ts` 0 — 출력 첨부
- [ ] `npx vitest run` 기존 239 전부 green — 수치 첨부
- [ ] surcharge.ts·points.ts 순수 함수 단위 테스트 각 3개 이상 신규(tests/unit/modules/)
- [ ] diff가 In-scope 내 (git status로 확인)
- [ ] 마이그레이션 2건 멱등(IF NOT EXISTS) + 한국어 주석 + 034 스타일

## 8. 핸드오프
- 완료 시: 마지막 응답 = 핸드오프 페이로드 JSON(files_touched, evidence.test_results, frozen 계약 요약, open_questions). 커밋 금지(orchestrator 통합 커밋).
