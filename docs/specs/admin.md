# Module: Admin

## Purpose
M-Admin은 운영자가 상품/프레임/옵션 매트릭스/주문/큐레이션/배송 정책을 관리하는 백오피스 모듈이다. 6개 서브 모듈로 구성된다:
1. **admin/products** — 상품 CRUD (이름, 카테고리, 마크다운 본문, 활성 토글, 이미지 업로드)
2. **admin/frames** — 프레임 PNG 업로드, 색상 옵션, inner_rect 드래그 UI
3. **admin/options** — 옵션 매트릭스 (사이즈×색상×매트×인화지) CSV import/export
4. **admin/orders** — 주문 조회, 상태 변경, 인쇄 파일 다운로드
5. **admin/curation** — 랜딩 페이지 배너/컬렉션 등록
6. **admin/shipping** — 배송 정책 설정 (ADR-008): STANDARD/PICKUP/QUICK 방법별 가격·임계값·픽업 안내문·활성 토글

모든 라우트는 Supabase Auth `role='admin'` 사용자만 접근 가능하며 RLS 정책으로 이중 보호한다. Phase 1 MVP는 상품/주문 CRUD + 배송 설정 우선이고, 큐레이션과 옵션 CSV는 Phase 2 확장이다(PLAN.md §9). 인쇄 파일 다운로드는 Phase 1에서 미리보기 PNG로 대체 허용한다.

## User Stories
- 운영자로서, `/admin`에 진입하면 신규 주문 수/오늘 매출 등 핵심 KPI를 한눈에 보고 싶다(Phase 2 대시보드 — Phase 1은 빈 대시보드 또는 주문 리스트 직접).
- 운영자로서, 상품 등록 폼에서 이름/카테고리/태그라인/마크다운 본문/`base_price`/`has_frame` 토글/이미지 다중 업로드를 한 화면에서 처리하고 싶다.
- 운영자로서, 프레임 PNG를 업로드한 후 inner_rect(사진이 들어갈 투명 중앙 영역)를 마우스 드래그로 지정하고 싶다.
- 운영자로서, 옵션 매트릭스(예: 4사이즈 × 4색상 × 2매트 × 3인화지 = 96 변형)를 CSV로 일괄 등록하고, 기존 매트릭스를 CSV로 export하여 엑셀로 편집한 후 다시 import하고 싶다.
- 운영자로서, 주문 리스트를 상태별 필터(전체/CREATED/PAID/IN_PRODUCTION/SHIPPED/DELIVERED/CANCELLED)로 보고, 행 클릭으로 상세 진입하고 싶다.
- 운영자로서, 주문 상세에서 사용자 사진, cropTransform, 인쇄용 파일 다운로드, 상태 변경 버튼(제작 시작 / 출하 / 환불 등)을 보고 싶다.
- 운영자로서, 큐레이션(배너/컬렉션/feature)을 type/device/기간으로 등록하고 즉시 메인 페이지에 반영하고 싶다.
- **운영자로서, `/admin/shipping`에서 기본배송비/무료배송 임계값/퀵배송 가격/픽업 장소 안내문을 폼으로 수정하고 즉시 사용자 checkout에 반영하고 싶다 (ADR-008).**
- **운영자로서, 특정 배송 방법(예: 퀵배송)을 일시적으로 비활성화하여 사용자 선택지에서 숨기고 싶다.**
- **운영자로서, 진행 중인 주문은 주문 시점 배송비 스냅샷이 동결되어 가격 변경 영향을 받지 않음을 보장받고 싶다.**
- 운영자로서, 일반 사용자가 `/admin/...`에 접근하면 403 또는 로그인 페이지로 리다이렉트되길 원한다.

## Acceptance Criteria
1. **GIVEN** 사용자가 `/admin/*`에 접근한다 **WHEN** Supabase Auth 세션의 `app_metadata.role !== 'admin'`이다 **THEN** 미들웨어가 403 반환 또는 로그인 페이지로 리다이렉트한다. RLS 정책으로도 데이터 변경 차단.
2. **GIVEN** 관리자가 `/admin/products` 페이지에서 "신규 등록"을 클릭한다 **WHEN** 폼이 렌더된다 **THEN** 이름/카테고리 select/태그라인/마크다운 에디터/`base_price`/`has_frame` 토글/이미지 멀티 업로드 UI가 모두 보인다.
3. **GIVEN** 관리자가 상품을 저장한다 **WHEN** Zod 검증 통과 **THEN** `products` insert + product_images insert (썸네일/갤러리/가이드 분류) + 페이지에 즉시 노출(`is_active=true` 기본값).
4. **GIVEN** 관리자가 `is_active=false`로 토글한다 **WHEN** 저장 한다 **THEN** 사용자 카탈로그에서 해당 상품이 즉시 사라진다(M-Catalog `getProductsByCategory` 결과 갱신).
5. **GIVEN** `/admin/frames`에서 PNG를 업로드한다 **WHEN** inner_rect 드래그 UI에서 영역을 지정한다 **THEN** 0~1 정규화된 `{x,y,w,h}`가 `frame_assets.inner_rect`에 저장된다. 미지정 시 기본값 `{x:0.1,y:0.1,w:0.8,h:0.8}` 자동 부여.
6. **GIVEN** `/admin/options`에서 CSV import를 한다 **WHEN** 헤더가 `size_code,size_label,width_mm,height_mm,color_code,matte_code,paper_code,price,stock,is_active`이다 **THEN** 각 행이 `product_variants`에 upsert(`UNIQUE(product_id,size,color,matte,paper)` 키 기준)되며, 검증 오류 행은 별도 리포트로 출력.
7. **GIVEN** `/admin/options` CSV import에서 30개 행 중 5개가 잘못되었다 **WHEN** import 한다 **THEN** 25개는 성공, 5개는 행 번호 + 사유와 함께 실패 리포트로 표시. 전체 롤백은 옵션(자율 결정: Phase 1 기본 부분 성공).
8. **GIVEN** `/admin/orders` 리스트에서 "PAID" 필터를 적용한다 **WHEN** 데이터가 로드된다 **THEN** 결제 완료 주문만 표시되며 페이지네이션(20건/페이지)이 동작한다.
9. **GIVEN** 관리자가 주문 상세에서 "제작 시작" 버튼을 클릭한다 **WHEN** 서버 액션이 호출된다 **THEN** M-Order.transitionTo(IN_PRODUCTION)이 트리거되고 UI에 즉시 반영된다. 잘못된 전이는 422 + 에러 토스트.
10. **GIVEN** 주문 상세에서 "인쇄 파일 다운로드"를 클릭한다 **WHEN** Phase 1 시점이다 **THEN** 미리보기 PNG(`order_items.preview_url` 또는 `previews/...`) URL을 새 탭에 연다. Phase 3에서 300dpi 인쇄용 PNG로 교체.
11. **GIVEN** `/admin/curation`에서 새 배너를 등록한다 **WHEN** type=banner, device=mobile, 기간 2026-05-12 ~ 2026-05-31, payload(`{ imageUrl, link, title }`)를 저장 **THEN** `curations` insert + 사용자 랜딩에서 device=mobile일 때 즉시 노출.
12. **GIVEN** 큐레이션 기간이 지났다(`end_at < now()`) **WHEN** 사용자 랜딩 진입 **THEN** 해당 큐레이션은 노출되지 않는다(M-Landing이 필터링, 어드민은 비활성 표시).
13. **GIVEN** 관리자가 `/admin/shipping`에서 STANDARD `fee=3500`, `free_threshold=40000`으로 폼을 저장한다 **WHEN** 저장 액션이 호출된다 **THEN** `shipping_methods` 테이블이 즉시 UPDATE되고, 이후 사용자 checkout 새 세션부터 새 값이 적용된다(`getShippingMethods()` 결과 갱신). (ADR-008)
14. **GIVEN** 관리자가 가격을 변경했다 **WHEN** 이미 결제 완료된(`PAID` 이상) 주문이 존재한다 **THEN** 해당 주문의 `orders.shipping_fee` 스냅샷은 변경되지 않는다(주문 시점 동결, M-Order 책임).
15. **GIVEN** 관리자가 음수 가격(`fee = -1000`)을 입력한다 **WHEN** 폼을 저장 시도한다 **THEN** Zod/서버 검증에서 거부 + "0 이상의 정수만 허용됩니다" 인라인 에러.
16. **GIVEN** 관리자가 STANDARD `free_threshold`를 비운다(null) **WHEN** 저장한다 **THEN** 임계값 미적용으로 저장되어 사용자 측 `calculateShippingFee`는 항상 정액 `fee` 반환.
17. **GIVEN** 관리자가 QUICK 방법의 `is_active=false` 토글로 저장한다 **WHEN** 사용자 checkout 진입한다 **THEN** 배송 방법 라디오에 QUICK이 노출되지 않는다(`getShippingMethods()`가 활성만 반환).
18. **GIVEN** 관리자가 PICKUP의 `note`(픽업 장소 안내문)를 수정한다 **WHEN** 저장한다 **THEN** 사용자가 checkout에서 PICKUP 선택 시 새 안내문이 표시된다.
19. **GIVEN** 관리자가 모든 배송 방법(`is_active=false x3`)을 비활성화 시도한다 **WHEN** 저장한다 **THEN** 경고("최소 1개의 배송 방법은 활성화해야 합니다") 표시 + 저장 차단(서버 검증).

## Edge Cases
- **권한 우회 시도:** 관리자 세션 없이 `/api/admin/...` 직접 호출 → 미들웨어 + RLS 양쪽에서 차단. 응답은 일관된 401/403.
- **이미지 업로드 실패:** Storage 업로드 실패 시 product insert 전 단계에서 throw + 트랜잭션 롤백. 이미지 부분 업로드 정리.
- **CSV 인코딩:** UTF-8 BOM 허용, 한글 색상 라벨 안전 처리. 인코딩 다른 파일은 "UTF-8 CSV로 저장 후 다시 시도" 안내.
- **CSV 대용량:** 1000행 초과 시 청크 단위 처리(100행씩). 진행률 표시.
- **inner_rect 부정확:** 드래그 UI가 캔버스 외곽으로 나가면 0~1 범위로 클램프. 0인 w/h는 거부.
- **상품 삭제:** hard delete 금지. `is_active=false`만 가능. cart/orders에 참조된 상태에서 삭제는 더더욱 금지.
- **변형(variant) 삭제:** 같은 룰. is_active=false로만.
- **큐레이션 충돌:** 같은 device + 같은 시기에 여러 banner 등록 가능. `sort_order`로 노출 순서 통제.
- **관리자 추가:** Phase 1에서는 Supabase 대시보드에서 직접 `app_metadata.role='admin'` 부여. UI는 Phase 2.
- **감사 로그:** 관리자가 누가 언제 무엇을 변경했는지 로그 (`admin_audit_log` 테이블) — Phase 2.
- **CSRF:** Next.js Server Actions의 기본 CSRF 보호 활용. 외부 API 호출 시 토큰 검증.
- **자율 결정:** 큐레이션 payload는 `jsonb`로 자유 스키마, 타입별 Zod 스키마(BannerPayload/CollectionPayload/FeaturePayload)는 Architect가 정의.
- **배송 설정 동시 편집(ADR-008):** 운영자 2명이 동시에 같은 row를 편집할 수 있음 — Phase 1은 last-write-wins(낙관적). Phase 2 `updated_at` 체크로 충돌 감지.
- **배송 설정 캐시 무효화:** 사용자 checkout이 `getShippingMethods()`를 매 진입 시 호출(SSR 또는 Server Component) — 별도 무효화 로직 불필요. CDN/SWR 캐시 사용 시 짧은 TTL(60s) 권장.

## Out of Scope
- **운영자 회원가입/초대 UI** — Phase 2 (Phase 1은 DB 직접).
- **대시보드(KPI/매출 그래프)** — Phase 3.
- **감사 로그 UI** — Phase 2.
- **재고 자동 차감/알림** — Phase 3.
- **사용자 CS 채팅** — Out of Scope.
- **다국어 어드민** — Out of Scope.
- **드래그앤드롭 상품 정렬 UI** — Phase 2 (Phase 1은 `sort_order` 숫자 입력).
- **300dpi 인쇄 파일 자동 생성** — Phase 3 (Phase 1은 미리보기 PNG로 대체).
- **이미지 자동 리사이즈 다중 해상도** — Phase 2 (Supabase Storage transform).
- **배송 정책 — 지역별 차등 요금/시간대별 가격** — Phase 2 (ADR-008).
- **배송 정책 — 다중 픽업 장소 등록** — Phase 2 (Phase 1은 단일 안내문 텍스트).
- **배송 정책 변경 이력 audit log** — Phase 2.

## Dependencies
- **Depends on:**
  - Supabase Auth (`app_metadata.role='admin'`) + 미들웨어 (`middleware.ts`)
  - Supabase 테이블 전체 (RLS: 관리자만 INSERT/UPDATE/DELETE)
  - **`shipping_methods` 테이블 (또는 `shipping_settings` 단일 row) — Architect가 스키마 선택 (ADR-008)**
  - Supabase Storage: `products`, `frames`, `curations` buckets (각 admin이 upload, public read)
  - M-Catalog (상품/카테고리 데이터)
  - M-ProductDetail (변형 매트릭스)
  - M-Order (`transitionTo`, `getOrder`, 주문 리스트 쿼리)
  - **M-Checkout (`getShippingMethods()`를 사용자 측이 참조)**
  - 마크다운 에디터 (예: `@uiw/react-md-editor` — Phase 1 자율 선택)
  - CSV 파서 (예: `papaparse`)
  - `src/types/*` 전반 (`ShippingMethodConfig` 포함)
- **Used by:**
  - 페이지: `app/admin/products/...`, `app/admin/frames/...`, `app/admin/options/...`, `app/admin/orders/...`, `app/admin/curation/...`, `app/admin/shipping/...`

## Interface (high-level)
> Architect가 아래 컴포넌트/함수 시그니처를 TypeScript로 동결한다. 서브 모듈별로 분리.

### admin/products
- `<AdminProductForm mode="create" | "edit" initial?={Product} onSubmit={(data: ProductInput) => Promise<void>} />`
  - **ProductInput:** 위 schema + `images: { thumbnail?: File; gallery: File[]; guide: File[] }`
- `<AdminProductTable products={Product[]} onToggleActive={...} onEdit={...} />`
- `upsertProduct(input: ProductInput): Promise<Product>` (서버 액션)
- `toggleProductActive(id: string, active: boolean): Promise<void>`

### admin/frames
- `<AdminFrameForm productId={string} initial?={FrameAsset} onSubmit={(data) => ...} />`
  - inner_rect 드래그 UI 컴포넌트 `<InnerRectEditor pngUrl={...} value={{x,y,w,h}} onChange={...} />`
- `upsertFrameAsset(input: FrameAssetInput): Promise<FrameAsset>`

### admin/options
- `<VariantMatrixTable productId={string} variants={ProductVariant[]} onUpdate={...} />` (2D 표 UI: 행=사이즈, 열=색상 등)
- `<VariantMatrixCsvImport productId={string} onComplete={(report: ImportReport) => void} />`
- `parseVariantCsv(file: File): Promise<{ rows: VariantInput[]; errors: VariantImportError[] }>`
- `importVariants(productId: string, rows: VariantInput[]): Promise<ImportReport>`
  - **ImportReport:** `{ inserted: number; updated: number; skipped: number; errors: VariantImportError[] }`
- `exportVariantsCsv(productId: string): Promise<Blob>` — 다운로드용

### admin/orders
- `<AdminOrderTable filter?={OrderStatus} page={number} />` (Server Component 권장)
- `<AdminOrderDetail orderNo={string} />`
- `<OrderStatusButton order={Order} target={OrderStatus} meta?={TransitionMeta} />`
- `downloadPrintFile(orderItemId: string): Promise<string>` (URL 반환, Phase 1은 preview_url)

### admin/curation
- `<AdminCurationForm initial?={Curation} onSubmit={...} />`
- `<AdminCurationTable curations={Curation[]} />`
- `upsertCuration(input: CurationInput): Promise<Curation>`

### admin/shipping (ADR-008)
- `<ShippingSettingsForm initial={ShippingMethodConfig[]} onSubmit={(rows: ShippingMethodInput[]) => Promise<void>} />`
  - **단일 폼에 3개 row(STANDARD/PICKUP/QUICK) 동시 편집.** 각 row: `label`, `fee`(int >= 0), `freeThreshold`(STANDARD만, nullable int), `note`(PICKUP만 권장), `isActive`(checkbox), `sortOrder`(int).
  - 최소 1개 row가 `isActive=true`여야 저장 가능.
- `<ShippingSettingsTable rows={ShippingMethodConfig[]} />` — 현재 설정 요약 + 빠른 활성 토글.
- `listShippingMethods(): Promise<ShippingMethodConfig[]>` — **관리자용**, 비활성 포함 전체 반환.
- `updateShippingMethod(code: 'STANDARD'|'PICKUP'|'QUICK', payload: ShippingMethodInput): Promise<ShippingMethodConfig>` — 단일 row 업데이트(서버 액션, RLS로 admin만).
- `bulkUpdateShippingMethods(rows: ShippingMethodInput[]): Promise<ShippingMethodConfig[]>` — 폼 일괄 저장(트랜잭션).

### 공통
- `requireAdmin(): Promise<AdminUser>` — 서버 함수, 미인증/권한 없으면 throw.
- `<AdminLayout>` — 상단 네비, 사이드바, 권한 검증.

## Test Scenarios

### Unit (Vitest)
- `parseVariantCsv` 정상 CSV 30행 → 30 rows + 0 errors.
- `parseVariantCsv` 잘못된 가격 형식("abc") → 해당 행이 errors에 포함.
- `parseVariantCsv` BOM 포함 UTF-8 → 정상 파싱.
- `parseVariantCsv` 헤더 누락 → 전체 reject + 명확한 에러.
- inner_rect 클램프: 음수 입력 → 0으로, 1.5 → 1로.
- `requireAdmin`: role 미설정 사용자 → throw.
- **ShippingSettings Zod 스키마: 음수 fee → reject.**
- **ShippingSettings Zod 스키마: 모든 row `isActive=false` → reject.**
- **ShippingSettings Zod 스키마: STANDARD `freeThreshold=null` → 정상 통과.**

### Integration (Testing Library + Supabase test client)
- `<AdminProductForm>` 정상 입력 → upsertProduct 호출 → DB 행 생성.
- `<VariantMatrixCsvImport>` 5행 CSV 업로드 → 5건 upsert + 진행률 100%. (PLAN.md IT-05)
- `<AdminOrderTable>` 필터 변경 → 쿼리 파라미터 + 결과 셋 변경.
- `<OrderStatusButton>` 클릭 → transitionTo 호출 → 행 상태 갱신.
- 잘못된 상태 전이 시도 → 토스트 에러 + 상태 변경 없음.
- 일반 사용자 세션으로 /admin 접근 → 403.

### E2E (Playwright)
- **E2E-Admin-01 (PLAN.md E2E-03):** 관리자가 상품 신규 등록 → 사용자 카탈로그에서 즉시 노출.
- **E2E-Admin-02:** 상품 `is_active=false` 토글 → 카탈로그에서 사라짐.
- **E2E-Admin-03:** 옵션 매트릭스 CSV 5행 업로드 → 변형 5개 생성.
- **E2E-Admin-04:** 주문 리스트에서 PAID 필터 → 결제 완료 주문만 표시.
- **E2E-Admin-05:** 주문 상세 → "제작 시작" 클릭 → IN_PRODUCTION 전환 + 사용자 마이페이지 반영.
- **E2E-Admin-06:** 큐레이션 banner 등록(device=mobile) → 모바일 뷰포트 메인에 노출.
- **E2E-Admin-07:** 비관리자 로그인으로 /admin 접근 → 403 또는 리다이렉트.
- **E2E-Admin-08 (ADR-008):** 관리자가 STANDARD fee를 3,000 → 4,000으로 변경 → 사용자 새 세션으로 checkout 진입 시 4,000원 적용.
- **E2E-Admin-09 (ADR-008):** 관리자가 QUICK `is_active=false` 토글 → 사용자 checkout에서 QUICK 라디오 사라짐.
- **E2E-Admin-10 (ADR-008):** 관리자가 음수 fee 입력 → 폼 인라인 에러 + 저장 차단.
