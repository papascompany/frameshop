# FrameShop Build Status

> 단일 진실 원천 (Single Source of Truth). 모든 에이전트가 진행 상황 갱신.

**Project:** FrameShop
**Started:** 2026-05-12
**Current Phase:** Phase 5 완료 — PR #17 비회원 주문 + PR #18 i18n(ko/en) main 머지 (2026-05-14)
**Worktree:** `.claude/worktrees/trusting-heisenberg-6e59ec` (branch: `claude/trusting-heisenberg-6e59ec`)

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
