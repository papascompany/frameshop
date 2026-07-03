# CONTEXT PACKAGE — FS-EC-05 (법적 고지 + SEO/에러 페이지)
작성: orchestrator @ 2026-07-03 · 수신 역할: frontend-dev (배치 2)

## 1. Goal
실판매 법적 요건: `/terms`(이용약관)·`/privacy`(개인정보처리방침) 페이지 신설, Footer에 링크+사업자정보 블록, 404 페이지, 상품 상세 JSON-LD(Product/Offer).

## 2. Scope
### In-scope
- `src/app/(shop)/terms/page.tsx`, `src/app/(shop)/privacy/page.tsx` (신규, 정적)
- `src/app/not-found.tsx` (신규)
- `src/components/layout/Footer.tsx` (링크+사업자정보 블록)
- `src/app/(shop)/product/[id]/page.tsx` (JSON-LD script 추가만)
- 신규 테스트(있으면 — JSON-LD 빌더 순수 함수 등)
### Out-of-scope (수정 금지)
- Header(타 에이전트), checkout/**(동의 체크박스는 타 에이전트), admin/**, types.

## 3. 환경 사실
- Next.js 16 App Router. 기존 JSON-LD 선례: layout.tsx의 buildOrganizationJsonLd(구조 참조·재사용).
- 사업자 실값(상호/대표/사업자등록번호/통신판매업신고/주소/전화) **미확정** — `src/lib/legal/company.ts` 상수 모듈로 중앙화하고 placeholder(`(주)파파스컴퍼니(확정 필요)` 식) + `// TODO(CTO): 실값 확정` 주석. 값 하드코딩 산재 금지.
- 검증 게이트 동일.

## 4. 알려진 함정
- 약관/방침은 한국 전자상거래 표준 구성(약관: 총칙/구매계약/결제/배송/청약철회·환불(맞춤제작 상품 청약철회 제한 조항 — 전자상거래법 17조 2항 5호 '주문에 따라 개별 생산되는 재화' 명시)/책임제한/분쟁해결; 방침: 수집항목/이용목적/보유기간/제3자제공(토스페이먼츠·배송사)/처리위탁/파기/권리/책임자). **법률 자문 전 초안임을 페이지 하단에 명시**.
- 맞춤 인쇄 상품 특성: 청약철회 제한 + 불량/오배송 시 교환·환불 가능 조항 필수.
- JSON-LD: Product{name, image, description, offers{price, priceCurrency: KRW, availability}} — startingPrice 사용, 리뷰 집계 있으면 aggregateRating(없으면 생략, 빈 값 금지).
- Footer: 기존 디자인 토큰·구조 유지, 최소 diff. 링크는 /terms /privacy. 사업자정보는 작은 텍스트 블록(한국 쇼핑몰 표준 푸터).
- not-found.tsx: 기존 디자인 시스템(버튼/타이포) 재사용, 홈/카탈로그 링크.

## 5. 읽기 목록
1. `src/components/layout/Footer.tsx` — 현 구조
2. `src/app/layout.tsx` — JSON-LD 선례(buildOrganizationJsonLd 위치·주입 방식)
3. `src/app/(shop)/product/[id]/page.tsx` — 데이터(getProductDetail) 구조
4. 기존 정적 페이지 하나(예: order/lookup) — 페이지 스켈레톤 패턴

## 7. Done Criteria
- [ ] tsc 0 · eslint 0 · vitest green(기존 무손상)
- [ ] /terms /privacy /not-found 렌더 확인(빌드 통과로 갈음 + 라우트 존재)
- [ ] JSON-LD 유효 JSON(테스트 1개 — 빌더 함수 파싱)
- [ ] diff In-scope 내

## 8. 핸드오프
마지막 응답 = 페이로드 JSON. 커밋 금지.
