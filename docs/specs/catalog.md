# Module: Catalog

## Purpose
M-Catalog은 FrameShop의 상품 진입점이다. 카테고리 트리(parent_id 자가참조)와 상품 목록을 읽기 전용으로 노출하며, 사용자가 액자 종류를 탐색하고 상품 상세로 진입할 수 있게 한다. 메인/카테고리/카탈로그 페이지에 사용되며, "프레임 있음/없음" 분류와 `is_active`/`sort_order` 정렬 규칙을 강제한다. Phase 1 MVP에서는 1개 카테고리 + 1개 상품 시드만 노출되어도 충족되도록 단순하게 설계한다.

## User Stories
- B2C 구매자로서, 모바일에서 메인 화면에 진입했을 때 활성화된 카테고리 목록과 대표 액자 상품을 즉시 보아 "어떤 액자가 있는지" 빠르게 파악하고 싶다.
- B2C 구매자로서, 카테고리(예: "베이직액자")를 탭했을 때 해당 카테고리의 상품 카드(썸네일/이름/시작가)를 그리드로 보고 원하는 상품을 고르고 싶다.
- B2C 구매자로서, "프레임 있음/없음" 같은 큰 분류로 상품을 좁혀보고 싶다.
- B2C 구매자로서, 상품이 많을 때 페이지네이션(또는 무한 스크롤) 없이는 한 번에 모두 로드되지 않아 빠르게 탐색하고 싶다.
- 운영자로서, 어드민에서 `is_active = false`로 내린 상품과 카테고리가 사용자 화면에서 즉시 사라지길 원한다.
- 운영자로서, `sort_order` 값을 바꿔 진열 순서를 통제하고 싶다.
- B2C 구매자(PC 사용자)로서, 같은 카탈로그를 데스크탑에서도 동일한 큐레이션 경험으로 보고 싶다(레이아웃은 가운데 정렬 허용, Phase 2에서 PC 최적화).

## Acceptance Criteria
1. **GIVEN** `categories` 테이블에 `is_active=true`인 카테고리 3개와 `is_active=false`인 카테고리 1개가 있다 **WHEN** `getCategories()`를 호출한다 **THEN** 활성 카테고리 3개만 반환되며 `sort_order` 오름차순 정렬되어야 한다.
2. **GIVEN** 카테고리 A의 자식 카테고리 B, C가 존재한다 **WHEN** `getCategories()`를 호출한다 **THEN** A의 자식 노드로 B, C를 포함한 트리 구조가 반환되어야 한다 (`parentId === A.id`).
3. **GIVEN** 카테고리 slug `basic-frame`에 `is_active=true` 상품 5개가 등록되어 있다 **WHEN** `getProductsByCategory('basic-frame', { page: 1, pageSize: 20 })`를 호출한다 **THEN** 5개 상품이 `sort_order` 오름차순, 동률 시 `created_at` 내림차순으로 반환되어야 한다.
4. **GIVEN** 카테고리에 `is_active=false`인 상품 2개가 섞여 있다 **WHEN** `getProductsByCategory(slug)`를 호출한다 **THEN** 비활성 상품은 반환 목록에 포함되지 않아야 한다.
5. **GIVEN** 한 카테고리에 상품이 30개 있다 **WHEN** `getProductsByCategory(slug, { page: 1, pageSize: 20 })`를 호출한다 **THEN** 첫 20개만 반환되고, `hasMore: true`, `total: 30`이 함께 반환되어야 한다.
6. **GIVEN** 옵션 `{ hasFrame: true }`를 전달한다 **WHEN** `getProductsByCategory(slug, { hasFrame: true })`를 호출한다 **THEN** `products.has_frame = true`인 상품만 반환되어야 한다.
7. **GIVEN** 존재하지 않는 slug `'unknown-cat'`을 전달한다 **WHEN** `getProductsByCategory('unknown-cat')`를 호출한다 **THEN** 빈 배열 `[]`과 `total: 0`을 반환해야 하며 throw 하지 않아야 한다.
8. **GIVEN** 상품명에 "베이직"을 포함하는 상품 2개가 활성 상태로 있다 **WHEN** `searchProducts('베이직')`를 호출한다 **THEN** 두 상품 모두 반환되며, `is_active=false`인 상품은 제외되어야 한다.
9. **GIVEN** 검색 쿼리가 빈 문자열 `''` 또는 공백뿐이다 **WHEN** `searchProducts('')`를 호출한다 **THEN** 빈 배열을 반환해야 한다 (전체 상품 덤프 금지).
10. **GIVEN** 각 상품의 `product_images`에 `type='thumbnail'` 1건이 등록되어 있다 **WHEN** `getProductsByCategory(slug)`를 호출한다 **THEN** 각 상품 객체에 `thumbnail` URL이 포함되어야 하며, 썸네일이 없으면 `null`이어야 한다.

## Edge Cases
- **빈 카테고리:** 활성 카테고리이지만 상품이 0개일 때 → 빈 배열 + `total: 0` 반환, UI는 "곧 새로운 상품이 등록됩니다" 빈 상태 표시(컴포넌트 책임, 데이터 레이어는 그저 빈 결과).
- **비활성 상품 노출 금지:** `products.is_active=false`는 어떤 호출에서도 노출되지 않아야 한다. RLS와 쿼리 조건 양쪽에서 차단(이중 안전망).
- **고아 카테고리:** `parent_id`가 가리키는 부모 카테고리가 `is_active=false`인 경우 → 자식 카테고리는 트리에서 분리되어 루트로 올라가지 않고, 응답에서 함께 숨긴다(부모가 죽으면 자식도 숨김).
- **페이지네이션 경계:** `page=0` 또는 음수, `pageSize > 100`은 거부하고 기본값(`page=1`, `pageSize=20`)으로 대체. `pageSize` 상한 100.
- **정렬 동률 처리:** `sort_order` 동일 시 `created_at DESC` 보조 정렬을 적용해 결과 순서가 결정적이도록 한다(테스트 안정성).
- **검색 인젝션:** SQL/ILIKE 검색에서 사용자 입력 이스케이프 필수(`%`, `_` 와일드카드 이스케이프). Supabase 클라이언트 파라미터 바인딩 활용.
- **검색 결과 상한:** `searchProducts`는 최대 50건으로 잘라 반환(Phase 1, 페이지네이션 미지원).
- **모바일/PC 차이:** 데이터 레이어는 동일. 카드 그리드 컬럼 수만 컴포넌트에서 분기(모바일 2열, PC 가운데 정렬된 최대 4열). 디바이스별 데이터 분기 없음(`curations`와는 별개).
- **대용량 썸네일:** Supabase Storage 원본이 5MB 이상이어도 URL만 반환. 실제 리사이즈는 Storage transform 또는 Phase 2 CDN 변환에 위임.
- **카테고리 깊이 폭주:** 트리 최대 깊이 3단계까지 보장(루트 → 중간 → 리프). 그 이상은 재귀를 끊고 평면화하여 반환(현재 데이터 모델상 발생 가능성 낮음, 가드만 둠).

## Out of Scope
- **고급 검색** (가격대 필터, 색상 필터, 태그 검색) — Phase 2 이후.
- **큐레이션 노출** (시즌 배너, 추천 컬렉션) — `curations` 테이블 기반의 별도 모듈 M-Landing 책임 (ADR-007).
- **개인화 추천 / 최근 본 상품** — Phase 3.
- **재고 수량 표시 / 품절 표시** — `product_variants.stock` 기반, M-ProductDetail 책임. M-Catalog는 활성 여부만 본다.
- **다국어** — Phase 4.
- **ISR / SEO 메타 최적화** — Phase 2 정식 적용. Phase 1은 SSR fallback 허용.
- **무한 스크롤 UX** — Phase 1은 일반 페이지네이션(또는 첫 페이지만 렌더링). 무한 스크롤은 Phase 2.
- **리뷰 평점 / 판매량 정렬** — Phase 3 (리뷰 시스템 이후).

## Dependencies
- **Depends on:**
  - Supabase (read-only): `categories`, `products`, `product_images` 테이블 (스키마는 `docs/PLAN.md` §6).
  - `src/types/product.ts` — `Category`, `Product` 타입 (Architect가 동결).
  - RLS 정책: `categories`, `products`, `product_images`에 대해 누구나 SELECT 가능 (§6.1).
- **Used by:**
  - M-ProductDetail — 상품 ID로 상세 진입 시 `Product` 기본 정보 재사용.
  - M-Landing — 메인 카테고리 그리드 렌더링.
  - 페이지: `app/(shop)/page.tsx` (랜딩), `app/(shop)/catalog/[slug]/page.tsx` (카테고리).

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다. 본문은 Backend Dev가 구현.

- `getCategories(): Promise<Category[]>`
  - **동작:** 활성 카테고리 전체를 트리 구조로 반환. 루트(`parentId === null`)부터 자식 노드를 `children: Category[]` 형태로 중첩. `sort_order` 오름차순.
  - **반환 타입 확장:** `Category & { children: Category[] }` 형태의 재귀 트리.
  - **캐싱:** Phase 2에서 ISR `revalidate: 600` 적용 예정.

- `getProductsByCategory(slug: string, options?: ListOptions): Promise<ProductListResult>`
  - **ListOptions:**
    - `page?: number` (기본 1, 최소 1)
    - `pageSize?: number` (기본 20, 최대 100)
    - `hasFrame?: boolean` (프레임 있음/없음 필터)
    - `sort?: 'default' | 'priceAsc' | 'priceDesc' | 'newest'` (기본 `'default'` = `sort_order, created_at DESC`)
  - **ProductListResult:** `{ items: Product[]; total: number; hasMore: boolean; page: number; pageSize: number }`
  - **동작:** 카테고리 slug로 활성 카테고리 조회 → 해당 `category_id`의 활성 상품 페이지네이션. 각 상품에 대표 썸네일 URL(`product_images.type='thumbnail'`, `sort_order=0`) 조인.

- `searchProducts(query: string): Promise<Product[]>`
  - **동작:** `name` ILIKE 부분 일치 검색 (활성 상품만, 최대 50건). 빈 문자열/공백은 빈 배열 반환. 정렬은 `name` 시작 일치 우선 → `sort_order`.
  - **Phase 1:** 단순 ILIKE. **Phase 2:** PostgreSQL `tsvector` 전문 검색으로 업그레이드 검토.

## Test Scenarios

### Unit (Vitest)
- `getCategories` 활성 필터: `is_active=false` 카테고리가 결과에서 제외된다.
- `getCategories` 트리 빌딩: `parent_id` 기반 재귀 트리 구조가 올바르다 (mock 데이터로 검증).
- `getCategories` 정렬: `sort_order` 동률 시 결정적 보조 정렬이 적용된다.
- `getProductsByCategory` 페이지네이션 경계: `page=0`, `pageSize=999` 입력 시 기본값으로 정규화된다.
- `getProductsByCategory` `hasFrame` 필터: true/false/undefined 각각 결과 셋이 다르다.
- `getProductsByCategory` 빈 카테고리: `total: 0`, `hasMore: false`, `items: []`.
- `searchProducts` 빈 입력: `''`, `'   '`, `null`(가드) → 빈 배열.
- `searchProducts` 와일드카드 이스케이프: `%`, `_` 포함 쿼리가 리터럴로 처리된다.
- 썸네일 조인: `product_images` 없는 상품은 `thumbnail: null`.

### Integration (Testing Library + Supabase test client)
- 시드 데이터(카테고리 1 + 상품 1)로 `getProductsByCategory('basic-frame')`이 1건 반환.
- 활성/비활성 토글 후 즉시 결과 셋 변경 확인 (어드민 즉시 반영 보장).
- 카테고리 페이지(`app/(shop)/catalog/[slug]/page.tsx`) 렌더링 시 상품 카드 컴포넌트가 정상 마운트되고 썸네일 src가 채워진다.
- 검색 폼 컴포넌트 → `searchProducts` 호출 → 결과 카드 렌더링까지 통합.

### E2E (Playwright)
- **E2E-Catalog-01 (모바일 375px):** 랜딩 진입 → 카테고리 그리드 노출 → 첫 카테고리 탭 → 카탈로그 페이지로 이동 → 상품 카드(이름/가격) 보임.
- **E2E-Catalog-02 (PC 1280px):** 동일 플로우 데스크탑 뷰포트. 카드 그리드가 가운데 정렬된 4열로 표시.
- **E2E-Catalog-03:** 어드민에서 상품 1건 비활성화 → 사용자 페이지 새로고침 시 해당 카드가 사라짐 (이후 어드민 모듈 완성 후 활성).
- **E2E-Catalog-04:** 빈 카테고리 진입 시 빈 상태 메시지가 표시되고 에러 토스트는 나오지 않음.
- **E2E-Catalog-05:** 검색창에 "베이직" 입력 → 일치 카드가 즉시 렌더링.
