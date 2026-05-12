# Phase 1 QC Audit — 2026-05-12

## Summary
| Severity | Count |
|---|---|
| P0 (즉시 fix) | 1 |
| P1 (이번 phase) | 7 |
| P2 (다음 phase) | 9 |

## Verdict
**CONDITIONAL GO** — P0 1건 fix 후 출시. P1 7건은 출시 직전~첫 sprint 안에 처리. P2 9건은 Phase 2 백로그.

---

## P0 Issues (출시 차단)

### P0-01: createOrder가 클라이언트의 cartItems.price를 그대로 신뢰 (결제 금액 위변조)
- **File:** `src/lib/db/order.ts:70-91, 113-128, 148`
- **Category:** Security / Business Logic
- **Description:** `createOrder`는 `product_variants`를 SELECT해 `is_active`만 확인하고(:76-85), `subtotal`은 `i.price * i.quantity`(:88-91)로 클라이언트 price 직접 합산. `v.price`를 SELECT만 하고 비교에 미사용. `clientShippingFee` 미스매치만 422로 거르고(`createOrder` :102-109) `clientItemPrice`는 미검증.
- **Risk:** `/api/orders`에 `price: 1`로 보낸 후 같은 1원으로 결제 confirm 시 통과. `order_items.price` snapshot도 위조 가격 저장 → 백오피스 인지 어려움.
- **Owner:** backend-dev
- **Fix Proposal:**
  1. `createOrder`에서 `variantById.get(item.variantId).price`를 권위로 삼고, `item.price`와 불일치 시 `PRICE_MISMATCH` (422) throw
  2. subtotal도 DB price로 재계산
  3. `OrderItemSnapshot.{productName,sizeLabel,colorLabel}`는 현재 `''`인데(`order.ts:140-149`) — `order_items.variant_snapshot.productName.min(1)` Zod 스키마와도 어긋남. 같은 PR에서 DB 조회 결과로 채우기

---

## P1 Issues (Phase 1 내 fix 권장)

### P1-01: Webhook이 totalAmount 미검증 (defense-in-depth)
- **File:** `src/lib/payment/confirm.ts:79-116`
- 서명 검증은 OK, 그러나 `event.data.totalAmount`와 `order.totalPrice` 비교 없이 즉시 PAID. WEBHOOK_SECRET 유출 시 위조 PAID 가능.
- **Fix:** `event.data.totalAmount !== order.totalPrice`면 transition 건너뛰고 `payment_events.status`만 기록 + alert.

### P1-02: `src/lib/env.ts`에 `'server-only'` 가드 누락
- **File:** `src/lib/env.ts:1-33`
- 6줄에 주석으로만 적혀 있고 실제 import 없음. `CheckoutClient.tsx:23`(클라이언트)이 `env.publicSiteUrl()`만 쓰고 있어 현재 누설은 없지만, 미래에 `env.tossSecretKey()` 호출 시 즉시 노출.
- **Fix:** (A) public/server env 객체 분리 또는 (B) `'server-only'` 추가 + CheckoutClient에서 `process.env.NEXT_PUBLIC_SITE_URL` 직접 사용.

### P1-03: `.env.local.example` 환경변수 이름 불일치 + TOSS_WEBHOOK_SECRET 누락
- **File:** `.env.local.example:1-12`
- example은 `NEXT_PUBLIC_APP_URL`인데 코드는 `NEXT_PUBLIC_SITE_URL` 읽음 (`env.ts:27`). `TOSS_WEBHOOK_SECRET` 자체가 example에 없음 → `env.tossWebhookSecret()` 첫 호출에서 throw.
- **Fix:** example 갱신.

### P1-04: `next.config.ts`에 `images.remotePatterns` 미설정 (이미지 깨짐)
- **File:** `next.config.ts:1-9`
- `next/image` 사용 중인데 Supabase Storage hostname이 화이트리스트에 없음. Next 16은 빌드 통과 후 런타임에 hard fail.
- **Fix:** `images: { remotePatterns: [{ protocol: 'https', hostname: '<project>.supabase.co', pathname: '/storage/v1/object/public/**' }] }` 추가.

### P1-05: 사진 업로드 하드닝 부재 (메모리 + 비용 + RL)
- **File:** `src/app/api/photos/upload/route.ts:27-115`, `src/app/(shop)/studio/[orderId]/StudioClient.tsx:58-77`
- (a) 클라이언트 1600px 리사이즈 미구현 (photo.md 명세 위반) (b) 서버 magic bytes 미검증, `file.type` 헤더만 검사 (c) thumb를 원본 재업로드(2배 비용) (d) rate limit 없음.
- **Fix:** Studio에서 `createImageBitmap`/canvas 리사이즈 + 서버에서 `sharp(buffer).metadata()`로 컨테이너 검증 + thumb 400px로 별도 리사이즈 + sessionId 기준 rate limit.

### P1-06: Dialog 포커스 트랩/리스토어 없음 (a11y)
- **File:** `src/components/ui/Dialog.tsx:34-82`
- 코멘트에 "Phase 1 implementation — swap in @radix-ui/react-dialog later" 명시. Tab 키로 다이얼로그 밖 이동 가능, 닫을 때 트리거 복귀 없음. WCAG 2.1.2 / 2.4.3 위반.
- **Fix:** `@radix-ui/react-dialog` 도입 또는 focus trap 직접 구현. 결제 confirm 다이얼로그 추가 시 P0로 격상.

### P1-07: 큐레이션 BannerPayload.link가 javascript: URI 허용 (Stored XSS)
- **File:** `src/types/curation.ts:72-77`, `src/app/(shop)/page.tsx:67-86`
- `z.string().url()`은 `javascript:alert(1)`도 통과. admin 권한 1개 탈취 시 모든 방문자 XSS 노출.
- **Fix:** `.refine(u => /^https?:\/\//.test(u))` + 렌더 직전 `new URL(...)` 프로토콜 가드. backgroundImage에 `encodeURI`.

---

## P2 Issues (Phase 2 백로그)

| ID | 파일 | 요약 | Owner |
|---|---|---|---|
| P2-01 | `src/app/api/payment/confirm/route.ts:35-38` | `as unknown as ReturnType<...>` 이중 캐스팅 → `asBrand<OrderNo>(...)` 단순화 | backend-dev |
| P2-02 | `src/types/editor.ts:36-89`, `src/store/editor.ts:23-33` | `EditorState.productId` non-null vs store nullable vs schema mismatch (ADR-014 drift) | architect |
| P2-03 | `src/store/editor.ts:137-144` | `useCurrentVariantPrice`가 매번 O(N) — variantsByKey 직접 lookup | frontend-dev |
| P2-04 | `supabase/migrations/006_photos.sql`, `012_rls_policies.sql` | 익명 사진 cleanup/만료 잡 부재 | architect (cron) |
| P2-05 | `src/app/api/{orders,cart,photos/upload}/route.ts` | CSRF/Origin 검증 부재. 결제는 amount로 보호되지만 spam 가능 | backend-dev |
| P2-06 | `src/lib/db/product.ts:32-37` | `getProductDetail`이 category.is_active 미검증. 직접 URL 진입 시 비활성 카테고리 상품 노출 | backend-dev |
| P2-07 | `src/app/api/photos/upload/route.ts:94-95` | photos 버킷 public — URL 추측 시 접근 가능 (의도된 설계, 문서화 필요) | architect |
| P2-08 | `src/lib/db/order.ts:42-58` | ADR-013이 약속한 atomic single-statement RETURNING 미구현 — race window 존재 | architect |
| P2-09 | `tests/integration/api/*` | 핵심 보안 검증(AMOUNT_MISMATCH, ALREADY_PAID, valid signature) `it.todo` 상태 | tester |

---

## Passed Checks ✅

- typecheck / build / test 모두 통과 (51 / 19 todo / 0 failed)
- `any` / `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` 0건
- `service_role_key`는 `src/lib/supabase/service.ts`에만, server-only 포함, route 1곳에서만 import
- payment 모듈 전체 `'server-only'` + route handler에서만 import
- Webhook 서명에 `timingSafeEqual` 사용 (`signature.ts:20-23`)
- `confirmPayment`에서 DB 권위 amount 검증 (`confirm.ts:38-44`)
- `payment_events.payment_key UNIQUE` + handler dedup
- RLS 정책이 13개 테이블에 모두 존재
- `searchProducts`가 `%` / `_` 이스케이프
- `/admin/*` middleware가 `app_metadata.role === 'admin'` 검증
- Konva 격리: `react-konva` import는 dynamic FrameCanvas에만
- Branded ID 일관성 (mappers.ts 단일 캐스팅 지점)
- `next/image` `sizes` 명시
- `lang="ko"`, Input에 label/id/aria 모두 처리
- N+1 회피: `product_images!left` 조인
- 랜딩 `Promise.all` 병렬 fetch
- `console.log` 0건 (warn/error만)
- `dangerouslySetInnerHTML` 0건
