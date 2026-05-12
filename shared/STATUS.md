# FrameShop Build Status

> 단일 진실 원천 (Single Source of Truth). 모든 에이전트가 진행 상황 갱신.

**Project:** FrameShop
**Started:** 2026-05-12
**Current Phase:** Phase 1 MVP 완료 — Phase 5 QC 진입 직전. 사용자 검수 대기.
**Worktree:** `.claude/worktrees/trusting-pascal-b9b918` (branch: `claude/trusting-pascal-b9b918`)

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

## Current Bottleneck
**Phase 1 MVP 실제 연결까지 완료** (DB + dev 서버 동작 확인).

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
