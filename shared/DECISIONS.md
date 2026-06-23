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

_(이후 ADR은 Architect/Orchestrator가 필요 시 추가)_
