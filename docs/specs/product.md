# Module: ProductDetail

## Purpose
M-ProductDetail은 단일 액자 상품의 상세 정보를 노출하고, 사용자가 "주문하기" 버튼을 눌러 편집 세션(`/studio/[sessionId]`)으로 진입하는 게이트웨이다. 상품 본문(이름/태그라인/마크다운 설명), 다중 이미지(썸네일·갤러리·제작가이드), 옵션 매트릭스(사이즈/색상/매트/인화지), 기본 가격(`base_price`) 또는 변형별 시작가를 표시한다. 카탈로그에서 진입한 사용자가 구매 의사결정에 필요한 정보를 5초 안에 파악하고 편집기로 넘어가도록 단순/직관적인 정보 위계를 강제한다. Phase 1 MVP에서는 옵션 탭이 사이즈/색상 2개씩만 채워져도 충족되어야 한다.

## User Stories
- B2C 구매자로서, 카탈로그에서 상품 카드를 탭했을 때 상세 페이지에서 큰 갤러리 이미지·이름·시작가를 즉시 확인하고 싶다.
- B2C 구매자로서, 상품 설명과 제작가이드(인쇄 품질·소재·주의사항)를 스크롤해서 읽고 구매 전 의사결정을 하고 싶다.
- B2C 구매자로서, 사이즈/색상/매트/인화지 조합을 미리 살펴보고 어떤 옵션이 가능한지 알고 싶다.
- B2C 구매자로서, "주문하기" 버튼을 누르면 새 편집 세션이 시작되어 사진 업로드 단계로 자연스럽게 넘어가길 원한다.
- B2C 구매자(모바일)로서, 큰 이미지 갤러리를 좌우 스와이프로 넘겨보고 싶다.
- 운영자로서, 어드민에서 상품 본문이나 옵션 매트릭스를 수정하면 사용자 페이지에 즉시 반영되길 원한다.
- 운영자로서, 비활성(`is_active=false`) 상품 URL에 직접 접근하더라도 사용자가 주문할 수 없게 차단되길 원한다.

## Acceptance Criteria
1. **GIVEN** 활성 상품 ID `p1`이 존재한다 **WHEN** `getProductDetail('p1')`를 호출한다 **THEN** `product`(기본 정보), `images`(타입별 정렬), `frames`(색상 옵션), `defaultVariantId`(시작 변형)를 포함한 객체가 반환되어야 한다.
2. **GIVEN** 존재하지 않거나 `is_active=false`인 상품 ID **WHEN** `getProductDetail(id)`를 호출한다 **THEN** `null`을 반환해야 하며, 페이지는 404로 라우팅되어야 한다.
3. **GIVEN** 상품에 `product_images` 5건이 등록되어 있다 (`type` = thumbnail 1, gallery 3, guide 1) **WHEN** 상세를 조회한다 **THEN** 응답의 `images`는 `type`별로 그룹화되고 각 그룹 내 `sort_order` 오름차순 정렬되어야 한다.
4. **GIVEN** `getProductOptions('p1')`를 호출한다 **WHEN** 상품 변형이 12개 등록되어 있다 **THEN** `sizes`, `colors`, `mattes`, `papers` 4개 축의 유니크 옵션 배열과 변형 lookup 맵(`variantsByKey`)이 함께 반환되어야 한다.
5. **GIVEN** 변형 중 일부가 `is_active=false` 또는 `stock=0`이다 **WHEN** 옵션을 조회한다 **THEN** 비활성 변형은 결과에 포함되지 않으며, 모든 변형이 비활성이면 빈 옵션 셋이 반환된다.
6. **GIVEN** 상품 페이지가 마운트된다 **WHEN** UI가 첫 렌더링된다 **THEN** "시작가" 영역에는 활성 변형 중 최저가가 `4,800원~` 형태로 노출되어야 한다.
7. **GIVEN** 사용자가 "주문하기" 버튼을 클릭한다 **WHEN** 클릭 이벤트가 발생한다 **THEN** 새 편집 세션 ID(UUID)가 생성되고 `/studio/<sessionId>?productId=<id>`로 라우팅된다. 세션 ID는 클라이언트에서 생성(crypto.randomUUID).
8. **GIVEN** 상품의 마크다운 본문에 이미지/링크/리스트가 포함되어 있다 **WHEN** 페이지가 렌더링된다 **THEN** 안전한 마크다운 렌더러(예: `react-markdown` + `rehype-sanitize`)로 XSS 위험 태그가 제거되어야 한다.
9. **GIVEN** 갤러리 이미지가 4건 이상이다 **WHEN** 모바일에서 페이지를 본다 **THEN** 좌우 스와이프 가능한 캐러셀로 표시되고 PC에서는 메인 + 썸네일 리스트 형태로 표시된다.
10. **GIVEN** 옵션 매트릭스에서 어떤 색상이 선택되었을 때 그 색상에 매칭되는 사이즈가 한정적이다 **WHEN** 사용자가 색상을 선택한다 **THEN** 상세 페이지는 단순 미리보기 수준에서 "선택 가능 옵션" 힌트만 보여주고, 본격 옵션 변경은 편집기에서 수행한다(상세 페이지는 정보 노출 중심).

## Edge Cases
- **이미지 0건:** `product_images`가 비어 있는 상품 → 플레이스홀더 이미지 표시(컴포넌트 책임). 데이터 레이어는 빈 배열 반환.
- **변형 0건:** `product_variants`가 비어 있는 상품 → "주문하기" 버튼 비활성화 + "옵션 준비 중" 토스트. 카탈로그에서는 노출될 수 있으나 상세에서 차단.
- **시작가 계산:** 활성 변형 최저가를 시작가로 표시. 변형이 모두 비활성이면 `base_price`로 폴백.
- **마크다운 폭주:** 본문에 외부 이미지가 30개 이상 포함되면 lazy-load 처리. `description` 길이 상한은 데이터 레이어가 아닌 어드민이 강제(스펙 미정 → Phase 1은 무제한, Phase 2 어드민 검증).
- **세션 ID 충돌:** crypto.randomUUID 충돌은 사실상 0이므로 별도 가드 없음. 다만 서버 측 sessionId 유일성 검증은 cart insert 시 수행(M-Cart 책임).
- **비로그인 사용자:** 상세 페이지는 인증 불필요. 누구나 볼 수 있다.
- **재고/품절 표시:** 사이즈별 모든 색상이 비활성이면 해당 사이즈 자체를 "준비 중"으로 표시(상세 정보 차원). 실제 차단은 편집기가 수행.
- **고가 변형의 표시:** 시작가만 노출하고 최대가는 표시하지 않음(혼란 방지). Phase 2에서 "4,800원~12,000원" 범위 표기 검토.
- **이미지 CDN 실패:** Supabase Storage URL 로드 실패 시 onError로 플레이스홀더 fallback. 데이터 레이어 책임 아님.
- **자율 결정:** `sessionId`는 클라이언트 생성(crypto.randomUUID)으로 단순화. Phase 2에서 서버 발급(예약 슬롯)으로 업그레이드 검토.

## Out of Scope
- **실시간 옵션 선택 + 가격 미리보기** — 편집기(M-FrameEditor) 책임.
- **리뷰/평점/판매량** — Phase 3 리뷰 시스템.
- **장바구니 직접 추가(편집 스킵)** — 사진 편집이 필수 동선이므로 지원 안 함.
- **재고 실시간 표시** — Phase 2.
- **공유(SNS) 버튼** — Phase 3.
- **상품 찜하기(위시리스트)** — Phase 3.
- **추천 상품(Cross-sell)** — Phase 3.
- **다국어** — Phase 4.
- **ISR/SEO 메타 최적화** — Phase 2 정식, Phase 1은 SSR 허용.

## Dependencies
- **Depends on:**
  - M-Catalog (`Product`, `Category` 타입 공유)
  - Supabase 테이블: `products`, `product_images`, `frame_assets`, `product_variants` (PLAN.md §6)
  - `src/types/product.ts` — `Product`, `ProductDetail`, `FrameAsset`, `ProductVariant`, `OptionMatrix`
  - RLS: 누구나 SELECT (§6.1)
  - 마크다운 렌더링 유틸 (`lib/markdown.ts`, Phase 1 신규)
- **Used by:**
  - M-FrameEditor (옵션 변경 시 `variantsByKey` lookup 재사용)
  - 페이지: `app/(shop)/product/[id]/page.tsx`
  - M-Cart (변형 스냅샷 참조)

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다.

- `getProductDetail(id: string): Promise<ProductDetail | null>`
  - **ProductDetail 구성:**
    - `product: Product` — 기본 정보(name, tagline, description, basePrice, hasFrame)
    - `images: { thumbnail: ProductImage[]; gallery: ProductImage[]; guide: ProductImage[] }` — 타입별 정렬된 이미지
    - `frames: FrameAsset[]` — 색상 옵션 PNG 정보
    - `defaultVariantId: string` — 최저가 활성 변형 ID (또는 첫 활성 변형)
    - `startingPrice: number` — UI 표시용 시작가
  - **동작:** `is_active=false` 또는 미존재 시 `null`. 이미지/프레임/변형은 활성만.

- `getProductOptions(id: string): Promise<OptionMatrix>`
  - **OptionMatrix 구성:**
    - `sizes: Array<{ code: string; label: string; widthMm: number; heightMm: number }>`
    - `colors: Array<{ code: string; label: string; previewUrl: string | null }>`
    - `mattes: Array<{ code: 'none' | 'with'; label: string }>`
    - `papers: Array<{ code: 'glossy' | 'matte' | 'fineart'; label: string }>`
    - `variantsByKey: Record<string, ProductVariant>` — key = `${size}|${color}|${matte}|${paper}`
  - **동작:** 활성 변형만 집계. 옵션 축은 변형에서 추출. 변형 lookup 맵은 편집기 가격 계산에 직접 사용.

- `<ProductDetailPage productId={id} />` (서버 컴포넌트 권장)
  - 내부에서 `getProductDetail` + `getProductOptions` 병렬 호출.
  - "주문하기" 클라이언트 컴포넌트 버튼 포함.

- `startEditorSession(productId: string): { sessionId: string; redirectUrl: string }`
  - **동작:** `crypto.randomUUID()`로 sessionId 발급, `/studio/<id>?productId=<productId>` URL 반환. 사이드이펙트 없음(라우팅은 호출자 책임).

## Test Scenarios

### Unit (Vitest)
- `getProductDetail` 미존재 → `null` 반환.
- `getProductDetail` 비활성 상품 → `null` 반환.
- 이미지 그룹핑: 5건 mock 데이터를 type별로 정렬해 그룹화한다.
- 프레임/변형 활성 필터링: 비활성 항목 제외.
- 시작가 계산: 최저가 활성 변형 가격, 변형 0개면 `base_price` 폴백.
- `getProductOptions` 옵션 축 추출: 변형 12개에서 sizes/colors/mattes/papers 유니크 추출.
- `variantsByKey` lookup: 동일 키 조회 시 단일 변형 매핑.
- `startEditorSession`: UUID v4 형식 + 쿼리스트링 URL 생성.

### Integration (Testing Library)
- `<ProductDetailPage>` 마운트 → 갤러리/마크다운/시작가/주문하기 버튼 모두 렌더.
- 마크다운 본문에 `<script>` 포함 시 sanitize되어 제거됨.
- 변형 0건 상품 → "주문하기" 버튼 disabled + 안내 표시.
- "주문하기" 클릭 → router.push 가 `/studio/<uuid>?productId=p1` 형식으로 호출됨.
- 모바일 뷰포트(375px)에서 갤러리가 캐러셀로 렌더링됨.

### E2E (Playwright)
- **E2E-Product-01:** 카탈로그 → 상품 카드 클릭 → 상세 페이지 이름/시작가/이미지 가시.
- **E2E-Product-02:** 갤러리 3장 좌우 스와이프(모바일 375px).
- **E2E-Product-03:** "주문하기" 클릭 → URL이 `/studio/...`로 전환되며 sessionId 포함.
- **E2E-Product-04:** 비활성 상품 직접 URL 접근 → 404 페이지 렌더.
- **E2E-Product-05:** 변형 0건 상품에서 주문하기 버튼이 비활성 상태.
- **E2E-Product-06:** PC 1280px 뷰포트에서 메인 이미지 + 썸네일 리스트 레이아웃 검증.
