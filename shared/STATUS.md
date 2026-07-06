# FrameShop Build Status

> 단일 진실 원천 (Single Source of Truth). 모든 에이전트가 진행 상황 갱신.

**Project:** FrameShop
**Started:** 2026-05-12
**Current Phase:** 확장형 P1 편집기 웨이브 — 구현 4유닛 완료·검증 GREEN, Merge Gate/PR/배포 대기 (2026-07-06)
**Branch:** `feat/extended-p1-editor` (base: main@2e9a738 — EC 웨이브 배포 완료)

## 확장형 P1 편집기 웨이브 (2026-07-06, 오케스트레이션 하네스 집행)
- 브랜치: `feat/extended-p1-editor` (base: main@2e9a738) · 컨텍스트 패키지: `shared/context/FS-P1-wave.md` · 계약: ADR-025
- [x] FS-P1-00 기반(architect): ADR-025(FROZEN 옵셔널 계약) · `EditorPhotoEntry` 옵셔널(`selectedOptions?`/`orientation?`) · 드래프트 v2 무손실 승격(v1 자동 승격) · `OrderItemSnapshot` orientation/projectSeq/groupLabel · `isProjectCartAvailable` probe
- [x] FS-P1-01 스토어(frontend-dev): `kind:'basic'|'extended'` 분기(basic=현행 코드 문자 그대로) · `photoPool` · 라인 액션 5종 · 라인별 totals `sum(price_i×qty_i)` · `suggestOrientation`(best-fit)
- [x] FS-P1-02 서버(backend-dev): createOrder 그룹 동결(variant_snapshot jsonb + 035 probe conditional-spread) · cart_projects 헤더 upsert(dedup+race) · 로그인 카트 sync probe 폴백(미적용 시 평면 저장)
- [x] FS-P1-03 UI(frontend-dev): `mode=multi`(PhotoPoolPanel/LineList/MultiCheckoutControls) · 묶음 담기 · 드래프트 v2 연동 · 상품상세 "여러 장 만들기" CTA · 모바일 · i18n 24키
- [x] Verification Gate — **tsc 0 · eslint 0 · next build exit 0 · vitest 510 passed | 14 todo(베이스라인 451 → +59).** 베이직 회귀 고정 테스트 다수(basic 경로 현행 동작 고정). CTO 케이스 1~4 전부 커버(같은 사진 다른 사이즈/사진별 상이/같은 사이즈 N장/혼합 방향).
- graceful: 익명은 034/035 무관 완전 동작(localStorage). 로그인 카트 동기화만 probe 폴백(묶음 정보는 주문 스냅샷 jsonb 보존) — **034/035 적용 시 로그인 묶음 동기화 자동 활성화**.
- [ ] Merge Gate → PR/배포 → 프로덕션 스모크 · CTO: **034/035 적용 권장(격상)** — `docs/MIGRATIONS-APPLY.md`
- 잔여(P2 후보): 재크롭 배지 베이스라인 드래프트 영속화 · extended 명화/Google Photos 소스 · StudioClient 본문 i18n · 갤러리월(036/037) · 카트/주문 6화면 묶음 시각화(P3) · 서버 드래프트

---

## EC 웨이브 (2026-07-03, 오케스트레이션 하네스 집행)
- 정찰: 5차원 병렬(주문플로우/관리자/백로그/포토월/실판매) 갭 82건 + P0 적대검증 — Review Gate 승인(CTO): A+B+C+D 전부, 재고 차감 제외, 포토월=스튜디오 딥링크, 쿠폰/문의/위시리스트 다음 세션.
- 컨텍스트 패키지: `shared/context/FS-EC-00~06.md`
- [x] FS-EC-00 Foundation(architect): 038/039 마이그 + 타입 계약 + feature-probe + surcharge 순수모듈
- [x] 배치 1 (병렬 3): FS-EC-01 체크아웃 FE(필수 동의 2종·적립금 사용·현금영수증 신청·추가배송비 표시·`/account/points`·`/api/account/points`) · FS-EC-02 주문 서버 코어(redeem fail-closed+보상 트랜잭션·surcharge 서버 재계산·receipt 저장·conditional-spread INSERT / confirmPurchase 1% earn 멱등) · FS-EC-03 관리자 주문/결제(부분환불 Toss cancelAmount+refunded_amount 누적+낙관 잠금·현금영수증 Toss 발급 훅(현금성 결제만)·주문 ZIP(jszip))
- [x] 배치 2 (병렬 3): FS-EC-04 포토월 /wall(mm 실측 Konva 벽 시뮬레이터+스튜디오 딥링크 프리셀렉트+localStorage v1) · FS-EC-05 법적고지/SEO(/terms /privacy+company.ts SSOT+404+JSON-LD 테스트) · FS-EC-06 관리자 통계 대시보드+artworks 썸네일 sharp
- [x] Verification Gate — **tsc 0 · eslint(src,tests,--max-warnings=0) 0 · vitest 413 passed(베이스라인 239, +174) · next build exit 0.** 로컬 QA: /terms /privacy 404 콘텐츠 서버 HTML 확증, /wall graceful 빈 상태(로컬 env 없음). 데이터 화면은 배포 후 프로덕션 스모크 예정.
- [x] Security/Final 적대 리뷰(`shared/audit/FS-EC-security.md`·`FS-EC-final.md`) — **verdict NO-GO(P0 1건: /api/orders 가 redeemPoints/receipt 미전달 브리지 공백) → 수정 랜딩 완료**(필드 전달+422 매핑+seam 통합 테스트). 동반 수정: 적립 회수 자동화 격상(전액 환불·취소 시 reversePointsForOrder 멱등 자동 회수 — 부분환불은 무조정, ADR-024 Postscript)·딥링크 시 편집 드래프트 보존·receipt_info PII 마스킹·ZIP fetch origin 제한·식별번호 최소 8자리. **보정 후 최종: vitest 451 passed | 14 todo(직접 실행 확인 — 관리자취소 회수 +4 포함).**
- [x] Docs — ADR-024(B-2 정책+graceful feature-probe 패턴)+Postscript(리뷰 P0·자동 회수 격상), `docs/MIGRATIONS-APPLY.md` 038/039 반영, `docs/BACKLOG.md` §3 B-2 완료·§5 정리, `shared/HANDOFF.md` EC 핸드오프
- [x] Merge Gate → PR/배포 완료 — #59 머지 + #60(pnpm-lock 재동기화)로 main 라이브(2026-07-03). 프로덕션 스모크(데이터 화면)는 마이그 적용 후 CTO 확인(HANDOFF EC 절).
- 마이그레이션 참고: **029~039 전부 미적용 상태에서도 앱 정상**(graceful probe/conditional-spread) — 적용 시 자동 활성화. CTO 적용 가이드 = `docs/MIGRATIONS-APPLY.md`.

---

## Phase 0: Bootstrap ✅ DONE (2026-05-12)
- [x] docs/PLAN.md 존재 확인 (워크트리 복사 완료)
- [x] shared/ 디렉토리 초기화 (STATUS/HANDOFF/DECISIONS/BLOCKERS)
- [x] Node 환경 확인 (v22.22.2 — Konva 호환 OK)
- [x] 코어 의존성 설치 (supabase, zustand, zod, react-hook-form, konva, react-konva, sharp, toss)
- [x] 테스트 의존성 설치 (vitest, testing-library, msw, playwright)
- [x] package.json: engines `"20.x || 22.x"`, scripts `test`/`test:e2e`/`typecheck` 추가
- [x] .env.local.example + .env.local 템플릿 생성 (값은 사용자가 채워야 함)
- [x] .gitignore에 `!.env*.example` 예외 추가
- [x] next.config.ts에 `turbopack.root` 설정 (workspace root 경고 제거)
- [x] `npm run build` 통과

## Phase 1: Specs (planner)
- [x] catalog (planner @ 2026-05-12)
- [x] product (planner @ 2026-05-12)
- [x] photo (planner @ 2026-05-12)
- [x] editor (planner @ 2026-05-12)
- [x] cart (planner @ 2026-05-12)
- [x] checkout (planner @ 2026-05-12)
- [x] payment (planner @ 2026-05-12)
- [x] order (planner @ 2026-05-12)
- [x] admin (planner @ 2026-05-12)
- [x] landing (planner @ 2026-05-12)

## Phase 2: Types & Schema (architect) ✅ DONE (2026-05-12)
- [x] src/types/common.ts (branded IDs + Result + Paginated)
- [x] src/types/product.ts (Product, ProductListItem, OptionMatrix, etc.)
- [x] src/types/photo.ts (Photo, ExifMeta, upload errors)
- [x] src/types/editor.ts (CropTransform, EditorState — Konva-free)
- [x] src/types/cart.ts (CartItem with localId)
- [x] src/types/shipping.ts (ShippingMethod + calc contract — ADR-008)
- [x] src/types/order.ts (OrderStatus union, ORDER_TRANSITIONS, snapshots)
- [x] src/types/checkout.ts (CheckoutFormData + PICKUP-aware schema)
- [x] src/types/payment.ts (Toss confirm/webhook + payment_events)
- [x] src/types/curation.ts (banner/collection/feature payloads)
- [x] src/types/admin.ts (admin form inputs, variant CSV)
- [x] src/types/landing.ts (LandingData composition)
- [x] supabase/migrations/001~012 (12 files incl. RLS + seeds + ADR-008/010/011/012/013)
- [x] shared/INTERFACES/types-frozen.md
- [x] shared/INTERFACES/api-contract.md
- [x] `npm run typecheck` ✅
- [x] ADR-009~015 added (Architect 자율 결정)

## Phase 3a: Design System (designer) ✅ DONE
- [x] globals.css tokens (ZZIXX color/typo/spacing, Pretendard 폰트, 모바일 우선)
- [x] base UI primitives (Button, Input, Select, Dialog, Tabs, Card, Badge)
- [x] layout (Header, MobileNav, Footer, Container)
- [x] specialty (PriceTag, ProductCard, OptionTabs)
- [x] cn() class joiner

## Phase 3b: Backend (backend-dev) ✅ DONE
- [x] Supabase clients (server/client/service) + env helper
- [x] catalog queries (getCategories tree, getProductsByCategory, searchProducts, getRepresentativeProducts)
- [x] product detail queries (getProductDetail, getProductOptions)
- [x] photo upload route + createPhoto
- [x] editor: pure transform helpers (lookupVariant, applyCropTransform, fitPhotoToFrame)
- [x] cart sync (DB + LocalStorage + client API)
- [x] checkout validation (validateCheckoutForm + formatPhone) + getShippingMethods + bulkUpdate
- [x] payment (Toss adapter, signature verify, confirmPayment, handleWebhook)
- [x] order state machine (canTransition, formatOrderNo, createOrder, transitionTo, getOrder, findOrderByGuest)
- [x] admin endpoints (upsertProduct, toggleProductActive, upsertFrameAsset, importVariants, upsertCuration)
- [x] DB ↔ domain mappers
- [x] middleware (admin gate + Supabase session refresh)
- [x] route handlers: /api/payment/{confirm,webhook}, /api/photos/upload, /api/orders, /api/cart, /api/cart/[localId]

## Phase 3c: Tests (tester) ✅ DONE (51 passing / 19 todo)
- [x] vitest.config.ts + tests/setup.ts (jsdom + jest-dom) + server-only stub
- [x] playwright.config.ts (iPhone 12 + Desktop)
- [x] MSW handlers (Supabase REST + Toss)
- [x] unit: shipping (10 tests, ADR-008 모든 케이스)
- [x] unit: order state machine (UT-05, formatOrderNo)
- [x] unit: editor transforms (UT-02, UT-03, UT-08)
- [x] unit: cart summary + serialize (UT-07)
- [x] unit: payment signature (HMAC + tamper + schema reject)
- [x] unit: checkout validate + formatPhone (UT-04 + PICKUP exemption)
- [x] integration: cart-flow (anon LocalStorage round-trip)
- [x] integration: /api/payment/confirm (BAD_JSON / BAD_INPUT)
- [x] integration: /api/webhook/payment (INVALID_SIGNATURE)
- [x] integration: checkout-form (todo skeletons for Phase 4)
- [x] integration: editor-flow (todo skeletons for Phase 4)
- [x] e2e: user-purchase, admin, mobile-editor (test.skip로 골격만)

## Phase 4: Frontend (frontend-dev) ✅ DONE (MVP 수준)
- [x] app/(shop)/layout.tsx (Header + Footer + MobileNav)
- [x] app/(shop)/page.tsx — 랜딩 (HeroBanner + CategoryGrid)
- [x] app/(shop)/catalog/[slug]/page.tsx
- [x] app/(shop)/product/[id]/page.tsx + StartEditorButton
- [x] app/(shop)/studio/[orderId]/page.tsx — StudioClient + FrameCanvas (Konva, dynamic ssr:false)
- [x] src/store/editor.ts (Zustand store + useCurrentVariantPrice 셀렉터)
- [x] app/(shop)/cart/page.tsx — LocalStorage 기반 anon cart
- [x] app/(shop)/checkout/page.tsx — 폼 + 배송 방법(ADR-008) + Toss requestPayment
- [x] app/(shop)/payment/{success,fail}/page.tsx (confirm 라우트 호출)
- [x] app/(shop)/order/{success,lookup}/page.tsx
- [x] app/admin/{layout,page,products,orders,shipping}/page.tsx (Phase 1 stub + shipping table)
- [x] `npm run typecheck` ✅
- [x] `npm run build` ✅ (모든 라우트 생성)
- [x] `npm test` ✅ (51 passing / 19 todo)

## Phase 5: QC (qc-reviewer) — 진단 라운드 완료 (2026-05-12)
- [x] type safety audit (any/ts-ignore 0건, branded ID 일관, server-only 격리 OK)
- [x] security audit (P0 1건 발견: createOrder 가격 위변조)
- [x] performance audit (Konva 격리 OK, N+1 회피 OK, P2: useCurrentVariantPrice O(N))
- [x] a11y audit (lang=ko/label/aria 대부분 OK, P1: Dialog focus trap 없음)
- [x] 산출물: `docs/audit/phase-1.md` (P0:1, P1:7, P2:9, verdict: CONDITIONAL GO)
- [ ] **다음:** P0-01 + P1 7건 fix → 재감사 → GO
- [x] backend fix: P0-01 (createOrder PRICE_MISMATCH + DB-권위 snapshot), P1-01 (webhook amount mismatch defense), P1-02/03 (env split → env-public.ts + server-only, .env.local.example 갱신 + TOSS_WEBHOOK_SECRET), P1-05 (sharp magic-bytes 검증 + thumb 별도 리사이즈 + per-session rate limit). typecheck/build/55 tests 통과 (2026-05-12 backend-dev)

---

## Phase 5 Feature PRs: 비회원 주문 + i18n ✅ DONE (2026-05-14)
- [x] PR #17 merged: 비회원 주문 플로우 완성
  - middleware.ts: fs-guest-sid 쿠키 자동 발급 (1년, HttpOnly, SameSite=Lax)
  - /api/orders: 쿠키에서 sessionId 직접 읽기 (위변조 방지)
  - studio/[orderId]/page: effectiveSessionId 연동 (userId > guestSid > orderId)
  - order/success page: 비회원 감지 → "주문 조회하기" 링크 표시
  - 21개 단위 테스트 추가
- [x] PR #18 merged: i18n 다국어(ko/en)
  - next-intl v4.12.0 설치 + createNextIntlPlugin
  - 쿠키(NEXT_LOCALE) 기반 locale 전환 (URL 변경 없음)
  - src/messages/ko.json + en.json (8개 섹션 전체)
  - 헤더 KO/EN 토글 (LocaleSwitcher 컴포넌트)
  - 19개 단위 테스트 추가 (키 완전성 검증 포함)
- 전체 테스트: 204 passing / 14 todo / 0 failed
- pnpm build: 성공

## Current Bottleneck
**Phase 5 Feature 구현 완료.** Vercel 자동 배포 진행 중.

핵심 주문 플로우 E2E 표면:
landing → catalog → product → studio → cart → checkout (배송 방법 ADR-008) → [Toss 결제는 issue #2로 연기] → order success.

### ✅ 환경 연결 완료
- Supabase 프로젝트 `acxsxjmqgvkceqahwkpz` 연결
- 마이그레이션 12개 적용 (002 pg_trgm 순서 fix 포함)
- Storage buckets `photos`, `previews` 생성 + RLS
- 시드: 카테고리 1 + 상품 1 + variants 4 + shipping_methods 3
- `.env.local`: URL/anon/service_role 채움
- `npm run dev` (port 3001): 핵심 8개 라우트 200 OK

### 📅 사용자 결정으로 연기된 작업
- **Toss 결제 연동**: GitHub Issue #2로 등록, Phase 1 마지막 단계

### 📋 남은 선택 작업 (사용자 선택 필요)
1. 이미지 업로드 + `product_images` / `frame_assets` 시드 (실제 카드 이미지)
2. Admin 계정 생성 + `app_metadata.role='admin'` 부여 → `/admin` 검증
3. PR #1 main 머지 (Phase 1 MVP를 main에 안전 보존)
4. Phase 2 확장 (admin/frames, admin/options, admin/curation 누락 페이지)
5. P2 9건 일부 선제 처리 (order_no atomic, photos cleanup cron)
6. Issue #2 토스 결제 연동 (마지막)

## Open Blockers
없음.

## Recent Updates
- 2026-06-24: **데모 접근 점검 + 세션 핸드오프 정리** — 전방위 점검: 고객 흐름은 인증 없이 프로덕션 별칭(`frameshop-snowy`) 공개(200 확인), 생성형/프리뷰 URL만 Vercel SSO 보호(`vercel.com/sso-api`), 앱 게이트는 `/admin`만. **결제 미구성 발견**: Toss 클라키=`test_ck_placeholder`라 "결제하기" 위젯 에러(완주 불가, 런칭 전 과제). BACKLOG §6 + SESSION_START_PROMPT 갱신. (코드 변경 없음, 문서만.)
- 2026-06-23: **선결과제 3 구현 — 편집 세션 무결성 (ADR-022)** — localStorage 드래프트(`src/lib/editor/draft.ts`, 키=`(sessionId,productId)`). sessionId가 새로고침·재진입에 안정적(`effectiveSessionId`)이라 복원된 사진이 동일 세션 소유로 남아 결제 photo-ownership 무결성 유지. 저장=확정 트레이(prereq1 출처 포함)+옵션/방향, 버전키+안전파싱+7일 TTL. 스토어 `restoreDraft`/`restoredDraftCount`, StudioClient 마운트 복원 배너·디바운스 저장·결제 시 정리. Next.js 16 react-hooks `set-state-in-effect` 규칙 회피(복원 카운트 스토어 보관). 서버 드래프트(교차기기)는 P2+ 분리. 검증 tsc/eslint/next build/228 tests(신규 8). **선결과제 3건 전부 완료.**
- 2026-06-23: **선결과제 1 구현 — 원본 사진 보존 + 재주문 복구 (ADR-020)** — 무마이그레이션: `cart_items.photo_id`=원본·`crop_transform`=실제변형·`photo_url`=베이크크롭(인쇄 무변경), `order_items` 스냅샷에 `sourcePhotoId` 동결(+`bleedMm` zod 보강). 재주문 route가 sourcePhotoId/photo_url역조회로 유효 `AddToCartInput` 재구성, `MyOrdersClient`가 실제 addToCart → **재주문 무동작 BL 해소**. 편집기 `EditorPhotoEntry`/`addEntry`/`handleAddToTray`/`handleCheckoutAll`이 원본 출처 전달. 선결과제 2 정책 CTO 확정·동결(ADR-021: 세트할인 비례배분·세트단위 취소·세트 부분선택 불가). 검증 tsc/eslint/next build/220 tests GREEN. 파일: types/editor·order, store/editor, StudioClient, db/order·photo, api/cart/reorder, MyOrdersClient, order-create.test(+1).
- 2026-06-23: **확장형 상품 설계 제안 (멀티에이전트)** — 경쟁사 7클러스터 리서치 + 현 코드 5축 분석 + 후보 아키텍처 3종 심사 + 적대적 비평. 채택=프로젝트/세트 집합(`cart_items`에 nullable `projectId`, 변형 4축·인쇄 무변경). 베이직/확장형 분리, 갤러리월 vs 일반 다조합은 `set_template_id` 유무로 분기(데이터 통합·카탈로그 분리). 선결과제 3건(원본 photoId 보존·세트가/취소 ADR·세션 영속화). 산출물 `docs/specs/extended-product.md` + `docs/specs/extended-product-mockups.html`, BACKLOG §1A 등록. **검토 대기**(구현 미착수).
- 2026-06-23: **로컬 정본 동기화** — `~/Developer/frameshop`(정본, iCloud 밖) main을 origin #57(`0a81f0a`)로 정렬(stale `bad361d`에서 48커밋). 미커밋 변경은 stale HEAD 허상으로 확인(보존할 작업 0). `~/Documents/frameshop`은 iCloud stale 사본(작업 금지).
- 2026-05-13: **Image seed + admin user (heisenberg)** — Sharp 스크립트로 frame PNG 4종(black/brown/white/natural) 생성 + Supabase Storage 업로드, product_images 7개(thumb/gallery×4/guide×2), frame_assets 4색상, product_variants 16개(4색×4사이즈) 시드. Admin 계정 `yohan73@gmail.com` 비번 `Yohan0817` (role=admin) 설정 + 로그인 검증 완료. 재현 스크립트 `scripts/{generate-frame-assets.mjs, upload-frame-assets.sh, seed-admin-user.sh}` + `supabase/seed/01_phase1_image_seed.sql` 체크인.
- 2026-05-13: **Landing redesign + ISR 캐싱 (heisenberg)** — HeroShowcase(3-slide carousel) + MasterpieceGallery(6 명화) + LifestyleStudio(split editorial) + CollectionRail(풍경 가로 스크롤) + ProductCard hover 리뉴얼 + Header 5메뉴 + MobileNav 5탭. 폰트 self-host(next/font/local Pretendard + Bebas Neue), `getAnonSupabase()` 신설로 랜딩 ISR(revalidate=600s) 가능, 카탈로그/상품 revalidate=300s, `staleTimes.dynamic=30`. 프로덕션 측정: 랜딩 `x-vercel-cache: HIT` → 0.58s (이전 3s).
- 2026-05-12: Phase 0 bootstrap 완료 (Node v22, 521 packages 설치, build 통과)
- 2026-05-12: docs/shared/.claude/agents를 본체에서 워크트리로 복사
- 2026-05-12: turbopack.root 설정으로 lockfile 경고 해결
- 2026-05-12: docs/specs/catalog.md 작성 완료 (planner)
- 2026-05-12: docs/specs/product, photo, editor, cart, checkout, payment, order, admin, landing 작성 완료 (planner) — Phase 1 종료
- 2026-05-12: ADR-008 반영: checkout/admin/order spec 보강 (planner)
- 2026-05-12: Phase 2 Architect 완료 — 12개 타입 파일 + 12개 SQL 마이그레이션 + RLS + INTERFACES 2종. typecheck 통과. ADR-009~015 등록.
- 2026-05-12: Phase 3 Backend Dev 완료 — Supabase clients/env, db/*.ts 7개 모듈, 6개 route handlers, middleware, toss + signature, calculateShippingFee, canTransition.
- 2026-05-12: Phase 3 Designer 완료 — globals.css 토큰(@theme inline), UI primitives 7개, layout 4개, specialty 3개. Pretendard 변수 폰트 CDN 로딩.
- 2026-05-12: Phase 3 Tester 완료 — 70개 테스트(51 passing, 19 todo). vitest + msw + playwright 모두 설정. server-only Vitest stub 추가.
- 2026-05-12: typecheck + build 모두 통과.
- 2026-05-12: Phase 4 Frontend Dev 완료 — (shop) layout + 9개 페이지 + admin 5개 페이지 + Zustand editor store + FrameCanvas(Konva dynamic). 빌드 산출물 20개 라우트.
- 2026-05-12: Phase 1 MVP 완료 — 사용자 검수 대기 (STOP).
- 2026-05-12: PR #1 + #3 main 머지 완료, GitHub `papascompany/frameshop` public repo.
- 2026-05-12: Vercel 연결 — production env 7개 + preview env 7개 + development env 7개 (sensitive 분리 적용).
- 2026-05-12: Vercel Node 버전 24.x → 22.x로 변경 (frameshop 단일 프로젝트만 영향, Konva 호환성 안전).
- 2026-05-12: Supabase Auth site_url을 `https://frameshop-snowy.vercel.app`로 변경 + localhost dev allow list 등록.
- 2026-05-12: 운영 이슈 정리 — Toss 결제는 issue #2로 연기, Vercel/Supabase CLI minor 업데이트는 사용자 직접 (영향 minimal).
- 2026-05-12: Phase 5 QC fix (Architect) — P1-04 next.config.ts `images.remotePatterns` + `formats` 추가, P1-07 `httpsUrl()` 헬퍼 신설 후 curation/admin/cart schema에 적용. ADR-016 등록. typecheck/test/build 모두 통과.
- 2026-05-12: Phase 5 QC fix 통합 — backend(P0-01 createOrder DB 권위화 + P1-01 webhook amount + P1-02 env split + P1-03 .env example + P1-05 sharp magic-bytes/thumb/RL) + frontend(P1-05 client resize + P1-06 Radix Dialog + P1-07 safeHref). 55 passing/19 todo/0 failed. Verdict: GO.
- 2026-05-12: GitHub PR #1 생성 (papascompany/frameshop, 9 commits, 165 files).
- 2026-05-12: Supabase 연결 — access token으로 `acxsxjmqgvkceqahwkpz` link, db push 12개 마이그레이션 적용 (002 pg_trgm 순서 fix 포함), storage buckets + 시드 데이터 적용 (categories 1 / products 1 / variants 4 / shipping_methods 3 / buckets 2).
- 2026-05-12: `.env.local`에 SUPABASE_URL/anon/service_role 채움. `npm run dev` (port 3001) 8개 라우트 모두 200 OK.
- 2026-05-12: Toss 결제 연동은 사용자 결정으로 Phase 1 마지막으로 연기 → GitHub Issue #2 등록.
- 2026-06-19: [x] Backend: admin orders actions + CSV export 완료 — markDelivered/cancel/refund 액션에 notifyDelivered/notifyCancelled/notifyRefunded 연결(fire-and-forget), saveOrderMemoAction(trim+200자 cap, 빈문자열=null), bulkUpdateTrackingAction(orderNo 해석→SHIPPED 전환→notifyShipped, per-row ok/error), GET /api/admin/orders/export(UTF-8 BOM CSV, 13개 한글 컬럼, RFC4180 이스케이프). tsc 클린(소스), 29 테스트 통과.
- 2026-06-19: [x] Phase B-1(고객 주문취소/구매확정/주소록, PR #53) 재배포 트리거 — #53 머지본(2b1caba)에 대한 Vercel auto-deploy가 누락되어 프로덕션 반영용 트리거 커밋. 마이그레이션 032/033 적용 대기.
- 2026-06-22: [x] 전체 코드베이스 전수감사(5차원 오케스트레이션+adversarial) → 진짜 결함 3건 수정(#56): 결제 폴백렌더·webhook 로그·체크아웃 중복제출 가드. 오탐 3건 기각. tsc/lint/build/219테스트 GREEN. 라이브.
- 2026-06-22: [x] 배포 정상화 — git author를 PapasCompany로 설정해 Hobby 비공개레포 배포 차단(storigehub) 완화. #56이 머지만으로 자동 Ready 배포됨(`0c81c01`).
- 2026-06-22: [📋] **남은/예정 작업은 `docs/BACKLOG.md`(SSOT)로 정리.** 미적용 마이그레이션 029/030/031/032/033 = `shared/BLOCKERS.md BL-010`. 다음: 재주문 수정 / Phase B-2(적립금·부분환불·현금영수증) / 보안 Phase 1-2 / Phase C.
- 2026-07-03: [x] Backend: FS-EC-06 admin 대시보드 + 명화 썸네일 완료 — `src/lib/db/admin-stats.ts` 신규(server-only, 명시 컬럼, KST 자정 경계, 유효 매출=PAID/IN_PRODUCTION/SHIPPED/DELIVERED, refunded_amount 미SELECT=부분환불 미반영 ADR-023, 섹션별 graceful null), admin 홈에 매출 요약/상태별 CSS 바/인기 상품 TOP5(variant_snapshot 앱 집계)/최근 주문 10건 추가(빠른이동 타일 유지), artworks 썸네일 sharp 512px inside q80 → `artworks/thumbs/` 업로드(실패 시 원본 URL 폴백). tsc 0 / eslint 0 / vitest 365 passed(신규 9). 커밋 없음(핸드오프).
- 2026-07-03: [x] **EC 웨이브 구현 7단위(FS-EC-00~06) 완료 + 문서 정합** — 검증: tsc 0 · eslint(src,tests,--max-warnings=0) 0 · vitest 413 passed(베이스라인 239, +174) · next build exit 0. 정책·패턴은 ADR-024(재고 차감 제외, 포토월=스튜디오 딥링크, 적립 1%+최소결제 100원, 적립 회수 수동 ADJUSTMENT, 부분환불 누적==total 시 REFUNDED 전이(전이 불가 상태는 유지+경고 로그), 현금영수증 income/proof·현금성 결제만, graceful feature-probe+conditional-spread). 문서: MIGRATIONS-APPLY(038/039)·BACKLOG(§1/§2/§3/§5/§7)·HANDOFF 갱신. 다음: Merge Gate → PR/배포 → 프로덕션 스모크 + CTO 마이그 적용.
- 2026-07-06: [x] **확장형 P1 편집기 웨이브(FS-P1-00~03) 완료 + 문서 정합** — 브랜치 `feat/extended-p1-editor`(base: main@2e9a738), 계약 ADR-025. 4유닛: 기반(옵셔널 계약·드래프트 v2·스냅샷 확장·probe) / 스토어(kind 분기·photoPool·라인 액션 5종·라인별 totals) / 서버(createOrder 그룹 동결·cart_projects upsert·sync probe 폴백) / UI(mode=multi·묶음 담기·CTA·i18n 24키). CTO 케이스 1~4 커버, 베이직 회귀 0. 검증: tsc 0 · eslint 0 · build 0 · **vitest 510 passed | 14 todo**(451→+59). 문서: BACKLOG §1/§1A · extended-product §8 · MIGRATIONS-APPLY(034/035 권장 격상) · HANDOFF P1 절. 다음: Merge Gate → PR/배포 + CTO 034/035 적용.
- 2026-07-03: [x] **EC 웨이브 적대 리뷰(Security+Final) → P0 수정 랜딩 + 문서 보정** — verdict NO-GO(P0 1건: /api/orders route가 redeemPoints/receipt를 createOrder로 미전달) → 수정 완료(필드 전달+POINTS_*/RECEIPT_* 422 매핑+라우트 seam 통합 테스트). 동반: 적립 회수 자동화 격상(전액 환불·취소 시 reversePointsForOrder — 사용분 ADJUSTMENT+/적립분 REFUND−, (order_id,type) 멱등, fire-and-forget, 031 미적용 skip; 부분환불 무조정=문서화된 한계), 딥링크 진입 시 편집 드래프트 보존(ADR-022 정합), receipt_info PII 서버측 마스킹, ZIP fetch Supabase origin 제한, 현금영수증 식별번호 최소 숫자 8자리. **최종 vitest 451 passed | 14 todo(직접 실행 확인 — 관리자취소 회수 +4 포함).** 문서 보정: ADR-024 Postscript·BACKLOG §3/§5/§7·HANDOFF EC 절.
- 2026-07-06: [x] **마이그레이션 029~039 프로덕션 적용 완료** — CTO 브라우저 로그인(yohan73) + Claude가 SQL Editor 통합 실행(전부 비파괴·멱등). 검증 24행 일치. 런타임 자동 활성화 확증(체크아웃 RSC features 3종 true — 재배포 0). BL-010 Resolved. 활성화됨: 주문메모·주소록·구매확정·적립금·추가배송비·부분환불·현금영수증·로그인 묶음 카트 동기화(034/035).
