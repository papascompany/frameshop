# Architecture Decision Records (ADR)

> 중요한 의사결정의 영구 기록. 한번 작성된 ADR은 수정/삭제하지 않고 superseded 표시.

## Format
```
## ADR-NNN: <제목>
**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXX
**Context:** 왜 이 결정이 필요한가
**Decision:** 무엇을 결정했나
**Consequences:** 긍정/부정 영향
**Alternatives Considered:** 검토했던 다른 옵션들
```

---

## ADR-001: 편집기 라이브러리로 Konva 채택
**Date:** 2026-05-11
**Status:** Accepted
**Context:** 사진을 액자 프레임 PNG와 합성하고, 사용자가 모바일 터치로 사진 위치/크기/회전을 조정해야 한다. 캔버스 라이브러리 선택 필요.
**Decision:** Konva.js + react-konva 사용
**Consequences:**
- (+) 모바일 멀티터치 제스처 견고
- (+) 레이어 모델이 프레임 합성에 적합
- (+) 번들 크기 ~150KB (Fabric ~250KB 대비 가벼움)
- (-) Fabric.js 보다 텍스트 편집 기능이 약함 (이번 프로젝트엔 불필요)
**Alternatives Considered:**
- Fabric.js — 텍스트 편집 강하나 모바일 터치/번들 크기 열세
- Canvas API 직접 — 회전/스케일 매트릭스 직접 구현 부담

---

## ADR-002: 모바일 우선 디자인
**Date:** 2026-05-11
**Status:** Accepted
**Context:** ZZIXX 레퍼런스 캡처가 모두 모바일이고, 한국 액자 주문 시장은 모바일 비중 60%+.
**Decision:** 모든 컴포넌트는 375px viewport에서 먼저 설계. PC는 enhancement.
**Consequences:**
- (+) 핵심 사용자 경험 최적화
- (+) 작은 화면 제약이 좋은 정보 위계 강제
- (-) PC 사용자가 화면 여백 많다고 느낄 수 있음 — Phase 2에서 보완

---

## ADR-003: Supabase 단일 사용
**Date:** 2026-05-11
**Status:** Accepted
**Context:** DB, Auth, Storage, Edge Function이 모두 필요.
**Decision:** Supabase에 통합. Papas의 다른 프로젝트(SOLC, 나의이야기 등)와 일관성 유지.
**Consequences:**
- (+) 인프라 단순화, RLS로 보안 통합
- (+) 팀 학습 곡선 최소화
- (-) 벤더 락인 — 이전 시 Postgres + 별도 Auth 분리 필요

---

## ADR-004: 결제 PG 토스페이먼츠 우선
**Date:** 2026-05-11
**Status:** Accepted
**Context:** 한국 시장 결제 PG 선택 필요. 카드/카카오/네이버/토스 등 통합 결제 지원.
**Decision:** Phase 1에서 토스페이먼츠 단일 사용. Phase 3에서 포트원 통합으로 다중 PG 지원 검토.
**Consequences:**
- (+) API 문서 우수, SDK 안정적
- (+) 결제수단 다양 (카드/간편결제 모두 토스 SDK로 처리)
- (-) 단일 PG 의존성 — 장애 시 대체 없음 (Phase 3에서 해결)

---

## ADR-005: 클라이언트 미리보기 vs 서버 인쇄 렌더링 분리
**Date:** 2026-05-11
**Status:** Accepted
**Context:** 미리보기는 빠르게, 인쇄용은 고해상도(300dpi)로.
**Decision:**
- 클라이언트: Konva로 화면용 미리보기 (≤1080px)
- 서버: 결제 완료 후 Edge Function이 동일한 transform을 Sharp/node-canvas로 300dpi 재렌더링
**Consequences:**
- (+) 모바일 메모리 한계 회피
- (+) 색공간/ICC 프로파일 서버에서 일괄 적용 가능
- (-) 서버 렌더링 워커 인프라 추가 (Edge Function으로 해결)

---

## ADR-006: 변형(Variant) 미리 생성
**Date:** 2026-05-11
**Status:** Accepted
**Context:** 사이즈 × 색상 × 매트 × 인화지 = 최대 4×4×2×3 = 96 조합. 가격이 단순 합산이 아닐 수 있음(매트가 사이즈에 따라 비선형).
**Decision:** `product_variants` 테이블에 모든 조합을 사전 생성. 가격을 직접 저장.
**Consequences:**
- (+) 조회 성능, 가격 계산 명료
- (+) 재고/단종 변형 단위로 관리 가능
- (-) 관리자가 조합을 일일이 등록해야 함 → CSV import 기능 제공

---

## ADR-007: 큐레이션 별도 테이블
**Date:** 2026-05-11
**Status:** Accepted
**Context:** 랜딩 페이지에 시즌 배너, 추천 컬렉션 등을 시기별로 노출 필요.
**Decision:** `curations` 테이블 별도 설계. type/device/기간으로 필터.
**Consequences:**
- (+) 상품 변경 없이 노출 변경 가능
- (+) 시즌/이벤트 자동 ON/OFF
- (-) 관리자가 큐레이션과 상품을 두 곳에서 관리 — 단점 인지하고 수용

---

## ADR-008: 배송비 정책 — 관리자 설정 기반 다중 배송 방법
**Date:** 2026-05-12
**Status:** Accepted
**Context:** Planner가 checkout.md 작성 중 배송비 정책이 PLAN.md에 명시되지 않아 비즈니스 결정 요청. 단순 정액으로는 한국 이커머스 표준(임계값 무료배송) 및 픽업/퀵배송 요구를 못 맞춘다.
**Decision:**
- **배송 방법 3종** (사용자가 checkout에서 선택):
  1. `STANDARD` (기본 배송) — 관리자 설정 기본배송비(기본값 3,000원). 주문 금액이 관리자 설정 임계값(기본값 30,000원) 이상이면 0원.
  2. `PICKUP` (직접수령) — 항상 0원. 픽업 장소 안내(관리자 설정 문자열).
  3. `QUICK` (퀵배송) — 관리자 설정 가격(기본값 별도). 지역/시간대 제한은 Phase 2.
- **관리자 설정 저장 위치:** 신규 테이블 `shipping_methods` (또는 단일 row `shipping_settings`) — Architect가 스키마 선택.
  - 컬럼 (제안): `code` (STANDARD/PICKUP/QUICK), `label` (사용자 표시명), `fee` (정액), `free_threshold` (STANDARD 전용, nullable), `is_active`, `note` (픽업 장소 등), `sort_order`.
- **orders 테이블 변경:** `shipping_method` text 컬럼 추가, 기존 `shipping_fee` 유지. 주문 시점의 배송 방법/가격 스냅샷 저장.
- **계산 책임:** `calculateShippingFee(method, subtotal, settings)` 순수 함수 — UT 대상 (M-Order 또는 M-Checkout).
**Consequences:**
- (+) 관리자가 운영 중 배송비/임계값/퀵배송 가격을 코드 수정 없이 변경
- (+) 픽업/퀵배송으로 매출 채널 다양화
- (+) 표준 한국 이커머스 패턴(임계값 무료배송) 충족
- (-) checkout.md / admin.md / order.md / 스키마 모두 보강 필요 — Planner가 갱신
- (-) Phase 1에서 admin UI 일부 노출 (배송 정책 설정 화면) — 최소 폼으로 단순화
**Alternatives Considered:**
- 정액 3,000원 단일 — 임계값/픽업/퀵배송 요구 불충족
- 환경변수 기반 — 운영 중 변경 시 재배포 필요, 비현실적
- 옵션 코드 하드코딩 + 가격만 admin — 추가 배송 방법 확장 어려움

---

## ADR-009: Branded ID 타입으로 모든 도메인 ID 표현
**Date:** 2026-05-12
**Status:** Accepted
**Context:** Order/Product/Cart 등 여러 도메인이 `string` UUID를 다룬다. 함수 시그니처가 `(productId: string, orderId: string)` 형태면 인자 순서 실수가 컴파일 타임에 잡히지 않는다.
**Decision:** `src/types/common.ts`에 `Brand<string, 'ProductId' | …>` 패턴으로 13종 ID 브랜딩(`ProductId`, `OrderId`, `CartItemId`, …) + `LocalId`/`SessionId`/`PaymentKey`/`OrderNo`. 런타임 비용 0, IO 경계에서 `asBrand<T>(rawString)` 캐스팅.
**Consequences:**
- (+) 함수 시그니처 안전성 강화 (`getProduct(orderId)` 같은 실수가 컴파일 에러)
- (+) DB ↔ 타입 매퍼에서 자연스러운 단일 캐스팅 지점 확보
- (-) 외부에서 받은 string을 `as ProductId`로 캐스팅해야 하는 보일러플레이트 — 라이브러리 코드(`db/*`)에 국한.

## ADR-010: photos 테이블에 sessionId 컬럼 추가 (비회원 격리)
**Date:** 2026-05-12
**Status:** Accepted (Architect 자율 결정, HANDOFF 위임)
**Context:** photo.md 자율 결정 항목: 비회원 사진 격리 방식.
**Decision:** `photos.session_id text NULL` 추가 + `CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)` + 인덱스. Storage path prefix `photos/anon/<sessionId>/...`와 함께 이중 분리. 회원 전환 시 session_id로 join하여 user_id 매핑 가능.
**Consequences:**
- (+) RLS 정책 표현이 명확 (`photos_owner_select`는 user_id 기준)
- (+) Phase 2 마이페이지에서 익명 → 회원 마이그레이션 경로 보존
- (-) 익명 사진 INSERT는 service-role 라우트를 통해야 함 (RLS가 anon insert 차단)

## ADR-011: cart_items.local_id 컬럼 추가 (LocalStorage ↔ DB dedup)
**Date:** 2026-05-12
**Status:** Accepted (Architect 자율 결정, HANDOFF 위임)
**Context:** cart.md HANDOFF 사항: LocalStorage cart와 DB cart 간 중복 제거 키 필요.
**Decision:** `cart_items.local_id uuid NOT NULL` + `UNIQUE(user_id, local_id)`. 클라이언트가 UUID 생성, 로그인 시 sync 시 upsert.
**Consequences:**
- (+) `syncCartOnLogin`이 안전한 dedup upsert로 단순화
- (+) 다중 디바이스 sync 시 가산 충돌 방지
- (-) cart_items 행이 PK + local_id 두 식별자를 가짐 — local_id가 클라이언트 단에서는 진짜 PK 역할

## ADR-012: payment_events 테이블 신설 (웹훅 dedup + 감사)
**Date:** 2026-05-12
**Status:** Accepted (Architect 자율 결정, payment.md ADR 후보 채택)
**Context:** payment.md "자율 결정" 항목: 토스 웹훅이 같은 이벤트를 여러 번 보낼 수 있으며, 감사 추적도 필요.
**Decision:** `payment_events` 테이블 (paymentKey UNIQUE, raw_payload jsonb, received_at). RLS는 service-role 전용. orders.payment_id에 paymentKey UNIQUE도 추가하여 이중 안전망.
**Consequences:**
- (+) 토스 재시도 idempotency 보장
- (+) 결제 분쟁 발생 시 raw payload로 감사 가능
- (-) 운영 부담: 90일 후 archive 정책 필요(Phase 2).

## ADR-013: order_sequences 테이블 + UPSERT 기반 order_no 발급
**Date:** 2026-05-12
**Status:** Superseded by ADR-019 (2026-05-12)
**Context:** order.md AC-2: 같은 날 시퀀스가 동시성 안전해야 함. Postgres advisory lock vs sequence table 검토.
**Decision:** `order_sequences(day date PK, seq int)` 테이블. 발급 시 `INSERT ... ON CONFLICT (day) DO UPDATE SET seq = order_sequences.seq + 1 RETURNING seq` 한 줄로 atomic. KST 기준 day.
**Consequences:**
- (+) advisory lock보다 디버그 친화적 (테이블 조회로 진행상황 확인 가능)
- (+) 트랜잭션 내 한 statement로 race 안전
- (-) day 자정 경계 정확성은 애플리케이션 layer의 KST 변환에 의존.
**Postscript (2026-05-12):** Supabase JS 클라이언트가 단일 statement `INSERT ... ON CONFLICT ... RETURNING`을 직접 호출하지 못해, Phase 1 구현(`src/lib/db/order.ts:42-58`)이 SELECT → UPSERT 두 statement로 분리되었고 race window가 남았다 (코드 주석에 명시됨). P2-08에서 SECURITY DEFINER RPC로 해소 → ADR-019.

## ADR-014: TypeScript 타입 + Zod 스키마 공존 패턴
**Date:** 2026-05-12
**Status:** Accepted
**Context:** 런타임 검증(폼 submit/route handler/webhook)과 컴파일 타임 타입 모두 필요.
**Decision:** 동일 파일에 `type Foo` + `fooSchema = z.object({...})` 공존. `z.infer<typeof fooSchema>`로 역추론 가능하지만, 가독성을 위해 type을 우선 선언하고 schema는 검증용으로만 사용. 두 정의가 어긋날 경우 typecheck로 못 잡으니 PR 리뷰에서 확인.
**Consequences:**
- (+) 모듈 진입점이 명확 (각 도메인 파일 = type + schema)
- (-) 두 정의가 swimming 가능성. QC 리뷰 항목으로 추가.

## ADR-016: URL 검증 정책 — http(s) only refinement (P1-07 fix)
**Date:** 2026-05-12
**Status:** Accepted (P1-07 fix)
**Context:** Zod v4의 `z.string().url()`은 WHATWG URL 파싱만 검증하므로 `javascript:alert(1)`, `data:text/html,...`, `file:///...`도 통과한다. admin이 작성하는 큐레이션 배너의 `link`/`imageUrl`이 `next/image src`나 `<a href>`로 흘러갈 때 admin 계정 1개만 탈취되면 모든 방문자가 stored XSS에 노출된다. Frame asset의 `pngUrl`/`previewUrl`, cart의 `photoUrl`/`previewUrl`도 동일 경로.
**Decision:** `src/lib/validation/url.ts`에 두 헬퍼 추가:
- `httpUrl()` — `^https?://` 만 허용 (legacy 자산용 여지)
- `httpsUrl()` — `^https://` 만 허용 (렌더 surface 기본값)

Supabase Storage가 항상 https를 서빙하므로 admin 입력/사용자 업로드 URL은 모두 `httpsUrl()`로 통일. TypeScript 타입(`type Foo`)은 그대로 `string`을 유지 (브랜드 타입 없음) — 런타임 검증만 강화.

적용 위치:
- `src/types/curation.ts` — `BannerPayload.imageUrl`, `BannerPayload.link`
- `src/types/admin.ts` — `frameAssetInputSchema.pngUrl`, `frameAssetInputSchema.previewUrl`
- `src/types/cart.ts` — `cartItemSchema.photoUrl`, `cartItemSchema.previewUrl`

`CollectionPayload`/`FeaturePayload`는 URL 필드가 없고 `productIds`만 다루므로 영향 없음. `photos` 테이블 URL은 server-generated이라 검증 면제.
**Consequences:**
- (+) URL-handle XSS 차단 (admin 권한 탈취 시 피해 축소)
- (+) frontend-dev가 별도 가드 없이도 schema 통과 URL을 신뢰 가능 (단, 렌더 직전 `new URL()` 가드는 defense-in-depth로 권장)
- (-) http/https 외 프로토콜(`mailto:`, `tel:`, `javascript:`, `data:`) 사용 불가 — 현재 시나리오에 영향 없음
- (-) 로컬 Supabase emulator를 http로 띄울 경우 admin 자산 URL이 검증 실패 가능 — Phase 1 배포 시 Supabase Cloud(https) 사용 전제

**Alternatives Considered:**
- 렌더 직전 가드만 — 검증 누락 위치 발견 시 즉시 XSS. schema 차원에서 막는 게 안전.
- URL `protocol` 직접 파싱 (`new URL(s).protocol === 'https:'`) — refine 안에서 가능하나 try/catch 필요, regex가 동등 안전.

---

## ADR-015: Editor 타입의 Konva 격리
**Date:** 2026-05-12
**Status:** Accepted
**Context:** editor.md AC-12: Konva가 서버 번들에 절대 포함되지 않아야 함.
**Decision:** `src/types/editor.ts`는 Konva-free (`Stage`/`Layer` 타입 import 안 함). Konva가 필요한 컴포넌트는 `src/modules/editor/`에 두고 페이지에서 `dynamic({ssr:false})`로 로드. 헬퍼 순수 함수(`applyCropTransform`/`fitPhotoToFrame`)는 일반 객체 입출력만 사용해 서버에서도 테스트 가능.
**Consequences:**
- (+) 서버 번들에 Konva 포함 방지 + 단위 테스트가 jsdom 없이 가능
- (-) 핸들러 안에서 Konva 타입을 쓸 때는 동적 import에서 받아오는 번거로움.

---

## ADR-017: 익명 사진 30일 retention + pg_cron 일일 cleanup (P2-04 fix)
**Date:** 2026-05-12
**Status:** Accepted (P2-04 fix)
**Context:** ADR-010이 비회원 사진을 `photos.user_id IS NULL AND session_id IS NOT NULL`로 격리했지만, "Phase 2 cleanup job"이 보류 상태로 남아 익명 행이 영구 누적될 위험이 있었다. Phase 1 QC P2-04가 이를 식별. 익명 사진은 마이페이지 연결이 없으므로 일정 기간 후 삭제해도 사용자 영향이 없다.

**Decision:**
- **Retention:** `user_id IS NULL` 사진은 `created_at + 30 days` 후 삭제 대상.
- **실행 메커니즘:** PostgreSQL `pg_cron` 확장 + SECURITY DEFINER 함수.
  - `public.delete_expired_anonymous_photos()` — 만료된 익명 사진 DELETE, 삭제 행수 RETURN.
  - 스케줄: 매일 18:00 UTC = 03:00 KST (off-peak).
  - 이름: `cleanup-anon-photos`.
- **권한:** `REVOKE ALL FROM PUBLIC`; `GRANT EXECUTE TO service_role`. pg_cron이 superuser 권한으로 실행.
- **Storage cleanup은 Phase 3로 분리:** `photos` 테이블 DELETE는 Storage 객체(`photos/anon/<sessionId>/...` JPEG 파일)는 건드리지 않는다. Storage는 별도 Edge Function(scheduled)으로 Phase 3에서 정리. SQL 안에서는 Storage API 접근 불가.
- **마이그레이션:** `supabase/migrations/013_photos_cleanup.sql`.
- **로깅:** 삭제 수가 0보다 크면 `RAISE NOTICE` (postgres log로 ops가 grep 가능).

**Consequences:**
- (+) 익명 사진 무한 누적 방지 → DB / 비용 / 백업 사이즈 안정화
- (+) 회원 사진은 영향 0 (`user_id IS NOT NULL` 가드)
- (+) 마이그레이션 안에서 함수 + 스케줄 모두 등록 → 재실행 안전
- (-) Storage 객체는 30일 후에도 남음 — Phase 3 Edge Function 도입 전까지 stale storage cost 잔존
- (-) `pg_cron`이 활성화되지 않은 환경(저티어 Supabase, self-hosted)에서는 자동 실행 안 됨. 마이그레이션은 NOTICE만 남기고 통과; 운영자는 외부 스케줄러로 함수 직접 호출 가능.

**Alternatives Considered:**
- Cron job in Vercel (`/api/cron/cleanup-photos`) — 추가 인프라 의존, secret 관리 필요. pg_cron이 더 단순.
- 만료 컬럼(`expires_at`)을 photos에 추가 → 더 명시적이지만 schema 변경 + 모든 INSERT 경로 수정 필요. retention 정책 변경 시 행 UPDATE 필요. Skipped.
- RLS 통한 read 차단 (만료 행을 0건처럼 응답) — 디스크/백업 비용은 그대로. Skipped.

---

## ADR-018: photos 버킷 public 정책 (P2-07 문서화)
**Date:** 2026-05-12
**Status:** Accepted (P2-07 문서화 결정)
**Context:** P2-07 QC 지적: Phase 1의 photos Supabase Storage 버킷은 `public = true`로 설정되어 있어, UUID 기반 URL을 확보한 모든 클라이언트(인증 없음)가 객체를 GET할 수 있다. UUID v4가 추측 가능성을 사실상 0에 수렴시키지만, URL이 한 번 노출되면 (예: 사용자 디바이스 캡쳐, 공유, log) 보호 메커니즘이 없다. 추가로 `cart_items.photo_url` / `order_items.photo_url` 스냅샷은 평문 URL로 저장되어 일반 사용자가 자기 cart/order 안에서 항상 자신의 photo URL을 본다 — public 접근이 사실상 요구되는 셈.

**Decision:** Phase 1은 photos 버킷 `public = true`를 유지한다. 이는 의도된 trade-off:
- (+) **단순함** — 서버 라우트가 signed URL 발급 책임을 지지 않음. Next/Image, `<img src>`, `next/link preview` 등이 추가 처리 없이 동작.
- (+) **cart/order 스냅샷 호환** — `cart_items.photo_url`, `order_items.photo_url`이 영구 유효한 URL을 보관 가능 (signed URL은 만료되어 과거 주문 조회 시 깨짐).
- (+) **CDN 캐시** — Supabase CDN이 public 객체만 캐시. signed URL은 캐시 hit률이 낮다.
- (-) **URL leak = exposure** — URL이 새어나가면 누구나 조회. UUID 난수성에 의존.
- (-) **사용자별 권한 검증 불가** — 다른 사용자의 photo URL을 직접 부르면 응답함. (별도 row 권한은 RLS가 막지만 Storage object은 무관.)

**Phase 3 hardening 옵션:**
1. Storage 버킷을 `public = false`로 전환.
2. signed URL 발급 Edge Function (`/api/photos/signed-url?photoId=...&ttl=3600`) — RLS 검증 후 1시간 TTL 발급.
3. `cart_items.photo_url` / `order_items.photo_url` 컬럼 의미를 "object path"로 바꾸고, 응답 시 server-side에서 signed URL로 변환.
4. Next/Image loader를 custom으로 교체.

**감수 사항:**
- 사용자 사진은 일반적으로 가족/풍경 등 비밀이 아닌 콘텐츠. 의료/개인정보 사진과 달리 leak 임팩트가 제한적.
- UUID v4 = 122 bits 엔트로피 → 우연 추측 ≈ 0.
- Phase 1 출시 직후 모니터링: storage 객체 access log를 주기적으로 검토 (anomalous traffic 패턴 감지).

**Alternatives Considered:**
- Phase 1부터 signed URL — 추가 라우트 + cart/order 스냅샷 의미 재설계 필요 (path vs URL). 출시 일정상 미채택.
- 버킷 private + service-role proxy 라우트로 streaming — bandwidth가 Vercel을 통과해 cost 증가. Skipped.

---

## ADR-019: order_no 발급 RPC 단일-statement atomicity (P2-08 fix)
**Date:** 2026-05-12
**Status:** Accepted (P2-08 fix; supersedes ADR-013 race window)
**Context:** ADR-013은 `INSERT ... ON CONFLICT DO UPDATE SET seq = seq + 1 RETURNING seq`로 atomic 발급을 약속했지만, Phase 1 구현(`src/lib/db/order.ts:42-58`)이 Supabase JS 한계로 두 statement(`SELECT` → `UPSERT`)로 분리되었고 race window가 남았다 (코드 주석에 "race window is small but real" 명시). 동시 주문 폭주 시 `orders.order_no UNIQUE` 위반 또는 seq skip이 가능.

**Decision:** PostgreSQL SECURITY DEFINER 함수 `public.next_order_no(day_kst date)`로 ADR-013 원안의 단일 statement를 안전하게 노출. RPC 호출 한 번으로 INSERT/UPSERT/RETURNING이 한 statement 안에 묶여 row-level lock으로 serialize됨.

**구현:**
- 마이그레이션 `supabase/migrations/014_order_no_atomic.sql`.
- 함수 본문: `INSERT INTO order_sequences (day, seq) VALUES (day_kst, 1) ON CONFLICT (day) DO UPDATE SET seq = order_sequences.seq + 1 RETURNING seq INTO result;`
- 권한: `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated, service_role.`
- 애플리케이션 변경은 backend-dev follow-up (마이그레이션 내 TODO로 안내): `src/lib/db/order.ts`의 `generateOrderNo`가 `supabase.rpc('next_order_no', { day_kst })`를 호출하도록 수정.

**Consequences:**
- (+) race 없음 — `RETURNING` 이 row lock 후 평가되므로 동시 호출이 서로 다른 seq를 받는다.
- (+) ADR-013의 원래 의도(한 statement atomic) 충족.
- (-) 함수 변경 시 마이그레이션 새로 발행 필요 (Phase 1 immutable migration 원칙).
- (-) 외부 PostgREST에서 RPC가 호출 가능해지지만 `REVOKE FROM PUBLIC`으로 anon은 차단.

**Alternatives Considered:**
- Advisory lock (`pg_advisory_xact_lock(hashtext(day_kst::text))`) → upsert → release: 동작하지만 lock contention 추적이 어렵고 디버그 친화도 낮음.
- `serial` / `bigserial` 컬럼 + day prefix 분리: 시퀀스가 day 경계에서 reset 안 되어 `YYYYMMDD-0001` 포맷이 깨짐.
- 클라이언트에서 retry on UNIQUE violation: 동작은 하지만 retry 폭주 + 사용자 응답 지연. Skipped.

---

## ADR-020: 확장형 상품 선결과제 1 — 원본 사진 보존(무마이그레이션) + 스냅샷 v2

**Date:** 2026-06-23
**Status:** Accepted (구현 완료, 라이브 전 검증 GREEN)

**Context:**
편집기는 "담기" 시점에 크롭을 굽고 새 photoId 로 재업로드한다(photo-only 베이크 크롭, 2026-06-13 결정).
그 결과 `cart_items.photo_id` = 베이크 크롭, `order_items` 는 photoId 를 아예 저장하지 않아 **원본 사진
참조가 카트→주문 어디에도 남지 않았다.** 이 때문에 (a) 재주문 무동작(`/api/cart/reorder` 가 `photoId:null`
반환 → CartItem 스키마 위반), (b) 확장형의 "같은 사진 다른 사이즈"·재편집 불가.

**Decision:**
원본 참조를 **기존 컬럼 재활용**으로 보존(신규 마이그레이션 0건). 인쇄 경로 무변경.
- `cart_items.photo_id` = **원본** 사진 id(베이크크롭 → 원본). `crop_transform` = **실제 변형**(identity→실제).
  `photo_url` = 베이크 크롭(인쇄 마스터 + 소유권 키) **유지**. 셋 다 기존 컬럼이라 익명/로그인 DB 라운드트립 모두 보존.
- `order_items.variant_snapshot`(jsonb)에 `sourcePhotoId` 동결(`mapOrderItem` 이 jsonb 전체 통과 → 자동 매핑).
  `OrderItemSnapshot` 에 `sourcePhotoId?`/`sourcePhotoUrl?` 추가 + 누락 `bleedMm` zod 보강(스냅샷 v2, FROZEN 옵셔널 추가).
- 재주문: `sourcePhotoId` 우선, 없으면(레거시) `photo_url`→`photos.id` 역조회(`getPhotoIdsByOriginalUrl`)로 photoId 복원.
  둘 다 실패 시 그 줄만 skip. 클라(`MyOrdersClient`)가 응답 항목을 실제 `addToCart`.

**근거(코드 검증):** 인쇄(`renderPrintFile`/`pipeline.ts`)는 `photo_url`(베이크 크롭)만 사용, `crop_transform` 미사용
(pipeline 주석 "legacy, unused"). 카트/체크아웃 UI 는 `photoId` 로 렌더 안 함. cleanup cron(013)은 anon 30일
사진만 삭제, cart/order 참조 무관. → photo_id 의미 변경은 인쇄·렌더·표시 무영향.

**Consequences:**
- (+) 마이그레이션 없이 익명·로그인 보존. 인쇄 100% 무변경. 재주문 무동작 BL 해소. CartItem 타입 무변경.
  확장형 "같은 사진 멀티사이즈" 데이터 토대 확보.
- (-) `cart_items.photo_id` FK(RESTRICT)가 베이크크롭→원본으로 이동(기존에도 베이크크롭이 FK라 회귀 아님).
  레거시 주문 재주문은 베이크크롭만 복원(원본 transform 미동결) — 재편집은 신규 주문부터.
- 검증: tsc 0 · eslint 0 · next build OK · 220 tests(신규 1: sourcePhotoId 동결 가드).

**Alternatives Considered:**
- cart_items 신규 컬럼 `source_photo_id`(035): 마이그레이션 게이트(yohan73 수동) + 미적용 시 로그인 라운드트립 소실 → 기각.
- CartItem 옵셔널 필드 추가: DB 컬럼 없어 로그인 라운드트립서 소실 → 기각.
- 베이크-온-담기 폐기 후 인쇄시 베이크: photo-only 파이프라인 재작성 고위험 → 기각.

---

## ADR-021: 확장형 상품 선결과제 2 — 세트 가격·취소 정책(CTO 확정)

**Date:** 2026-06-23
**Status:** Accepted (정책 동결; 구현은 P2/P3)

**Context:** 세트(묶음=공유 사진풀+N라인)의 할인·취소·선택 정책 미정 시 `order_items` 평면 전개 스키마(035)가
정책과 충돌 가능 → 적용 전 동결 필요(`docs/specs/extended-product.md` §9-2, §12).

**Decision (CTO 2026-06-23):**
1. **세트 할인 = 행별 비례배분.** "구성 합산 → 세트 할인 → 세트 합계"(시각화대로). 세트 할인액을 각 `order_items`
   행 가격에 비례 배분해 **행 가격 합 = 세트가** 유지(015 행당 가격 불변식 보존, 부분환불 산정 정합). 세트가는
   서버에서 `bundle_rules` 기준 재계산(클라 `setUnitPrice` 불신뢰).
2. **취소·환불 = 세트 단위(원자).** 세트는 통째로만 취소/환불(라인 부분취소 불가). 기존 B-1 고객취소와 동일 게이트.
3. **부분선택 = 세트 불가.** 장바구니/체크아웃에서 세트는 전체 단위로만 선택. **단, 같이 담긴 단품(projectId=null)은
   개별 선택 가능.**

**Consequences:** 세트 가격/취소/환불/선택 로직 단순화(원자). 행별 비례배분으로 부분환불·정산이 행 합계와 항상 일치.
구현 시 `createOrder` 가 세트가를 서버 권위로 재계산·검증(가격 변조 차단)해야 함.

**Alternatives Considered:** 대표행 할인 귀속(행 합≠세트가 → 부분환불 산정 불가, 기각). 라인 단위 취소(세트 원자성 위배,
기각). 세트 부분선택 허용(Mixtiles는 1세트/주문 격리 — 단순성 위해 불가로 채택).

---

## ADR-022: 확장형 상품 선결과제 3 — 편집 세션 무결성(localStorage 드래프트, sessionId 키)

**Date:** 2026-06-23
**Status:** Accepted (구현 완료, 검증 GREEN)

**Context:**
확장형/다건 편집은 사진 업로드·크롭·사이즈 지정에 시간이 걸려, 새로고침·탭닫기·크래시·실수 이탈로
세션(트레이/photoPool/라인)이 날아가면 작업 손실 + 이탈이 크다. studio `[orderId]` 는 draft order 가
아니라 클라 식별자라 세션이 전부 Zustand 인메모리였다. CTO가 "서비스 무결성 보장 결정"을 위임.

**핵심 무결성 변수(코드 확정):** 스튜디오 페이지의 `effectiveSessionId = user.id ?? 게스트쿠키(fs-guest-sid)
?? orderId` 는 새로고침·재진입에도 **안정적**이다(랜덤 orderId 아님). 사진 소유권은 이 sessionId 로 검증되므로,
드래프트 키를 sessionId 기준으로 잡으면 복원된 트레이의 사진이 동일 세션 소유로 남아 **결제 photo-ownership
검증이 깨지지 않는다**. (랜덤 orderId 로 키를 잡았다면 복원 시 소유권 불일치로 결제가 깨졌을 것.)

**Decision:**
**localStorage 드래프트(MVP), 키 = `(sessionId, productId)`.**
- 저장 대상: 확정 트레이 `entries`(prereq 1 의 sourcePhotoId/cropTransform 포함) + selectedOptions/variant/orientation.
  사진 본체는 이미 Storage 영속이라 가벼운 세션 상태만 저장.
- 버전키(`v1`) + 안전파싱(불일치/타productId/손상 → 폐기) + **7일 TTL**(만료 서명URL 좀비 방지).
- 마운트 시 1회 rehydrate(restoreDraft) → "이전 작업 N장 불러옴 · 새로 시작" 배너. 변경 시 디바운스 저장.
  결제 성공 시 트레이+드래프트 정리. 복원 카운트는 **zustand 스토어**에 보관(effect 내 React setState 금지 규칙 회피).
- **서버 드래프트(교차기기·공유링크)는 P2+ 로 분리** — 무결성엔 불필요, 마이그레이션 필요.

**Consequences:**
- (+) 새로고침·크래시·실수이탈 복원(손실의 ~90%)을 마이그레이션 0·서버 0·익명 지원으로 커버. 소유권 무결성 보존.
  기존 카트 localStorage(버전키) 패턴과 동일해 일관적.
- (-) 교차기기/스토리지 초기화/시크릿모드는 미복원(P2+ 서버 드래프트로 보강). 만료 TTL 후 드래프트 폐기.
- 검증: tsc 0 · eslint 0(Next.js 16 react-hooks `set-state-in-effect` 규칙 준수) · next build OK · 228 tests(신규 8).

**Alternatives Considered:** 서버 draft 테이블(교차기기·공유 가능하나 마이그레이션·anon 소유권·cleanup·서명URL
수명 관리로 고비용 → MVP 과잉, P2+로 분리). 랜덤 orderId 키(복원 시 소유권 불일치로 결제 깨짐 → 기각).

---

## ADR-023: 확장형 상품 P0 — 비파괴 기반(034/035 graceful, 추가형 계약, adminNav SSOT)

**Date:** 2026-06-24
**Status:** Accepted (구현 완료, 검증 GREEN)

**Context:**
확장형 상품(프로젝트/세트 집합) P1 편집기를 짓기 전, `docs/specs/extended-product.md` §8 의
P0(비파괴 기반)을 깐다. P0 는 FROZEN 계약(`Product`/`CartItem`/`common.ts`)에 옵셔널 추가가
필요하고 신규 마이그레이션 034/035 를 동반한다. 스펙 §10 은 "`product_type` 부재 시 `mapProduct`
가 깨지므로 graceful degrade 가 아니라 **034 적용이 P0 게이트**"라고 적었으나, 034/035 는
yohan73 계정에서 CTO 가 수동 적용해야 하고(BL-010 제약) 적용 시점이 불확실하다. 비파괴
마이그레이션의 적용 여부에 앱 가동을 묶으면 운영 리스크가 크다.

**Decision:**
**034/035 를 "적용해도/안 해도 앱이 정상"인 비게이트(non-gating)로 설계한다.** 격리/폴백:
1. **product_type(034) — `mapProduct` graceful 폴백.** `ProductRow.product_type?` 옵셔널,
   `mapProduct` 가 `row.product_type === 'extended' ? 'extended' : 'single'` 로 매핑한다. 부재/
   NULL/예상외 값은 전부 `'single'`(현행 단품 경로). 상품 SELECT 는 `product.ts` 가 `select('*')`
   라 034 적용 시 컬럼이 자동 유입되고, catalog 의 **명시적 컬럼 목록엔 product_type 을 추가하지
   않아** 미적용 시에도 쿼리가 깨지지 않는다. `Product.productType?` 는 옵셔널(기존 리터럴/픽스처
   무파손), 분기 코드는 `=== 'extended'` 로 판정 → undefined/single 이 안전한 현행 경로로 떨어짐.
2. **프로젝트 링크(035) — 카트 DB 경로 무변경.** `cart_items` SELECT/UPSERT 가 명시적 컬럼
   목록이라, 새 컬럼(project_id/project_seq/orientation)을 **추가하지 않으면** 035 미적용에서도
   카트가 정상. P0 엔 확장형 라인을 만드는 코드(편집기)가 없으므로 DB 경로를 건드릴 필요가 없다.
   035 의 실제 게이트는 P1 편집기다(라인을 생성·저장하는 시점).
3. **추가형 타입 계약(옵셔널만).** `common.ts`에 `CartProjectId`/`ProjectLocalId` 브랜드 추가(런타임
   영향 0). `product.ts`에 `PRODUCT_TYPES`/`ProductType`/`productTypeSchema`. 신규 `src/types/project.ts`
   = 확장형 도메인 SSOT(`Orientation`/`ProjectKind`/`ProjectPhotoRef`/`ProjectPricing`/`CartProject`).
   `CartItem`에 옵셔널 `projectId?`/`projectSeq?`/`orientation?` + zod 동기화. 타입 DAG 는
   `cart.ts → project.ts → product.ts → common`(런타임 순환 없음 — project.ts 는 `CartItem` 을
   **타입 전용**으로만 import).
4. **카트 localStorage v1→v2 무손실 마이그레이터.** 키 `frameshop.cart.v1`→`v2`. v2 스키마가 v1 의
   상위집합(신규 필드 옵셔널)이라, `storage.ts`가 v2 부재 시 v1 을 1회 승격하고 v1 키를 폐기(최대 1회
   실행). `clearLocalCart`도 v1 잔재를 함께 정리.
5. **adminNav SSOT.** 사이드바/모바일하단바/홈타일 3중복 라우트 목록을 `src/lib/admin/adminNav.ts`
   (순수 데이터)로 일원화. 아이콘은 표면별 글리프/크기가 달라 각 컴포넌트가 `AdminNavKey` 로 키잉한
   로컬 맵 유지(렌더 동일 보존).

**Consequences:**
- (+) 034/035 적용 여부와 무관하게 현행 단품 경로 100% 유지(회귀 0). CTO 가 적용 시점을 자유롭게
  고를 수 있고, 미적용 중에도 배포 가능. 확장형 P1 의 타입/저장 토대 확보.
- (+) 스펙 §10 의 "034=P0 하드게이트"를 graceful 로 해소(비파괴 마이그레이션을 앱 가동과 분리).
- (-) 034 미적용 동안 카탈로그가 모든 상품을 `single` 로 본다(의도된 폴백 — 확장형 SKU 가 아직 없음).
  catalog 의 명시적 SELECT 가 product_type 을 읽으려면 034 적용 확인 후 P1 에서 컬럼 추가 필요.
- (-) 035 의 cart_items/order_items 신규 컬럼은 P0 코드가 쓰지 않으므로, P1 착수 시 035 적용을
  전제로 카트 DB 경로(SELECT/UPSERT)에 컬럼을 더해야 한다(그 시점이 035 의 진짜 게이트).
- 검증: `tsc` 0 · `eslint src tests --max-warnings=0` 0 · `next build` OK · `vitest` 239 passed(신규 11:
  카트 v1→v2 마이그레이션 6 + mapProduct 폴백 5).

**Alternatives Considered:**
- 034 하드게이트(스펙 원안): 비파괴 마이그레이션에 앱 가동을 묶음 → 적용 지연 시 배포 차단. 기각.
- product_type 을 `Product` 필수 필드로: 모든 Product 리터럴/픽스처 수정 + 미적용 시 매핑 파손. 기각.
- 035 컬럼을 P0 부터 카트 SELECT/UPSERT 에 추가: 035 미적용 시 카트 쿼리 즉시 파손(격리 위배). 기각.
- cart 키 무변경(필드만 옵셔널 추가): 동작은 하나 버전 추적 부재 → 스펙의 명시적 v2 마이그레이터 채택.

---

## ADR-024: 이커머스 기본 완성 웨이브 — B-2 정책 + graceful feature-probe 패턴

**Date:** 2026-07-03
**Status:** Accepted (구현 완료, 검증 GREEN — Merge Gate/배포 대기)

**Context:**
EC 웨이브(브랜치 `feat/ecommerce-basics-photowall`, FS-EC-00~06, 컨텍스트 `shared/context/FS-EC-00~06.md`)가
B-2(적립금·부분환불·현금영수증) + 030 추가배송비 + 실판매 요건(법적고지 /terms /privacy·404·JSON-LD) +
관리자 통계 대시보드 + 포토월 시뮬레이터를 한 번에 구현한다. 마이그레이션은 CTO 수동 적용(BL-010)이라
적용 시점이 불확실하고(029~039 전부 미적용 상태 전제), B-2 는 금전 경로라 정책(적립률·환불 전이·
영수증 발급 조건)을 구현 전에 동결해야 했다.

**Decision (CTO 승인):**

*B-2/웨이브 정책:*
1. **재고 차감 제외.** 주문제작 상품이므로 재고 개념을 도입하지 않는다.
2. **포토월 = 스튜디오 딥링크.** `/wall` 은 mm 실측 Konva 벽 시뮬레이터로 배치만 담당하고, 주문은
   스튜디오 딥링크 프리셀렉트로 연결(자체 주문 플로우 미구축). 배치 상태는 localStorage v1.
3. **쿠폰·1:1문의·위시리스트는 다음 세션.**
4. **적립 1%** — `POINTS_EARN_RATE_BPS = 100`. earn 은 구매확정(`confirmPurchase`) 시 결제액 1%, 멱등.
   redeem 후 최소 결제 100원(`POINTS_MIN_PAYABLE = 100`). redeem 은 **fail-closed + 보상 트랜잭션**
   (`createOrder` 실패 시 차감분 복원).
5. **취소/환불 시 적립 회수는 관리자 수동 ADJUSTMENT.** 자동화는 후속 과제(BACKLOG §5).
6. **부분환불** — Toss `cancelAmount` + `orders.refunded_amount` 누적 + 낙관 잠금. 누적 == total 이면
   REFUNDED 전이. 단, 상태기계상 전이 불가 상태(IN_PRODUCTION/SHIPPED)면 상태 유지 + 경고 로그.
7. **현금영수증** — `income`=소득공제(개인) / `proof`=지출증빙(사업자). Toss 발급 훅은 **현금성 결제만**
   (카드 결제는 발급 대상 아님).

*graceful feature-probe 패턴(명문화 — ADR-020/023 graceful 원칙의 일반화):*
- **feature-probe**: `src/lib/db/feature-probe.ts`(server-only) — `select <column> limit 0` 으로 컬럼/테이블
  존재를 감지(42703/42P01 → false), 캐시 TTL 60초. 마이그레이션 미적용이면 해당 기능을 UI/로직에서
  숨기고, CTO 가 적용하면 **코드 배포 없이 자동 활성화**(probe 캐시 TTL 60초 내).
- **conditional-spread INSERT**: 신규 컬럼은 기능 가용 시에만 INSERT payload 에 spread — 미적용 DB 에서
  42703 을 원천 차단.
- **매퍼 폴백**: `mapOrder` 등이 신규 컬럼 부재를 0/null 로 undefined-safe 매핑.
- **서버 권위 재계산**: surcharge(추가배송비)는 `createOrder` 가 서버에서 재계산(클라 값 불신뢰),
  현금영수증 신청은 주문 저장 시 스냅샷.

**Consequences:**
- (+) 029~039 전부 미적용 상태에서도 앱 정상(현행 경로 회귀 0) — 적용 즉시 자동 활성화. 배포와
  마이그레이션 적용 시점이 완전히 분리됨(BL-010 제약 무력화).
- (+) 금전 경로 안전: redeem fail-closed+보상 트랜잭션, 부분환불 낙관 잠금, earn 멱등, surcharge 서버 재계산.
- (-) probe 캐시 TTL 60초 동안 활성화 지연(운영상 무시 가능 수준).
- (-) 적립 회수가 수동 ADJUSTMENT — 운영 부담. 자동화는 후속 과제.
- (-) IN_PRODUCTION/SHIPPED 에서 누적 환불액이 total 에 도달해도 REFUNDED 로 전이하지 못함(상태 유지
  + 경고 로그로 추적) — 통계 규칙 후속 정리 필요(BACKLOG §5).
- 검증: `tsc` 0 · `eslint src tests --max-warnings=0` 0 · `next build` exit 0 · `vitest` 413 passed
  (베이스라인 239, +174).

**Alternatives Considered:**
- **재고 차감 구현** — 기각. 주문제작(made-to-order) 상품이라 재고 개념 자체가 없음.
- **서버 드래프트** — 미채택. ADR-022 에서 P2+ 로 분리한 결정 유지.
- **settings 토글 방식(probe 대신 app_settings 플래그)** — 기각. 마이그레이션 적용 후 CTO 가 토글을
  따로 켜야 하는 수동 운영 부담. probe 는 스키마 존재 자체가 활성 신호라 운영 개입 0.

**Postscript (2026-07-03):** 적대 리뷰(Security+Final, `shared/audit/FS-EC-security.md`·`FS-EC-final.md`)가
**P0 1건**을 적발했고 수정이 랜딩됐다: `/api/orders` route 가 `redeemPoints`/`receipt` 를 `createOrder` 로
전달하지 않던 **브리지 공백** → 필드 전달 + `POINTS_*`/`RECEIPT_*` 에러 422 매핑 + 라우트 seam 통합
테스트 신설. 아울러 Decision 5(적립 회수 = 관리자 수동 ADJUSTMENT)가 **자동 회수로 격상**됐다:
전액 환불·취소(고객취소/관리자 전액환불/부분환불 누적==전액 REFUNDED 전이/관리자 취소) 시
`reversePointsForOrder` 가 사용분 복원(ADJUSTMENT+)·적립분 회수(REFUND−)를 수행 — `(order_id, type)`
멱등, fire-and-forget, 031 미적용 시 skip. **부분환불(누적<전액)은 무조정**(문서화된 한계 — 비례 조정
정책 미정, BACKLOG §5). 보정 후 최종 검증: `vitest` 451 passed | 14 todo (2026-07-03 직접 실행 확인 — 관리자취소 회수 테스트 +4 포함).

---

## ADR-025: 확장형 P1 편집기 — 라인 단위 옵션 계약(FROZEN 옵셔널 확장) + 모드 분기 + 드래프트 v2

**Date:** 2026-07-06
**Status:** Accepted (FS-P1-00 계약 동결 — 구현은 FS-P1-01~03)

**Context:**
확장형 P1 편집기(웨이브 `shared/context/FS-P1-wave.md`)는 한 편집 세션에서 멀티포토 업로드(사진풀) →
라인별 독립 사이즈/방향/수량(혼합) → 묶음 담기를 지원해야 한다(CTO 케이스 1~4). 이를 위해 FROZEN
계약(`EditorPhotoEntry`/`OrderItemSnapshot`/드래프트)에 확장이 필요하고, 마이그레이션 034/035 는
미적용 가능(BL-010)이라 graceful 폴백(ADR-023/024 패턴)이 전제다. **베이직(단품) 경로 회귀 0** 이
웨이브 불변식이다. ADR-022 의 드래프트 키에는 `v1` 이 문자열로 박혀 있어(`frameshop.editor.draft.v1`)
스키마 진화 방법을 정해야 했다.

**Decision:**
1. **모드 분기 — 스토어 `kind: 'basic' | 'extended'`** (`EditorKind`, src/types/editor.ts). 스튜디오
   진입 URL `mode=multi` 로 init 시 결정, 기본 `'basic'`. `basic` 은 현행 코드 문자 그대로
   (setSize/setOrientation 의 `entries:[]` 초기화 유지, 사진풀/라인 UI 미렌더). `extended` 만
   entries 초기화를 건너뛰고(라인별 독립) 전역 옵션 변경은 "새 라인 기본값" 컨텍스트만 바꾼다.
2. **라인 단위 옵션 = `EditorPhotoEntry` 옵셔널 확장(FROZEN 무파손).** `selectedOptions?:
   SelectedOptions` + `orientation?: 'portrait'|'landscape'`. basic 라인은 undefined → 전역 옵션
   사용(현행), extended 라인은 항상 채움. 가격은 `sum(price_i × qty_i)` — entry 에 옵션이 있으면
   라인별 가격, 없으면 전역 가격. orientation 은 project.ts `Orientation` 과 의미 동일하지만
   project.ts 가 editor.ts 의 `CropTransform` 을 이미 type-import 하므로(역참조 = 순환) editor.ts
   에는 리터럴 유니온으로 둔다.
3. **variantId 는 파생값 — 저장하지 않는다.** 라인의 variant 는
   `variantsByKey[variantKey(selectedOptions)]` 로 항상 파생한다. entry 에 variantId 를 함께
   저장하면 options 와 이중 진실이 되어 옵션 변경 시 불일치 버그의 온상이 된다.
4. **드래프트 v2 — 키 유지 + payload `version` 필드 판별(무손실 자동 승격).** 키
   `frameshop.editor.draft.v1` 의 `v1` 은 **의도적으로 유지**한다: 키를 바꾸면 기존 사용자의
   드래프트가 전부 고아가 되어 소실된다. 대신 payload 의 `version` 으로 v1|v2 를 판별하고, v1 은
   로드 시 `migrateEditorDraftV1` 로 v2 승격(kind:'basic', photoPool 없음 — 손실 0, 저장소 재기록은
   다음 save). v2 = `{kind, photoPool?, entries(라인 옵션 포함), ...v1 필드}`. save 는 항상 v2 로
   기록하며 `kind` 미지정 시 'basic'(기존 호출부 시그니처 무파손). 빈 세션 판정은 "entries **와**
   photoPool 모두 빈 경우"로 확장(확장형은 라인 확정 전 사진풀만 채운 상태도 복원 가치). TTL 7일·
   안전파싱·(sessionId, productId) 키 등 ADR-022 골격은 그대로.
5. **묶음 담기 — 클라 `projectLocalId` → 서버 `project_group_id`.** extended 담기 시 세션당 1회
   `projectLocalId = crypto.randomUUID()` 로 라인 N개를 `addToCart({projectId: projectLocalId,
   projectSeq: i, orientation})`(CartItem 옵셔널 필드, P0). `createOrder` 는 cartItems 를 projectId
   로 그룹핑해 그룹당 서버 `project_group_id = randomUUID()` 를 새로 부여한다(카트는 휘발, 주문은
   영구 — 클라 id 를 신뢰하지 않음). 세트 할인 없음(P1, ADR-021) → 라인별 개별 CartItem 이라 기존
   서버 가격 재검증(PRICE_MISMATCH)이 라인별로 그대로 동작(신규 가격 경로 0).
6. **주문 스냅샷 jsonb 동결 — 035 미적용에서도 묶음 보존.** `OrderItemSnapshot` 옵셔널 확장:
   `orientation?`/`projectSeq?`/`groupLabel?`(+ zod 동기화, 기존 bleedMm/sourcePhotoId 패턴).
   createOrder 가 variant_snapshot(jsonb)에 동결하므로 **마이그레이션 불필요**하게 묶음 정보가
   주문에 영구 보존되고, 035 적용 시(probe) 전용 컬럼(project_group_id/project_seq/orientation)에도
   conditional-spread 로 기록한다.
7. **로그인 카트 동기화 = probe 폴백(CTO 확정).** `isProjectCartAvailable()`(feature-probe,
   cart_items.project_id — 035 는 034 의 cart_projects FK 를 참조하므로 단일 probe 로 034+035 판별)
   가 true 면 cart_projects 헤더 upsert 후 cart_items 에 project 컬럼 포함 upsert(FK 순서: 헤더
   먼저), false 면 project 필드 생략(평면 저장 — 묶음 정보는 6의 주문 스냅샷에 보존되므로 유실
   아님). 익명 카트는 localStorage v2 로 034/035 무관 완전 동작.

**Consequences:**
- (+) FROZEN 계약 전부 옵셔널 확장 — 기존 리터럴/픽스처/호출부 무파손, 베이직 경로 회귀 표면 0.
- (+) 드래프트/카트/주문 모두 마이그레이션 적용 여부와 분리(graceful) — 배포 자유, CTO 적용 즉시
  probe 로 자동 활성화. 기존 v1 드래프트 손실 0.
- (+) variantId 파생 원칙으로 라인 옵션의 단일 진실 확보(이중 진실 버그 예방).
- (-) 035 미적용 동안 로그인 카트의 묶음 구조가 DB 에 평면 저장된다(교차기기에서 묶음 시각화 불가 —
  주문 시점 스냅샷으로는 보존). 문서화된 한계.
- (-) groupLabel 등 스냅샷 필드의 생성 규칙은 backend(FS-P1-02) 구현 재량(계약은 옵셔널 string).
- 검증(FS-P1-00 범위): `tsc` 0 · `eslint`(수정 파일) 0 · `vitest` 466 passed | 14 todo
  (베이스라인 451 무파손, 신규 15: 드래프트 v1→v2 승격/라운드트립/손상폐기 9 + 스냅샷 스키마 6).

**Alternatives Considered:**
- **별도 extended 스토어(useExtendedEditorStore):** 기각 — 업로드/크롭/드래프트/프리셀렉트 로직
  중복 + ADR-022 드래프트·딥링크 프리셀렉트를 재구현해야 함. 단일 스토어 + kind 분기가 회귀 표면이
  더 작다.
- **entry 에 variantId 저장:** 기각 — selectedOptions 와 이중 진실. 옵션 수정 시 두 값의 동기화
  버그 위험. 파생(variantsByKey)으로 충분.
- **서버 드래프트:** 기각 — ADR-022 에서 P2+ 로 분리한 결정 유지(마이그레이션·anon 소유권·cleanup
  비용, 무결성엔 불필요).
- **드래프트 키를 v2 로 bump:** 기각 — 키에 v1 이 박혀 있어 키 변경 시 기존 드래프트 전부 소실.
  payload version 필드 판별 + 로드 시 자동 승격(손실 0)을 채택.

**Postscript (2026-07-06):** Final 감사 P0-001 이 Decision 7 의 폴백 계약 불성립을 적발했다 —
로그인 + probe false(034/035 미적용 = 현 프로덕션)에서 `getCart` 가 DB 의 평면 items 만 반환해
체크아웃 페이로드에 projectId 가 실리지 않았고, Decision 6 의 "주문 스냅샷 동결로 보존" 주장이
구현과 모순이었다(묶음 메타 영구 소실). 수정: `getCart` 로그인 경로가 DB items 를 localStorage
미러와 **localId 로 병합**한다(`mergeProjectFieldsFromMirror`, src/lib/cart/client.ts) — DB 항목이
평면이고 미러의 동일 localId 항목에 projectId 가 있으면 projectId/projectSeq/orientation 만 주입
(가격/수량 등 서버 값 우선), DB 가 projectId(서버 헤더 PK)를 반환하면(probe true) DB 가 SSOT 라
병합하지 않는다. **잔여 한계(문서화):** 담은 기기와 다른 기기(교차 기기)에는 미러가 없어 병합
불가 — 그 주문은 묶음 메타 없이 평면 생성된다. 034/035 적용 시 자연 해소되므로 CTO 적용이 근본
해법이다. 함께 반영(Security 감사): ① P1-001 — `cartItemSchema` 를 DB 타입에 정합하게 강화
(`projectId`/`productId` = `z.string().uuid()`, `projectSeq` = `.max(9999)`; 실값이 전부
uuid(gen_random_uuid/crypto.randomUUID)라 정상 클라이언트 무파손) + `/api/cart` POST 에
try/catch·에러 정제 매핑(22P02/22003/23503 류 → 400 INVALID_REFERENCE, 그 외 → 500
CART_WRITE_FAILED, raw 메시지는 서버 로그 전용). ② P2-002 — `upsertCartProject` 에 PK 에코 가드
(projectLocalId 가 기존 헤더 PK 와 일치하면 재사용, 중복 헤더 봉인). ③ P2-005 정책 명시 —
**멀티 CTA("여러 장 만들기")는 `product_type` 게이트 없이 모든 단품에 개방한다.** 이는 스펙
§3(docs/specs/extended-product.md)의 "일반 다조합은 일반 상품에서 CTA 로 진입" 의도 그대로이며
드리프트가 아니다(가격은 라인별 variant 서버 재검증으로 보호 — 금전 경로 무관).

---

_(이후 ADR은 Architect/Orchestrator가 필요 시 추가)_
