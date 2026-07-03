# CONTEXT PACKAGE — FS-EC-01 (체크아웃 FE + 적립금 마이페이지)
작성: orchestrator @ 2026-07-03 · 수신 역할: frontend-dev (배치 1)

## 1. Goal
체크아웃에 (a) 필수 동의 체크박스 2종, (b) 적립금 사용(redeem), (c) 현금영수증 신청 폼, (d) 제주/도서산간 추가배송비 표시를 추가하고, `/account/points` 적립금 페이지를 신설한다. 전부 **마이그레이션 미적용 시 자동 비노출(graceful)**.

## 2. Scope
### In-scope
- `src/app/(shop)/checkout/**` (page.tsx, CheckoutClient.tsx 등)
- `src/app/(shop)/account/points/**` (신규 page + Client)
- `src/app/(shop)/account/layout.tsx` (NAV_ITEMS에 적립금 추가만)
- `src/app/api/account/points/route.ts` (신규 GET)
- 신규 테스트 (tests/unit/, tests/integration/)
### Out-of-scope (수정 금지)
- `src/types/**`, `src/lib/db/mappers.ts`, `src/lib/shipping/surcharge.ts`, `src/lib/db/feature-probe.ts` — FROZEN(architect 산출). 소비만.
- `src/lib/db/order.ts`(backend-dev 병렬 작업 중), `src/lib/payment/**`, `src/app/admin/**`(타 에이전트 병렬 작업 중), Footer/Header.

## 3. 환경 사실
- Next.js 16 App Router(커스텀 — 코드 작성 전 node_modules/next/dist/docs 관련 가이드 확인), TS strict, any 금지. React 19: effect 안 setState 금지(react-hooks/set-state-in-effect) — 파생 상태는 스토어/파생 계산으로.
- 검증: `npx tsc --noEmit` · `npx eslint <경로>` · `npx vitest run`
- UI 카피 한국어. 가격 포맷은 기존 컴포넌트(PriceTag 등) 재사용.
- 마이그레이션 031(적립금)/039(현금영수증)/030(배송비 surcharge)은 **미적용일 수 있음** — 서버 페이지에서 feature-probe로 가용성 판단해 props로 내려라(클라에서 probe 호출 금지 — server-only).

## 4. 알려진 함정
- CheckoutClient에는 이미 submittingRef 재진입 가드·주소록 로드(graceful 404 처리)가 있다 — 기존 구조 보존, 최소 diff.
- clientShippingFee 서버 검증(SHIPPING_FEE_MISMATCH) 존재 — **배송비 표시·전송값에 surcharge 포함 방식은 backend-dev와 같은 순수 함수(`src/lib/shipping/surcharge.ts`)를 사용**해 계산 일치 보장. zip 변경 시 재계산.
- redeem 상한: `maxRedeemable(balance, payable)`(types/points.ts) 사용 — 결제액이 최소 100원 남아야 함. 입력 clamp + "전액 사용" 버튼.
- receipt 폼: receiptRequested 체크 시에만 type select(소득공제=income/지출증빙=proof) + 식별번호 input(휴대폰/사업자번호, 숫자·하이픈) 노출. 결제수단은 Toss 위젯이라 미상 — "현금성 결제(계좌이체 등) 시에만 발급됩니다" 안내 문구.
- 동의 체크박스 2종(필수): "개인정보 수집·이용 동의" → /privacy 링크, "구매조건 확인 및 결제진행 동의" → /terms 링크. 미체크 시 제출 차단 + 인라인 에러. (terms/privacy 페이지는 타 에이전트가 병렬 생성 — 링크만 걸면 됨.)
- /api/account/points: 로그인 필수(401), `isPointsAvailable()` false면 `{ ok:true, available:false, balance:0, ledger:[] }` — 클라는 available false면 섹션 미렌더.

## 5. 읽기 목록
1. `src/app/(shop)/checkout/CheckoutClient.tsx` + `src/app/(shop)/checkout/page.tsx` — 현 구조(폼 상태·submit·주소록)
2. `src/types/checkout.ts`, `src/types/points.ts`, `src/lib/shipping/surcharge.ts`, `src/lib/db/feature-probe.ts` — FROZEN 계약
3. `src/app/(shop)/account/layout.tsx` + `src/app/(shop)/account/addresses/**` — 마이페이지 패턴(페이지+Client 구조)
4. `src/app/api/account/addresses/route.ts`(있다면) — account API 패턴( auth 검증 방식)
5. `src/lib/db/points.ts` — backend-dev가 병렬 작성 중. **아직 없으면 시그니처 가정 금지** — /api/account/points 안에서 직접 supabase 조회(user_profiles.points_balance, user_points_ledger 최근 20건, 명시 컬럼) + probe로 graceful. (충돌 방지: db/points.ts는 backend 소유 — 이 route에서는 이 파일을 만들지도 import하지도 말 것. 통합 단계에서 orchestrator가 정리.)

## 6. 계약
- 폼 스키마는 `src/types/checkout.ts`의 FROZEN 확장 필드 사용(redeemPoints/receiptRequested/receiptType/receiptInfo/agreePrivacy/agreePurchase).
- createOrder API 호출 페이로드에 `redeemPoints`(>0일 때만), `receipt`({type,info}, requested일 때만) 포함.
- 합계 표시: 상품합계 + 배송비 + 추가배송비(surcharge, zip 기반) − 적립금 사용 = 최종 결제액. Toss 위젯 요청 금액도 최종 결제액.

## 7. Done Criteria
- [ ] `npx tsc --noEmit` 0 · `npx eslint src/app/\(shop\)/checkout src/app/\(shop\)/account src/app/api/account` 0 · `npx vitest run` 전체 green — 수치 첨부
- [ ] 신규 테스트 ≥4 (redeem clamp UI 로직, surcharge 표시 계산, 동의 미체크 차단, points route graceful)
- [ ] 마이그 미적용 시나리오: 적립금/영수증 섹션 미노출·체크아웃 정상 (probe mock 테스트)
- [ ] diff In-scope 내

## 8. 핸드오프
마지막 응답 = 페이로드 JSON(files_touched, evidence, open_questions). 커밋 금지.
