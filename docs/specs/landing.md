# Module: Landing

## Purpose
M-Landing은 FrameShop의 첫인상을 결정하는 반응형 메인 페이지 모듈이다. ADR-007(큐레이션 별도 테이블)에 따라 `curations` 테이블에서 type/device/기간 조건으로 활성 큐레이션을 조회하고, 세 가지 컴포넌트로 노출한다: **HeroBanner**(반응형 비율, PC 16:6 / Mobile 4:5), **CategoryGrid**(M-Catalog의 활성 카테고리 + 대표 상품 썸네일), **FeaturedCollection**(추천 상품 묶음). Phase 1은 CategoryGrid만 필수이고, HeroBanner와 FeaturedCollection은 어드민이 큐레이션을 등록한 경우에만 노출된다. SSR + ISR(revalidate 600s, Phase 2)로 SEO와 성능을 보장한다.

## User Stories
- B2C 구매자(모바일)로서, 메인 화면에 진입했을 때 4:5 비율의 큰 배너 이미지가 즉시 보이고, 아래로 스크롤하면 카테고리/추천 컬렉션이 자연스럽게 이어지길 원한다.
- B2C 구매자(PC)로서, 16:6 와이드 배너로 PC 화면을 답답하지 않게 채우고 가로 레이아웃을 보고 싶다.
- B2C 구매자로서, 카테고리 그리드를 보고 "베이직 액자"를 탭하면 해당 카탈로그로 즉시 이동하고 싶다.
- B2C 구매자로서, FeaturedCollection 추천 상품 카드를 보고 호기심에 진입하고 싶다.
- 운영자로서, 어드민에서 신규 배너를 등록하면 메인 페이지에 즉시 반영되길 원한다.
- 운영자로서, 시즌 이벤트가 끝나면(end_at) 별도 작업 없이 자동으로 배너가 사라지길 원한다.
- 운영자로서, 같은 시점에 PC 전용 배너와 모바일 전용 배너를 별도로 등록하고 싶다.
- B2C 구매자로서, 메인 페이지가 빠르게(LCP < 2.5s) 로드되어 답답함이 없길 원한다.

## Acceptance Criteria
1. **GIVEN** 사용자가 `/`에 진입한다 **WHEN** Phase 1 시점이고 어드민이 등록한 큐레이션이 없다 **THEN** CategoryGrid만 렌더되고 HeroBanner/FeaturedCollection 영역은 노출되지 않는다(빈 공간 아님, 컴포넌트 자체 미렌더링).
2. **GIVEN** 모바일 뷰포트(375px)에서 진입한다 **WHEN** `getActiveCurations('mobile', now)`가 호출된다 **THEN** `device IN ('all','mobile')` AND `is_active=true` AND `start_at <= now AND (end_at IS NULL OR end_at > now)`인 큐레이션만 반환된다.
3. **GIVEN** PC 뷰포트(1280px) 진입 **WHEN** 동일 조회 **THEN** `device IN ('all','pc')` 필터 적용. mobile 전용 배너는 제외.
4. **GIVEN** banner type 큐레이션 2건이 활성 상태다 **WHEN** HeroBanner 컴포넌트가 렌더된다 **THEN** `sort_order` 오름차순으로 정렬되어 캐러셀 또는 단일 배너로 표시된다(Phase 1: 단일 표시, Phase 2: 캐러셀).
5. **GIVEN** CategoryGrid가 마운트된다 **WHEN** `getCategories()`(M-Catalog 위임) 호출 **THEN** 활성 카테고리가 그리드(모바일 2열, PC 4열)로 표시되며 각 카드에는 카테고리 이름 + 대표 상품 1건의 썸네일이 보인다.
6. **GIVEN** 카테고리 카드를 탭한다 **WHEN** 클릭 이벤트 **THEN** `/catalog/<slug>`로 라우팅된다.
7. **GIVEN** collection type 큐레이션이 활성이고 `payload.productIds = ['p1','p2','p3']`이다 **WHEN** FeaturedCollection 렌더 **THEN** 해당 상품 카드 3건이 가로 스크롤 또는 그리드로 노출된다. 비활성 상품은 자동 제외.
8. **GIVEN** banner의 `payload.imageUrl`이 잘못된 URL이다 **WHEN** 이미지 로드 실패 **THEN** onError로 플레이스홀더 표시 + 페이지는 정상 동작.
9. **GIVEN** 큐레이션 payload 스키마가 type별로 다르다 **WHEN** 렌더링한다 **THEN** Zod 스키마로 type별 분기 검증 후 분기 렌더. 검증 실패 시 해당 큐레이션 무시(전체 페이지는 정상).
10. **GIVEN** 페이지 첫 로드 **WHEN** LCP 측정 **THEN** 모바일 4G 환경에서 < 2.5s 목표(PLAN.md §8.5). HeroBanner 이미지는 `priority` + `loading="eager"`, 다른 이미지는 lazy.
11. **GIVEN** 어드민이 banner를 등록 직후 **WHEN** 사용자가 페이지를 새로고침한다 **THEN** Phase 1은 SSR로 즉시 반영(no cache), Phase 2는 ISR `revalidateTag` 또는 600s 후 반영.
12. **GIVEN** 큐레이션이 0건이고 카테고리도 0건이다 **WHEN** 페이지가 렌더된다 **THEN** "곧 새로운 액자가 준비됩니다" 빈 상태 + 푸터 영역은 정상 표시.

## Edge Cases
- **device 판별:** 서버에서 user-agent로 판별 시 부정확 → 클라이언트 뷰포트 폭으로 결정. SSR은 `device='all'` 우선 렌더, 클라이언트 hydrate 시점에 device 분기 큐레이션을 fetch하여 hydration mismatch 회피. **자율 결정:** 또는 `device='all'`을 기본으로 SSR하고, mobile/pc 전용은 클라이언트에서 추가 fetch.
- **시간대:** `start_at`/`end_at`은 timestamptz로 저장. KST 기준 운영자 입력을 자동 변환.
- **payload 자유 스키마 위험:** 타입별 Zod 스키마(`BannerPayload`, `CollectionPayload`, `FeaturePayload`)로 런타임 검증. 검증 실패 시 해당 큐레이션 skip + Sentry 로그.
- **collection의 productIds 미존재 상품:** 유효한 활성 상품만 필터링하여 표시.
- **이미지 최적화:** Next.js `<Image>` 컴포넌트 사용. Supabase Storage URL을 `next.config.js remotePatterns`에 추가.
- **A/B 테스트:** Phase 4. Phase 1은 단일 배포.
- **다중 배너 캐러셀:** Phase 1은 첫 1건만 표시(sort_order 0). Phase 2에서 자동 슬라이드.
- **검색/네비게이션:** 헤더에 검색 바와 메뉴는 별도 레이아웃 컴포넌트 책임(M-Landing은 본문만).
- **푸터 정보:** 회사 정보/약관/문의 등은 별도 Footer 컴포넌트(M-Landing 책임 아님).
- **빈 상태 메시지 다양성:** 카테고리 0건과 큐레이션 0건은 메시지 차별화(자율 결정: Phase 1 단일 메시지로 통일).
- **CategoryGrid 대표 상품 선정:** 카테고리별 `sort_order=0` 또는 가장 최근 활성 상품 1건. M-Catalog에서 헬퍼 함수 추가 검토.

## Out of Scope
- **개인화 추천(추천 알고리즘)** — Phase 3.
- **최근 본 상품** — Phase 3.
- **베스트셀러 자동 산정** — Phase 3 (리뷰/판매 데이터 이후).
- **A/B 테스트 분기** — Phase 4.
- **RecentReviews 컴포넌트** — Phase 2 (리뷰 시스템 이후).
- **다국어 큐레이션** — Phase 4.
- **검색 바 / 헤더 / 푸터** — 레이아웃 영역, M-Landing 범위 외.
- **인스타그램/소셜 피드 연동** — Out of Scope.
- **메인 페이지 SEO 메타 자동 생성** — Phase 2.
- **HeroBanner 캐러셀(다중 슬라이드)** — Phase 2.

## Dependencies
- **Depends on:**
  - Supabase 테이블: `curations` (PLAN.md §6, RLS: 누구나 SELECT, 관리자만 변경)
  - M-Catalog — `getCategories()`, `getProductsByCategory()` 일부 재사용
  - `src/types/curation.ts` — `Curation`, `CurationType`, `BannerPayload`, `CollectionPayload`, `FeaturePayload` (Architect 신규)
  - Next.js `<Image>` + Supabase Storage `remotePatterns`
  - M-Admin (큐레이션 등록 UI)
- **Used by:**
  - 페이지: `app/(shop)/page.tsx`

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다.

- `getActiveCurations(device: 'pc' | 'mobile' | 'all', now: Date): Promise<Curation[]>`
  - **동작:**
    - WHERE `is_active=true`
    - AND `device IN (<device>, 'all')` (device='all' 입력 시 모든 device)
    - AND `(start_at IS NULL OR start_at <= now)`
    - AND `(end_at IS NULL OR end_at > now)`
    - ORDER BY `sort_order ASC, created_at DESC`
  - **반환:** Curation 배열 (payload는 `jsonb`, 타입별 분기는 컴포넌트에서)

- `<HeroBanner curation={Curation | null} />`
  - **동작:** Phase 1은 단일 배너. `payload.imageUrl`/`link`/`title` 추출 후 반응형 비율(PC 16:6, Mobile 4:5)로 렌더. `Image priority`.
  - **null 입력:** 컴포넌트 자체 미렌더(부모가 null 체크).

- `<CategoryGrid categories={Category[]} />` (Server Component)
  - **동작:** 모바일 2열 / PC 4열 그리드. 각 카드 클릭 시 `/catalog/<slug>` 라우팅.

- `<FeaturedCollection curation={Curation} />`
  - **payload 검증:** Zod `CollectionPayload` 스키마. 검증 실패 시 컴포넌트 미렌더.
  - **동작:** `productIds`로 상품 batch fetch → 활성 상품만 카드 렌더 → 가로 스크롤(모바일) 또는 그리드(PC).

- `<LandingPage />` (Server Component, `app/(shop)/page.tsx`)
  - **내부:**
    1. 서버 측 `getCategories()` + `getActiveCurations('all', new Date())` 병렬 fetch
    2. SSR: device 무관 결과 + 클라이언트 hydrate 시 추가 분기 큐레이션 lazy fetch (자율 결정)
    3. 큐레이션 type별 분기 렌더링

- `validateCurationPayload(type: CurationType, payload: unknown): Result` (런타임 검증)
  - **타입별 스키마:**
    - `BannerPayload`: `{ imageUrl: string; link?: string; title?: string; subtitle?: string }`
    - `CollectionPayload`: `{ productIds: string[]; subtitle?: string }`
    - `FeaturePayload`: `{ productId: string; pitch: string }`

## Test Scenarios

### Unit (Vitest)
- `getActiveCurations('mobile', now)`: device='mobile'와 'all'만 반환, 'pc'는 제외.
- `getActiveCurations` 기간 필터: end_at 지난 큐레이션 제외.
- `getActiveCurations` 기간 필터: start_at 미래 큐레이션 제외.
- `getActiveCurations` 정렬: sort_order 동일 시 created_at DESC.
- `validateCurationPayload` Banner: imageUrl 누락 → invalid.
- `validateCurationPayload` Collection: productIds 빈 배열 → invalid.
- `validateCurationPayload` 미지원 type → invalid.

### Integration (Testing Library)
- `<LandingPage>` 마운트(어드민 큐레이션 0건) → CategoryGrid만 렌더.
- `<LandingPage>` 마운트(banner 1건 활성) → HeroBanner + CategoryGrid 렌더.
- `<HeroBanner>` payload imageUrl 오류 → onError 플레이스홀더 표시 + 다른 영역 정상.
- `<FeaturedCollection>` 잘못된 payload → 컴포넌트 미렌더 + 페이지 정상.
- `<CategoryGrid>` 카테고리 0건 → "곧 새로운 액자가 준비됩니다" 빈 상태.

### E2E (Playwright)
- **E2E-Landing-01 (모바일 375px, PLAN.md E2E-05):** `/` 진입 → 모바일 전용 배너 + CategoryGrid 노출. 카테고리 카드 탭 → /catalog/... 라우팅.
- **E2E-Landing-02 (PC 1280px):** PC 전용 배너 16:6 비율 + 4열 CategoryGrid 노출.
- **E2E-Landing-03:** 어드민에서 새 배너 등록 → 사용자 페이지 새로고침 → 즉시 반영(Phase 1 SSR).
- **E2E-Landing-04:** 기간 만료 배너는 메인에 노출되지 않음.
- **E2E-Landing-05 (성능):** 모바일 4G throttle 환경에서 LCP < 2.5s 측정.
- **E2E-Landing-06:** 큐레이션 0건 + 카테고리 0건 → 빈 상태 메시지 + 푸터 정상.
