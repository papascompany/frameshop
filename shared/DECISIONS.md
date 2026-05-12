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
**Status:** Accepted
**Context:** order.md AC-2: 같은 날 시퀀스가 동시성 안전해야 함. Postgres advisory lock vs sequence table 검토.
**Decision:** `order_sequences(day date PK, seq int)` 테이블. 발급 시 `INSERT ... ON CONFLICT (day) DO UPDATE SET seq = order_sequences.seq + 1 RETURNING seq` 한 줄로 atomic. KST 기준 day.
**Consequences:**
- (+) advisory lock보다 디버그 친화적 (테이블 조회로 진행상황 확인 가능)
- (+) 트랜잭션 내 한 statement로 race 안전
- (-) day 자정 경계 정확성은 애플리케이션 layer의 KST 변환에 의존.

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

_(이후 ADR은 Architect/Orchestrator가 필요 시 추가)_
