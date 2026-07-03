# CONTEXT PACKAGE — FS-EC-06 (관리자 통계 대시보드 + 명화 썸네일)
작성: orchestrator @ 2026-07-03 · 수신 역할: backend-dev (배치 2)

## 1. Goal
(a) admin 홈에 매출/주문 통계 대시보드(오늘·7일·30일 매출/건수, 상태별 카운트, 최근 주문, 인기 상품), (b) admin/artworks 썸네일 생성 TODO 해소(sharp 리사이즈).

## 2. Scope
### In-scope
- `src/app/admin/page.tsx` (통계 섹션 추가 — 기존 빠른이동 타일 유지)
- `src/lib/db/admin-stats.ts` (신규, server-only, 명시 컬럼)
- `src/app/admin/artworks/actions.ts` (썸네일 TODO만)
- 신규 테스트
### Out-of-scope (수정 금지)
- `src/app/admin/orders/**`(배치 1 산출 — 읽기만), `src/lib/admin/adminNav.ts`, types, mappers.

## 3. 환경 사실
- admin/page.tsx는 서버 컴포넌트(현재 정적 타일). requireAdmin은 미들웨어가 /admin 전체 게이트 — 페이지 추가 인증 코드는 기존 admin 페이지 패턴 확인 후 동일하게.
- sharp 의존성 이미 존재(^0.34.5, 서버 렌더 파이프라인 사용 중).
- 차트 라이브러리 추가 금지 — CSS 바/그리드로 시각화(경량). 모바일(admin 모바일 뷰) 대응.
- 검증 게이트 동일. select('*') 금지 — 집계는 명시 컬럼 + head:true count 또는 rpc 없이 select 후 집계(주문량 규모 작음 — 30일 범위 필터 필수).

## 4. 알려진 함정
- **매출 정의**: 유효 매출 = status IN ('PAID','IN_PRODUCTION','SHIPPED','DELIVERED') (CANCELLED/REFUNDED 제외), 금액 = total_price(적립금 차감 후 실결제액— 스냅샷 그대로). 환불 반영: refunded_amount 컬럼은 미적용일 수 있음 — SELECT에 포함 금지(ADR-023 명시 컬럼 원칙), 이번 버전은 미반영(문서화).
- created_at 범위 필터(KST 기준 오늘 — Asia/Seoul 자정 경계; 기존 order_no 발급의 KST 처리 참조).
- 인기 상품: order_items의 variant_snapshot jsonb에서 productName 추출 — order_items(order_id, price, quantity, variant_snapshot) 명시 SELECT 후 앱 집계(30일 범위 주문 id in).
- 쿼리 실패는 graceful(대시보드 섹션에 "집계 불가" 표시, 페이지 크래시 금지 — 랜딩의 static fallback 패턴 참조).
- 썸네일: 원본 업로드 buffer를 sharp resize(512px 긴 변, inside, jpeg q80) → 별도 storage 경로(artworks/thumbs/...) 업로드 → thumb_url 저장. 기존 actions.ts:~95 TODO 위치·업로드 유틸 재사용. 실패 시 기존 폴백(thumbUrl=imageUrl) 유지.

## 5. 읽기 목록
1. `src/app/admin/page.tsx` — 현 구조(타일)
2. `src/lib/db/admin.ts` — admin 쿼리 스타일(getAllOrdersPaged 등)·서버 클라이언트 취득
3. `src/app/admin/artworks/actions.ts` — TODO 지점·업로드 방식
4. `src/lib/db/order.ts`의 KST 처리(order_no 발급부) — 오늘 경계 계산 참조
5. admin 디자인 토큰(bg-canvas/border-hairline/text-ink 등) — 기존 admin 컴포넌트

## 7. Done Criteria
- [ ] tsc 0 · eslint 0 · vitest green + 신규 테스트 ≥3 (매출 집계 순수 로직: 상태 필터/KST 경계/인기상품 집계)
- [ ] 집계 실패 graceful(mock 에러 테스트 1)
- [ ] diff In-scope 내

## 8. 핸드오프
마지막 응답 = 페이로드 JSON. 커밋 금지.
