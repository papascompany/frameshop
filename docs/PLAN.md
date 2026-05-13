# FrameShop — 액자 주문 SaaS 개발 계획서

> ZZIXX 스타일의 모바일/PC 반응형 액자 주문 플랫폼
> Claude Code 멀티 에이전트 + TDD 기반 자율 개발 가이드

**작성일:** 2026-05-11
**프로젝트 코드명:** FrameShop (가칭)
**대상 사용자:** 일반 소비자(B2C), 관리자(B2B-Admin)
**참고 레퍼런스:** ZZIXX (찍스) 앱 UX 플로우

---

## 1. 비즈니스 모델 (BM) 개요

### 1.1 한 줄 요약
> **사용자가 자신의 사진을 원하는 액자 디자인·크기·옵션에 맞춰 미리보기하며 주문하면, 인쇄·제작 후 배송되는 Print-on-Demand 액자 커머스 플랫폼**

### 1.2 핵심 가치
| 사용자 가치 | 운영자 가치 |
|---|---|
| 실제 인쇄 결과를 사전에 정확히 시각 확인 | 관리자 페이지에서 상품/프레임/옵션을 자유롭게 등록·노출 |
| 사진 위치/크기/회전을 직접 조정 → 인쇄 영역 컨트롤 | 사진/PNG/제작가이드/상세설명 추가/제거 가능 |
| 모바일·PC 어디서나 동일한 큐레이션 경험 | 주문/배송/CS를 단일 백오피스에서 일괄 관리 |

### 1.3 캡처화면 분석 (개발목표 정밀 분해)

| # | 화면 | 핵심 기능 | 도출되는 모듈 |
|---|---|---|---|
| 1 | 액자 카탈로그 (베이직액자, 4,800원~) | 액자 리스트 카드형 노출, 가격/사이즈 표시 | **M-Catalog** |
| 2 | 액자 상품 상세 (베이직액자 상품안내) | 상세 이미지, 설명, 제작가이드 | **M-ProductDetail** |
| 3 | 사진 가져오기 (휴대폰 사진/클라우드/명화이미지) | 사진 소스 선택 | **M-PhotoSource** |
| 4 | 사진 선택 (갤러리 그리드) | 갤러리에서 사진 선택, 줌 미리보기 | **M-PhotoPicker** |
| 5 | 액자 색상 옵션 | 옵션 탭(사진사이즈/액자색상/매트/인화지), 색상 변경 시 실시간 미리보기 | **M-FrameEditor** |
| 6 | 매트 있음/없음 옵션 | 매트 토글 + 실시간 합성 | **M-FrameEditor** |
| 7 | 배송지 입력 | 주문인/배송지 정보, 우편번호 검색 | **M-Checkout** |

**누락 도출 (요구사항에서 추가 식별):**
- 사진 위치/크기/회전 편집 (인쇄 영역 컨트롤) → **M-CropEditor**
- 액자 형태별 분류 (프레임 있음/없음) → **M-Catalog** 카테고리 트리
- 관리자 콘솔 전체 → **M-Admin**
- 반응형 큐레이션 랜딩 → **M-Landing**

---

## 2. 비즈니스 로직 그룹화 (이슈별 분류)

### Group A. 상품 & 옵션 관리 영역
- A1. 액자 카테고리/상품 CRUD
- A2. 프레임 종류 (프레임 PNG, 매트, 색상, 인화지) 관리
- A3. 옵션-가격 매트릭스 (사이즈 × 색상 × 매트 × 인화지 → 가격)
- A4. 상품 상세 컨텐츠 (이미지·설명·제작가이드) 관리
- A5. 노출 순서 / 진열 / 큐레이션 컬렉션

### Group B. 사용자 편집 & 미리보기 영역
- B1. 사진 가져오기 (디바이스 / 클라우드 / 명화)
- B2. 사진 위치/크기/회전 편집 (인쇄 영역 = Crop Region)
- B3. 프레임 PNG 오버레이 합성 (실시간 미리보기)
- B4. 옵션 변경에 따른 실시간 재렌더링
- B5. 미리보기 → 장바구니 데이터 직렬화

### Group C. 주문 & 결제 영역
- C1. 장바구니
- C2. 주문서 (배송지/주문인)
- C3. 결제 PG 연동
- C4. 주문 상태 (결제완료 → 제작중 → 출하 → 배송완료)
- C5. 인쇄 작업 큐로 전송 (이미지 + 메타데이터)

### Group D. 시스템 & 인프라 영역
- D1. 이미지 업로드 / CDN / 리사이즈
- D2. 인쇄용 고해상도(300dpi) 렌더링 워커
- D3. 인증 (사용자 / 관리자)
- D4. 결제 콜백 / 웹훅
- D5. 모니터링 / 로깅

### Group E. 프론트엔드 UX 영역
- E1. PC/모바일 반응형 랜딩
- E2. 카탈로그 큐레이션 UI
- E3. 편집기 (PC 마우스 / 모바일 터치)
- E4. 관리자 콘솔 UI

> **그룹화 원칙:** 각 그룹은 독립 배포 가능한 단위로, 단일 책임을 가지며 다른 그룹과는 명시적 인터페이스(타입 정의)만 공유한다.

---

## 3. 기술 스택 (Over-engineering 회피 + 표준 가이드라인 준수)

### 3.1 선정 원칙
1. **단일 코드베이스, 반응형 (PC + 모바일 동일 경험)** → React 기반 Next.js
2. **이미 검증된 스택 위주** (Papas 기존 SaaS와 동일 패턴)
3. **외부 의존 최소화** — 핵심 기능은 자체 구현 가능한 라이브러리만 사용
4. **타입 안정성** → TypeScript strict 모드 필수

### 3.2 최종 스택

| 영역 | 기술 | 선정 이유 |
|---|---|---|
| **프레임워크** | Next.js 15 (App Router) | 풀스택 단일 코드베이스, ISR로 카탈로그 SEO 최적화 |
| **언어** | TypeScript 5.x (strict) | 옵션 매트릭스의 복잡도를 타입으로 강제 |
| **DB / Auth / Storage** | Supabase (Postgres + Storage + Auth) | Papas의 다른 프로젝트와 일관성, RLS로 보안 단순화 |
| **편집 캔버스** | **Konva.js + react-konva** | 사진 회전·크기·위치 편집에 Fabric보다 가볍고 모바일 터치가 우수. PNG 오버레이 합성에 최적 |
| **상태관리** | Zustand | 편집기 상태(undo/redo)에 적합. 단순함 |
| **스타일** | Tailwind CSS + shadcn/ui | Papas 기존 프로젝트와 일관성 |
| **결제** | 토스페이먼츠 또는 포트원(아임포트) v2 | 한국 시장 표준, 다중 PG 통합 |
| **이미지 처리(서버)** | Sharp | EXIF 자동 회전, 300dpi 리사이즈, JPEG/PNG 최적화 |
| **백그라운드 작업** | Supabase Edge Functions + DB Queue | 별도 워커 인프라 불필요 |
| **반응형** | Tailwind breakpoints + CSS Container Queries | Header/Footer는 별도 모바일 컴포넌트 분기 |
| **테스트** | Vitest + Testing Library + Playwright | CardCraft AI에서 검증된 조합 |
| **배포** | Vercel (Web) + Vultr Seoul VPS (이미지 워커 옵션) | Papas 기존 인프라와 연계 |
| **로깅** | Sentry + Vercel Analytics | 결제/주문 에러 추적 필수 |

### 3.3 왜 Konva인가? (Fabric.js와 비교 결정)
- 사진 편집에 필요한 기능은 **이동/회전/스케일 + 클리핑 마스크** 정도라 Fabric.js의 폭넓은 도구는 과한 사양
- 모바일 멀티터치 제스처(핀치 줌/회전)가 Konva가 더 견고
- 프레임 PNG 합성 시 Konva의 레이어 모델(`Stage > Layer > Group > Image`)이 직관적
- 번들 크기: Konva ~150KB < Fabric ~250KB

---

## 4. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                       사용자 (PC + Mobile)                    │
└──────────┬───────────────────────────┬──────────────────────┘
           │                           │
   [Landing /]                   [Editor /studio/[id]]
   - 큐레이션               - 사진 업로드
   - 카테고리                       - Konva Canvas
   - 카탈로그                  - 옵션 변경
                                   - 주문서
           │                           │
           └─────────────┬─────────────┘
                         │
                ┌────────▼─────────┐
                │  Next.js (App)   │
                │  - Pages         │
                │  - Route Handlers│
                │  - Server Actions│
                └────────┬─────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐    ┌──────────┐     ┌──────────┐
   │Supabase │    │ Supabase │     │   PG사   │
   │   DB    │    │ Storage  │     │(토스/포트원)│
   │  (RLS)  │    │  (CDN)   │     │           │
   └─────────┘    └──────────┘     └──────────┘
                         │
                         ▼
                ┌──────────────────┐
                │ Edge Function    │
                │ - 결제 웹훅       │
                │ - 인쇄용 PDF생성  │
                │ - 주문 알림       │
                └──────────────────┘
                         │
                         ▼
                ┌──────────────────┐
                │  관리자 콘솔      │
                │  /admin          │
                │  - 상품 CRUD      │
                │  - 주문 관리      │
                │  - 통계           │
                └──────────────────┘
```

---

## 5. 모듈 설계 (단위·역할·인터페이스)

### 5.1 모듈 트리

```
src/
├── app/                         # Next.js App Router
│   ├── (shop)/                  # 사용자 영역
│   │   ├── page.tsx             # 랜딩 (큐레이션)
│   │   ├── catalog/[slug]/      # 카테고리 카탈로그
│   │   ├── product/[id]/        # 상품 상세
│   │   ├── studio/[orderId]/    # 사진 + 옵션 편집기
│   │   ├── cart/                # 장바구니
│   │   ├── checkout/            # 주문서
│   │   └── account/             # 마이페이지
│   ├── admin/                   # 관리자 영역
│   │   ├── products/
│   │   ├── frames/
│   │   ├── options/
│   │   ├── orders/
│   │   └── curation/
│   └── api/                     # Route Handlers
│       ├── upload/              # 이미지 업로드
│       ├── render/              # 인쇄용 렌더링
│       ├── payment/             # 결제 콜백
│       └── webhook/             # PG 웹훅
│
├── modules/                     # 비즈니스 로직 모듈
│   ├── catalog/                 # M-Catalog
│   ├── product/                 # M-ProductDetail
│   ├── photo/                   # M-PhotoSource + M-PhotoPicker
│   ├── editor/                  # M-FrameEditor + M-CropEditor
│   ├── cart/                    # M-Cart
│   ├── checkout/                # M-Checkout
│   ├── payment/                 # M-Payment
│   ├── order/                   # M-Order (상태 머신)
│   ├── admin/                   # M-Admin
│   └── landing/                 # M-Landing
│
├── components/                  # 공통 UI 컴포넌트
│   ├── ui/                      # shadcn/ui 기반
│   ├── editor/                  # Konva 캔버스 관련
│   └── layout/                  # Header/Footer/Nav
│
├── lib/                         # 인프라/유틸
│   ├── supabase/
│   ├── konva/                   # 캔버스 헬퍼
│   ├── image/                   # Sharp 래퍼
│   ├── payment/                 # PG 어댑터
│   └── utils/
│
├── types/                       # 전역 타입
│   ├── product.ts
│   ├── order.ts
│   └── editor.ts
│
└── store/                       # Zustand 스토어
    ├── editor.ts
    └── cart.ts
```

### 5.2 모듈별 책임 정의

#### M-Catalog (상품 카탈로그)
- **책임:** 카테고리/상품 목록 조회, 필터링, 정렬, 페이지네이션
- **노출 인터페이스:**
  - `getCategories(): Category[]`
  - `getProductsByCategory(slug, options): Product[]`
  - `searchProducts(query): Product[]`
- **의존:** Supabase (read-only), `types/product.ts`

#### M-ProductDetail (상품 상세)
- **책임:** 단일 상품의 이미지·설명·제작가이드·옵션·가격 표시
- **노출 인터페이스:**
  - `getProductDetail(id): ProductDetail`
  - `getProductOptions(id): OptionMatrix`
- **의존:** M-Catalog

#### M-PhotoSource (사진 소스 선택)
- **책임:** 사진 가져오기 방식 분기 (디바이스/클라우드/명화)
- **노출 인터페이스:**
  - `<PhotoSourceSelector onSelect={(source) => ...} />`
- **하위 컴포넌트:**
  - `DevicePicker` — `<input type="file">` + 모바일 카메라 호출
  - `CloudPicker` — 외부 클라우드 OAuth (선택 사항, Phase 2)
  - `StockPicker` — 명화/스톡 이미지 갤러리

#### M-PhotoPicker (갤러리 + 줌 미리보기)
- **책임:** 다중 사진 선택, EXIF 자동 회전, 미리보기
- **노출 인터페이스:**
  - `<PhotoGallery photos={...} onSelect={(photo) => ...} />`
- **의존:** Sharp(서버), `lib/image/exif.ts`

#### M-FrameEditor (프레임 합성 + 옵션 변경)
- **책임:**
  - 사진 위에 프레임 PNG 오버레이
  - 옵션 변경 시 실시간 재렌더링 (사이즈/색상/매트/인화지)
  - 옵션 매트릭스에 따른 가격 자동 계산
- **노출 인터페이스:**
  - `<FrameEditor product={...} photo={...} onConfirm={(config) => ...} />`
- **의존:** Konva, M-CropEditor, M-ProductDetail
- **상태:** Zustand store `editorStore`

#### M-CropEditor (사진 인쇄 영역 컨트롤)
- **책임:** 사진 이동/크기/회전. 액자 비율에 맞는 클리핑 영역 표시
- **노출 인터페이스:**
  - `<CropCanvas aspectRatio={...} image={...} onChange={(transform) => ...} />`
- **출력 데이터:**
  ```ts
  type CropTransform = {
    x: number;       // 캔버스 기준 좌표
    y: number;
    scale: number;   // 1.0 = 100%
    rotation: number;// 도(degree)
  }
  ```

#### M-Cart (장바구니)
- **책임:** 편집 완료된 아이템 임시 저장. 비로그인 시 LocalStorage, 로그인 시 DB sync
- **노출 인터페이스:**
  - `addToCart(item: CartItem)`
  - `getCart(): CartItem[]`
- **CartItem 구조:**
  ```ts
  type CartItem = {
    productId: string;
    options: SelectedOptions;   // { size, color, matte, paper }
    photoUrl: string;            // Supabase Storage path
    cropTransform: CropTransform;
    previewUrl: string;          // 합성된 미리보기 (저해상도)
    price: number;
    quantity: number;
  }
  ```

#### M-Checkout (주문서)
- **책임:** 주문인 정보, 배송지(이전 배송지/신규/주문인과 동일), 우편번호 검색
- **외부 연동:** 카카오/다음 우편번호 API

#### M-Payment (결제)
- **책임:** PG 어댑터 (토스/포트원 추상화), 결제 콜백 처리
- **노출 인터페이스:**
  - `requestPayment(order): Promise<PaymentResult>`
  - `handleWebhook(payload): Promise<void>`

#### M-Order (주문 상태 머신)
- **상태 전이:**
  ```
  CREATED → PAID → IN_PRODUCTION → SHIPPED → DELIVERED
                ↓
              REFUNDED / CANCELLED
  ```
- **노출 인터페이스:**
  - `createOrder(items, address): Order`
  - `transitionTo(orderId, state): void`

#### M-Admin (관리자 콘솔)
- **5개 서브 모듈:**
  - `admin/products` — 상품 CRUD
  - `admin/frames` — 프레임 PNG 업로드, 색상 옵션 관리
  - `admin/options` — 옵션 매트릭스 (CSV 일괄 import)
  - `admin/orders` — 주문 조회, 상태 변경, 인쇄 파일 다운로드
  - `admin/curation` — 랜딩 페이지 큐레이션 (배너, 추천 상품)

#### M-Landing (랜딩 큐레이션)
- **책임:** 반응형 메인 페이지. 관리자가 설정한 큐레이션 노출
- **컴포넌트:**
  - HeroBanner (반응형 비율 다름: PC 16:6, Mobile 4:5)
  - CategoryGrid
  - FeaturedCollection
  - RecentReviews (Phase 2)

---

## 6. 데이터 모델 (DB 스키마 요약)

```sql
-- 카테고리
CREATE TABLE categories (
  id          uuid PRIMARY KEY,
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  parent_id   uuid REFERENCES categories(id),  -- 트리 구조
  sort_order  int DEFAULT 0,
  is_active   boolean DEFAULT true
);

-- 상품 (액자 종류)
CREATE TABLE products (
  id            uuid PRIMARY KEY,
  category_id   uuid REFERENCES categories(id),
  name          text NOT NULL,          -- "베이직 액자"
  tagline       text,                    -- "가장 인기 있는..."
  description   text,                    -- 마크다운 본문
  base_price    int NOT NULL,            -- 4800
  has_frame     boolean DEFAULT true,    -- 프레임 있음/없음 분류
  is_active     boolean DEFAULT true,
  sort_order    int DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- 상품 이미지 (상세설명용 다중 이미지)
CREATE TABLE product_images (
  id          uuid PRIMARY KEY,
  product_id  uuid REFERENCES products(id) ON DELETE CASCADE,
  image_url   text NOT NULL,
  alt_text    text,
  type        text CHECK (type IN ('thumbnail','gallery','guide')),
  sort_order  int DEFAULT 0
);

-- 프레임 옵션 (PNG 오버레이)
CREATE TABLE frame_assets (
  id            uuid PRIMARY KEY,
  product_id    uuid REFERENCES products(id),
  color_code    text NOT NULL,           -- 'black' | 'brown' | 'white' ...
  color_label   text NOT NULL,           -- "블랙"
  png_url       text NOT NULL,           -- 프레임 PNG (투명 중앙)
  inner_rect    jsonb NOT NULL,          -- {x,y,w,h} 사진이 들어갈 위치 (정규화 0~1)
  preview_url   text                     -- 옵션 선택 시 썸네일
);

-- 옵션 매트릭스 (사이즈 × 색상 × 매트 × 인화지)
CREATE TABLE product_variants (
  id            uuid PRIMARY KEY,
  product_id    uuid REFERENCES products(id),
  size_code     text NOT NULL,           -- '4x6' | '5x7' | '8x10' | '11x14'
  size_label    text NOT NULL,           -- "4X6 (10x15cm)"
  width_mm      int NOT NULL,            -- 인쇄용 mm
  height_mm     int NOT NULL,
  color_code    text NOT NULL,
  matte_code    text NOT NULL,           -- 'none' | 'with'
  paper_code    text NOT NULL,           -- 'glossy' | 'matte' | 'fineart'
  price         int NOT NULL,
  stock         int DEFAULT 99999,
  is_active     boolean DEFAULT true,
  UNIQUE(product_id, size_code, color_code, matte_code, paper_code)
);

-- 사진 자산 (사용자 업로드)
CREATE TABLE photos (
  id          uuid PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id),
  original_url text NOT NULL,
  thumb_url   text NOT NULL,
  width_px    int,
  height_px   int,
  exif        jsonb,
  created_at  timestamptz DEFAULT now()
);

-- 장바구니 (DB 동기화용)
CREATE TABLE cart_items (
  id            uuid PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id),
  variant_id    uuid REFERENCES product_variants(id),
  photo_id      uuid REFERENCES photos(id),
  crop_transform jsonb NOT NULL,         -- {x,y,scale,rotation}
  preview_url   text,
  quantity      int DEFAULT 1,
  created_at    timestamptz DEFAULT now()
);

-- 주문
CREATE TABLE orders (
  id            uuid PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id),
  order_no      text UNIQUE NOT NULL,    -- '20260511-0001'
  status        text NOT NULL,           -- 'CREATED' | 'PAID' | ...
  total_price   int NOT NULL,
  shipping_fee  int DEFAULT 0,
  payment_id    text,                    -- PG 거래 ID
  orderer       jsonb,                   -- {name, phone, email}
  shipping      jsonb,                   -- {name, phone, zip, addr1, addr2, memo}
  created_at    timestamptz DEFAULT now(),
  paid_at       timestamptz,
  shipped_at    timestamptz
);

-- 주문 아이템 (스냅샷 저장)
CREATE TABLE order_items (
  id            uuid PRIMARY KEY,
  order_id      uuid REFERENCES orders(id) ON DELETE CASCADE,
  variant_snapshot jsonb NOT NULL,       -- 가격/옵션 스냅샷
  photo_url     text NOT NULL,
  crop_transform jsonb NOT NULL,
  print_file_url text,                   -- 300dpi 인쇄용 결과물
  quantity      int NOT NULL,
  price         int NOT NULL
);

-- 큐레이션 (랜딩 페이지 진열)
CREATE TABLE curations (
  id          uuid PRIMARY KEY,
  type        text CHECK (type IN ('banner','collection','feature')),
  title       text,
  payload     jsonb,                     -- 자유 형식
  device      text CHECK (device IN ('all','pc','mobile')),
  start_at    timestamptz,
  end_at      timestamptz,
  is_active   boolean DEFAULT true,
  sort_order  int DEFAULT 0
);
```

### 6.1 RLS 정책 요약
- `categories`, `products`, `product_images`, `frame_assets`, `product_variants`, `curations`: **누구나 SELECT**, 관리자만 변경
- `photos`, `cart_items`: **본인만 SELECT/INSERT/UPDATE/DELETE**
- `orders`, `order_items`: **본인 + 관리자만 SELECT**, 생성은 본인, 상태 변경은 관리자

---

## 7. 세부 유스케이스

### UC-01. 사용자가 액자를 주문한다 (Happy Path)

```
사용자 시나리오                       시스템 동작
─────────────────────────────       ─────────────────────────────
1. 랜딩 진입                  →     M-Landing이 큐레이션 로드, ISR 캐시
2. "베이직 액자" 카드 클릭     →     M-Catalog → M-ProductDetail
3. 상품 상세 확인              →     상세 이미지, 제작가이드 표시
4. "주문하기" 클릭             →     /studio/[새 세션 ID] 라우팅
5. "사진 가져오기" 선택        →     M-PhotoSource 모달
6. "휴대폰 사진" 탭            →     <input type="file"> 호출
7. 사진 선택 → 업로드          →     M-PhotoPicker → Supabase Storage
                                    EXIF 자동 회전, thumb 생성
8. 편집기 진입                 →     M-FrameEditor 마운트
                                    - 기본 옵션(가장 작은 사이즈/블랙) 로드
                                    - Konva Stage 초기화
                                    - 사진을 inner_rect에 fit-cover 배치
9. 옵션 [액자색상] → 브라운     →     frame_assets에서 브라운 PNG 즉시 교체
                                    가격 재계산 (variant 조회)
10. 옵션 [매트] → 있음          →     매트 레이어 추가/제거, 사진 사이즈 조정
11. 사진 드래그 / 핀치 줌      →     M-CropEditor가 cropTransform 업데이트
12. "장바구니 담기"            →     M-Cart.addToCart()
                                    - 미리보기 PNG를 Stage.toDataURL()로 생성
                                    - Supabase Storage에 저장
                                    - cart_items insert
13. /checkout 이동             →     M-Checkout 폼 노출
14. 배송지 입력 / 우편번호      →     카카오 우편번호 API
15. "결제하기" 클릭            →     M-Payment.requestPayment()
                                    토스/포트원 SDK 호출
16. 결제 완료                  →     PG 콜백 → /api/webhook/payment
                                    M-Order.transitionTo(PAID)
                                    인쇄 큐 enqueue (Edge Function)
17. 주문 완료 페이지            →     주문번호 표시
                                    백그라운드: 300dpi 인쇄용 PNG 렌더링
                                    관리자 알림 (이메일/슬랙)
```

### UC-02. 관리자가 새 액자 상품을 등록한다

```
1. /admin/products → "신규 등록"
2. 기본 정보: 이름, 카테고리, 태그라인, 본문 마크다운
3. 프레임 옵션: PNG 업로드, 색상 코드, inner_rect 설정 (드래그 UI)
4. 변형(Variant) 매트릭스:
   - 사이즈 × 색상 × 매트 × 인화지 조합을 CSV import 또는 일괄 생성
   - 각 조합별 가격 입력
5. 상품 이미지: 썸네일/갤러리/제작가이드 분류 업로드
6. "활성화" 토글 → 사용자 화면에 즉시 노출
```

### UC-03. 관리자가 주문을 처리한다

```
1. /admin/orders → 신규 주문 리스트 (실시간)
2. 주문 상세 클릭
   - 사용자 배송 정보
   - 인쇄 파일 다운로드 (300dpi PNG/PDF)
   - 미리보기 이미지 비교
3. "제작 시작" → status: IN_PRODUCTION
4. "출하" → 운송장 번호 입력 → status: SHIPPED
   사용자에게 알림 (이메일/SMS)
5. 자동: 배송 추적 API로 SHIPPED → DELIVERED 전환
```

### UC-04. 사용자가 명화 이미지로 액자를 주문한다

```
1. /studio/[id] → "명화이미지" 선택
2. 관리자가 등록한 스톡 갤러리 표시 (라이선스 정리 완료된 이미지)
3. 선택 → cropTransform 기본값 (가운데 fit-cover)
4. 이후 UC-01의 8단계부터 동일
```

### UC-05. 비회원 주문 / 회원가입 분기

```
- 비회원: cart_items는 LocalStorage. 체크아웃 시 비회원 주문 모드로 진행
  - 주문번호로 조회 가능 (이메일/전화번호 + 주문번호)
- 회원: 자동 sync. 마이페이지에서 주문 내역 조회
```

---

## 8. QA 시나리오 (테스트 케이스)

### 8.1 단위 테스트 (Vitest)

| ID | 대상 | 시나리오 | 기대 결과 |
|---|---|---|---|
| UT-01 | `calculatePrice(variant, qty)` | 옵션 매트릭스 기반 가격 계산 | 정확한 합계 |
| UT-02 | `applyCropTransform(image, transform)` | 회전/스케일 변환 | Konva Image 속성 정확 |
| UT-03 | `fitPhotoToFrame(photoSize, innerRect)` | 사진을 프레임 inner_rect에 fit-cover | center crop, 비율 유지 |
| UT-04 | `validateCheckoutForm(data)` | 필수 필드 검증 (전화번호 형식 등) | 정확한 에러 메시지 |
| UT-05 | `orderStateMachine.transition(from, to)` | 잘못된 전이 차단 (예: DELIVERED→PAID) | throw |
| UT-06 | `parseExif(buffer)` | 회전 메타데이터 추출 | orientation 정확 |
| UT-07 | `serializeCartItem(item)` | DB 저장용 JSON 직렬화 | 라운드트립 무결 |
| UT-08 | `priceMatrix.lookup(size,color,...)` | 변형 조회 | 일치하는 1건 또는 null |

### 8.2 컴포넌트 / 통합 테스트 (Testing Library)

| ID | 시나리오 |
|---|---|
| IT-01 | `<FrameEditor>` 색상 변경 → 프레임 PNG src 변경 |
| IT-02 | `<FrameEditor>` 매트 토글 → 사진 영역 축소 |
| IT-03 | `<PhotoGallery>` 사진 선택 → onSelect 콜백 호출 |
| IT-04 | `<CheckoutForm>` 우편번호 검색 → 주소 자동 채움 |
| IT-05 | `<AdminProductForm>` 변형 CSV 업로드 → 옵션 매트릭스 생성 |
| IT-06 | Cart Zustand → 로그인 시 DB와 sync |

### 8.3 E2E 테스트 (Playwright)

| ID | 플로우 |
|---|---|
| E2E-01 | 비회원 풀 플로우: 랜딩 → 편집 → 장바구니 → 결제(test mode) → 완료 |
| E2E-02 | 회원 가입 → 사진 업로드 → 옵션 변경 3회 → 주문 |
| E2E-03 | 관리자 상품 등록 → 사용자 카탈로그에서 즉시 노출 |
| E2E-04 | 모바일 뷰포트 (iPhone 12) 편집기 핀치 줌 |
| E2E-05 | PC 뷰포트 (1920×1080) 반응형 레이아웃 |
| E2E-06 | 결제 실패 시 주문 상태 복구 |

### 8.4 시각 회귀 테스트 (Optional / Phase 2)
- Playwright + percy.io 또는 Chromatic으로 옵션 변경 시 미리보기 PNG 회귀 검증

### 8.5 성능 / 부하 기준

| 항목 | 기준 |
|---|---|
| 랜딩 LCP (Mobile 4G) | < 2.5s |
| 편집기 옵션 변경 → 재렌더 | < 100ms |
| 미리보기 PNG 생성 | < 1s (모바일) |
| 300dpi 인쇄 렌더 (서버) | < 30s |
| 동시 주문 처리 | 50 TPS 이상 (Vercel + Supabase 기본) |

---

## 9. 개발 단계 (Phase별 로드맵)

### Phase 0. 환경 세팅 (1주)
- Next.js 15 프로젝트 초기화
- Supabase 프로젝트 생성, 스키마 마이그레이션
- shadcn/ui 설치, Tailwind 토큰 정의
- Vercel 연결, 환경변수 분리
- **에이전트 준비:** `agents/` 디렉토리 생성, 공유 상태 파일 설정

### Phase 1. MVP (4주) — 최소 주문 가능 상태
- M-Catalog + M-ProductDetail (1개 카테고리, 1개 상품 시드)
- M-PhotoPicker (디바이스만, 클라우드/명화 제외)
- M-FrameEditor + M-CropEditor (옵션은 사이즈/색상 2개씩만)
- M-Cart + M-Checkout + M-Payment (토스 단일 PG)
- M-Order (상태 머신 + 관리자 알림 이메일만)
- M-Admin (상품/주문 CRUD)
- 반응형 모바일 우선 (PC는 모바일 레이아웃 가운데 정렬)

### Phase 2. 확장 (3주) — 보안 하드닝 + 핵심 기능 완성

**완료 (2026-05-13):**
- ✅ P0~P1 보안 하드닝 8건 (결제 위변조·SSRF·소유권·타이밍공격·버킷 비공개·웹훅 재생·레이스컨디션·레이트리밋)
- ✅ 인쇄 렌더 영속화 (`print_render_jobs` + Vercel Cron 재시도, P1-06)
- ✅ 비회원 주문 조회 (`/api/orders/lookup`, IP 레이트리밋 포함, P2-08)
- ✅ Unsplash CDN → Supabase Storage 마이그레이션 (P1-07)
- ✅ 로그인 레이트리밋 5회/15분 (P1-05)

**미완료 (Phase 3으로 이동):**
- 옵션 매트릭스 풀 지원 (매트/인화지 추가)
- 명화이미지 갤러리
- 우편번호 API 정식 연동
- 큐레이션 시스템 (랜딩 배너/컬렉션)
- PC 전용 반응형 레이아웃 최적화

> ⚠️ **운영 주의 — Vercel Hobby 플랜 cron 제약:**  
> `/api/cron/render-retry`는 현재 하루 1회(01:00 UTC) 실행됩니다.  
> 렌더 실패 발생 시 최대 24시간 후 재시도됩니다.  
> Pro 플랜 업그레이드 후 `vercel.json` schedule을 `*/5 * * * *` 으로 변경하면 5분 주기 재시도가 가능합니다.

### Phase 3. 고도화 (4주)
- 클라우드 사진 가져오기 (구글/원드라이브 OAuth)
- 300dpi 인쇄용 자동 렌더링 워커
- 다중 PG (포트원 통합)
- 마이페이지 (주문 내역, 재주문)
- 리뷰 시스템
- 모니터링 (Sentry, 대시보드)

### Phase 4. 운영 (지속)
- A/B 테스트 (전환율)
- SEO 최적화 (ISR + sitemap)
- 시각 회귀 테스트
- 다국어 (i18n) — 영어 우선

---

## 10. TDD 개발 방법론 적용

### 10.1 핵심 원칙
1. **Red → Green → Refactor**
2. **모든 비즈니스 로직은 테스트 우선**
3. **컴포넌트는 통합 테스트 + E2E로 커버**
4. **테스트 커버리지 목표: 핵심 모듈 80% 이상**

### 10.2 TDD 필수 적용 영역 (1순위)
- 가격 계산 (`calculatePrice`)
- 옵션 매트릭스 조회 (`priceMatrix.lookup`)
- Crop Transform 변환 (`applyCropTransform`)
- 주문 상태 머신 (`orderStateMachine`)
- 결제 콜백 검증 (`verifyPaymentWebhook`)

### 10.3 TDD 적용 권장 영역 (2순위)
- 폼 유효성 검증
- Cart 직렬화/역직렬화
- EXIF 파싱

### 10.4 컴포넌트/E2E로 커버 (3순위)
- UI 인터랙션
- 라우팅
- API 통합

### 10.5 테스트 디렉토리 구조

```
tests/
├── unit/
│   ├── modules/
│   │   ├── catalog.test.ts
│   │   ├── editor.test.ts
│   │   ├── order.test.ts
│   │   └── payment.test.ts
│   └── lib/
│       ├── konva-helpers.test.ts
│       └── image-exif.test.ts
├── integration/
│   ├── editor-flow.test.tsx
│   ├── checkout-flow.test.tsx
│   └── admin-product.test.tsx
└── e2e/
    ├── user-purchase.spec.ts
    ├── admin-management.spec.ts
    ├── mobile-editor.spec.ts
    └── responsive-landing.spec.ts
```

---

## 11. Claude Code 멀티 에이전트 팀 구성

### 11.1 에이전트 7인 체제 (자율 운영)

| Agent | 역할 | 산출물 | 다음 단계로 신호 |
|---|---|---|---|
| **🧭 Planner** | 요구사항 분해, 유스케이스 명세, 모듈 경계 확정 | `docs/specs/*.md`, `shared/STATUS.md` | 모든 모듈 spec 완료 |
| **🏛️ Architect** | 타입 시스템, DB 스키마, 모듈 인터페이스 정의 | `src/types/*.ts`, `supabase/migrations/*.sql` | 타입/스키마 commit |
| **🎨 Designer** | 디자인 토큰, 컴포넌트 라이브러리, Figma → 코드 | `src/components/ui/*`, `tailwind.config.ts` | 디자인 시스템 v1 완성 |
| **⚙️ Backend Dev** | Supabase 연동, Route Handlers, Edge Functions, 결제 | `src/lib/supabase/*`, `app/api/*` | 모든 API 통과 |
| **💻 Frontend Dev** | Next.js 페이지, Konva 캔버스, Zustand 스토어 | `app/**/page.tsx`, `src/modules/**/components/*` | 페이지별 E2E pass |
| **🧪 Tester** | 모든 테스트 작성 (TDD 우선), CI 설정 | `tests/**/*.test.ts`, `.github/workflows/test.yml` | 커버리지 80% 도달 |
| **🛡️ QC / Reviewer** | 코드 리뷰, 보안 감사 (RLS, 결제 위변조), 성능 측정 | `docs/audit/*.md`, GitHub PR 코멘트 | 모든 P0 이슈 closed |

### 11.2 에이전트 협업 프로토콜

```
shared/                              # 모든 에이전트가 읽고 쓰는 상태 저장소
├── STATUS.md                        # 전체 진행 상황 (단일 진실 원천)
├── HANDOFF.md                       # 에이전트 간 인계 사항
├── BLOCKERS.md                      # 막힌 이슈
├── DECISIONS.md                     # 의사결정 기록 (ADR)
└── INTERFACES/
    ├── types-frozen.md              # Architect가 확정한 타입 (변경 시 모두 sync)
    └── api-contract.md              # Backend ↔ Frontend 계약
```

### 11.3 작업 흐름 (오토파일럿)

```
Phase 0: Planner → docs/specs 작성
   ↓
Phase 1: Architect → 타입/스키마 동결
   ↓ (병렬 시작 가능)
Phase 2 ┬─ Designer → 디자인 시스템
        ├─ Backend Dev → API/DB
        └─ Tester → 테스트 스켈레톤 + Red 상태
   ↓
Phase 3: Frontend Dev → 페이지 구현 (Backend API + 디자인 시스템 사용)
        Tester → Green 만들기 + E2E 작성
   ↓
Phase 4: QC → 리뷰/감사 → 발견 이슈를 각 Agent에 할당
   ↓
릴리즈
```

### 11.4 각 에이전트의 시스템 프롬프트 핵심 (실제 사용자가 직접 셋업)

> **사용자(Papas)가 Claude Code에서 다음 명령으로 sub-agent를 등록한다.**

#### Planner 에이전트
```
You are the Planner for FrameShop project.
- Read docs/specs/ first.
- Your job: refine use cases, identify edge cases, write acceptance criteria.
- Output: docs/specs/<module>.md
- Never write production code.
- After completing a spec, update shared/STATUS.md and shared/HANDOFF.md.
- Ask for clarification only via shared/BLOCKERS.md.
```

#### Architect 에이전트
```
You are the Architect for FrameShop.
- Read docs/specs/ and shared/DECISIONS.md.
- Your job: define TypeScript types, Supabase schemas, and module interfaces.
- Output: src/types/*.ts, supabase/migrations/*.sql, shared/INTERFACES/types-frozen.md.
- Once types are committed, they are FROZEN. Any change requires shared/DECISIONS.md ADR.
- Use strict mode. No 'any' allowed.
```

#### Designer 에이전트
```
You are the Designer.
- Read /mnt/skills/public/frontend-design/SKILL.md FIRST.
- Reference ZZIXX aesthetic: minimal, dark header (#2A2A2A), white body, red accent (#E74C3C) for prices.
- Output: tailwind tokens, shadcn/ui customizations, src/components/ui/*.
- Korean typography: Pretendard primary, Spoqa Han Sans fallback.
- Mobile-first; desktop is enhancement.
```

#### Backend Dev 에이전트
```
You are the Backend Developer.
- Read shared/INTERFACES/types-frozen.md FIRST.
- Implement Supabase queries, Route Handlers, Edge Functions, payment integration.
- Never expose service_role_key to client.
- All inputs validated with Zod.
- After each module: run tests/integration/<module>.test.ts and confirm pass.
```

#### Frontend Dev 에이전트
```
You are the Frontend Developer.
- Read shared/INTERFACES/types-frozen.md and components/ui/ first.
- Build pages in app/, modules in src/modules/.
- Konva canvas MUST use dynamic import with ssr:false.
- Use Zustand for editor state; never useState for canvas data.
- Mobile-first responsive; test in 375px viewport first.
```

#### Tester 에이전트
```
You are the Tester. Follow TDD strictly.
- Write tests BEFORE asking Developers to implement.
- 1st priority: unit tests for business logic (price, crop, order state).
- Use Vitest + Testing Library + Playwright.
- Maintain >80% coverage on src/modules/.
- Block merges if any test fails.
```

#### QC / Reviewer 에이전트
```
You are QC and Security Reviewer.
- Run after each Phase completion.
- Review: type safety, RLS policies, payment webhook signature verification, image upload size limits.
- Output findings to docs/audit/phase-<n>.md with P0/P1/P2 severity.
- P0 must be fixed before next phase.
```

### 11.5 실행 가이드 (Papas가 직접 진행할 부분)

```bash
# 1. 프로젝트 초기화
mkdir frameshop && cd frameshop
git init
npx create-next-app@latest . --typescript --tailwind --app --src-dir

# 2. 에이전트 디렉토리 셋업
mkdir -p agents shared docs/specs supabase/migrations
touch shared/STATUS.md shared/HANDOFF.md shared/DECISIONS.md shared/BLOCKERS.md

# 3. Claude Code 세션 시작 (메인 세션)
claude

# 4. 각 sub-agent를 정의 (Claude Code에 등록)
# /agents 명령 또는 .claude/agents/<name>.md 생성

# 5. 첫 번째 명령
"Planner, FrameShop 개발계획서를 읽고 docs/specs/catalog.md부터 작성해줘.
이후 product, photo, editor, cart, checkout, payment, order, admin, landing 순서로 진행해."
```

---

## 12. 스킬 확인 / 추가 단계 (필수 포함)

### 12.1 프로젝트 시작 시 검증된 스킬 확인

```bash
# Claude Code 세션에서 가장 먼저 실행
ls /mnt/skills/public/

# 이 프로젝트에 필수:
view /mnt/skills/public/frontend-design/SKILL.md       # UI 디자인 표준
view /mnt/skills/public/product-self-knowledge/SKILL.md # Anthropic 제품 지식
```

### 12.2 신규 생성이 필요한 커스텀 스킬

| 스킬명 | 필요 이유 | 우선순위 |
|---|---|---|
| **konva-canvas-patterns** | Konva 이미지 변환/마스킹/터치 제스처 표준 패턴 | P0 |
| **supabase-storage-image** | 이미지 업로드/리사이즈/EXIF 처리 표준 | P0 |
| **toss-payment-integration** | 토스페이먼츠 v2 통합 + 웹훅 검증 | P1 |
| **printable-rendering** | 300dpi 인쇄용 PNG/PDF 생성 (Printable 프로젝트와 공유 가능) | P1 |
| **korean-typography-web** | Pretendard 폰트 로딩, 자간/줄간격 표준 | P2 |

> 스킬 생성은 `/mnt/skills/examples/skill-creator/SKILL.md`를 참조한다. 각 스킬은 SKILL.md + 예제 코드를 포함.

### 12.3 스킬 사용 권장 시점

| 시점 | 호출할 스킬 |
|---|---|
| Designer 작업 시작 | `frontend-design` |
| Backend Dev 결제 모듈 | `toss-payment-integration` |
| Frontend Dev 편집기 | `konva-canvas-patterns` |
| Backend Dev 이미지 처리 | `supabase-storage-image` |
| Phase 3 인쇄 렌더링 | `printable-rendering` |

---

## 13. 의사결정 사항 정리 (ADR 후보)

| # | 결정 | 대안 | 근거 |
|---|---|---|---|
| ADR-01 | 편집기에 Konva 채택 | Fabric.js, Canvas API 직접 | 모바일 터치 + PNG 오버레이에 최적 |
| ADR-02 | 모바일 우선 디자인 | 데스크탑 우선 | 한국 소비자 60%+ 모바일 주문 |
| ADR-03 | Supabase 단일 사용 | 별도 DB+Auth | Papas 다른 프로젝트와 일관성 |
| ADR-04 | 토스페이먼츠 우선 | 포트원, KCP | 한국 시장 표준, API 문서 우수 |
| ADR-05 | 클라이언트에서 미리보기, 서버에서 300dpi 재렌더링 | 클라이언트 고해상도 | 모바일 메모리 한계 회피 |
| ADR-06 | 변형(variant) 미리 생성 | 동적 가격 계산 | 옵션 조합당 가격이 비선형이라 매트릭스가 명료 |
| ADR-07 | 큐레이션 별도 테이블 | 상품에 플래그 | 시즌/이벤트 노출 유연성 |

---

## 14. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| 사진 업로드 시 모바일 메모리 부족 | 편집기 크래시 | 클라이언트에서 1600px로 리사이즈, 원본은 서버 업로드 |
| 인쇄 결과와 미리보기 색차 | CS 증가 | 디스플레이 색공간(sRGB) → 인쇄 ICC 프로파일 적용. 면책 고지 |
| 옵션 매트릭스 수 폭증 | 어드민 UX 저하 | CSV import/export 지원. 컬러+사이즈 2D 표 UI |
| 결제 위변조 | 매출 손실 | PG 웹훅 서명 검증 필수. Edge Function에서만 status 변경 |
| Konva SSR 충돌 | 빌드 실패 | `dynamic(() => import(...), { ssr: false })` 패턴 강제 |
| 모바일 키보드가 편집기 가림 | UX 저하 | `visualViewport` API로 키보드 감지, 캔버스 자동 스크롤 |
| 대용량 사진(50MB+) | 업로드 실패 | 클라이언트 사전 리사이즈 + 사이즈 검증 |

---

## 15. 시작 체크리스트 (Papas 즉시 실행)

- [ ] **Step 1.** 이 문서를 `frameshop/docs/PLAN.md`로 저장
- [ ] **Step 2.** 7개 에이전트 정의를 `.claude/agents/*.md`에 작성
- [ ] **Step 3.** Supabase 프로젝트 생성, `.env.local` 설정
- [ ] **Step 4.** Claude Code 세션 시작 → `"Planner, PLAN.md를 읽고 docs/specs/catalog.md를 작성해줘"`
- [ ] **Step 5.** Planner 완료 후 Architect 호출 → 타입 동결
- [ ] **Step 6.** 병렬 트랙(Designer + Backend + Tester) 시작
- [ ] **Step 7.** Phase 1 마감일 설정 (4주 후)
- [ ] **Step 8.** 매주 금요일 QC 리뷰 라운드

---

## 부록 A. 핵심 타입 시그니처 (Architect 출발점)

```typescript
// src/types/product.ts
export type Category = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
};

export type Product = {
  id: string;
  categoryId: string;
  name: string;
  tagline: string;
  description: string;
  basePrice: number;
  hasFrame: boolean;
  thumbnail: string;
};

export type FrameAsset = {
  id: string;
  productId: string;
  colorCode: string;
  colorLabel: string;
  pngUrl: string;
  innerRect: { x: number; y: number; w: number; h: number }; // 정규화 0~1
};

export type ProductVariant = {
  id: string;
  productId: string;
  sizeCode: string;
  sizeLabel: string;
  widthMm: number;
  heightMm: number;
  colorCode: string;
  matteCode: 'none' | 'with';
  paperCode: 'glossy' | 'matte' | 'fineart';
  price: number;
};

// src/types/editor.ts
export type CropTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type EditorState = {
  productId: string;
  selectedVariantId: string;
  photoId: string | null;
  cropTransform: CropTransform;
  previewDataUrl: string | null;
};

// src/types/order.ts
export type OrderStatus =
  | 'CREATED'
  | 'PAID'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type Order = {
  id: string;
  orderNo: string;
  userId: string | null;
  status: OrderStatus;
  totalPrice: number;
  orderer: { name: string; phone: string; email: string };
  shipping: {
    name: string;
    phone: string;
    zip: string;
    addr1: string;
    addr2: string;
    memo: string;
  };
  paidAt: string | null;
  shippedAt: string | null;
};
```

---

*이 문서는 FrameShop 프로젝트의 단일 진실 원천(Single Source of Truth)이다. 변경 사항은 `shared/DECISIONS.md`에 ADR로 기록한다.*
