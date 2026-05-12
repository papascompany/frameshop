# FrameShop 편집기 — 합성·인쇄 사양서

> **단일 진실 원천(SSOT).** Frame editor의 모든 기능·제약·좌표계는 이 문서를 따른다. 변경은 `shared/DECISIONS.md`에 ADR을 추가한 뒤 갱신한다.
>
> **출처:** docs/PLAN.md §5.2 (M-FrameEditor / M-CropEditor), §6 (frame_assets / product_variants), §13 ADR-001 / ADR-005, §14 리스크, docs/specs/editor.md, 운영 피드백 (2026-05-12: "검은 화면, inner-fit 미동작").

---

## 1. 핵심 개념 한 줄 요약

- **액자 프레임(`frame_assets`)** = 가운데가 알파 투명인 PNG. 사용자 사진은 그 투명 구멍(`inner_rect`)으로 들여다보이듯 합성된다.
- **편집기**는 항상 **두 좌표계**가 공존한다: ① Konva Stage 픽셀(미리보기, 화면 색공간 sRGB) · ② 인쇄 mm(`product_variants.width_mm/height_mm` 기준, 300dpi 변환, sRGB→ICC 적용).
- **2mm 블리드(bleed)** 는 인쇄 렌더링에서 **반드시** 외곽 +2mm씩 사진이 채워져야 한다. 미세 재단 오차로 인쇄물 외곽에 흰 띠가 생기는 것을 막는다.

---

## 2. 데이터 모델 (DB ↔ 편집기 매핑)

### 2.1 `frame_assets` 테이블 (한 상품당 N개)

| 컬럼 | 의미 | 편집기에서의 역할 |
|---|---|---|
| `product_id` | 상품 FK | 상품 상세에서 해당 product_id의 모든 frame_assets를 fetch |
| `color_code` | 'black' / 'brown' / 'white' / ... | 사용자가 액자 색상 옵션 변경 → 같은 product에서 `color_code` 일치하는 row로 즉시 swap |
| `png_url` | 액자 PNG 공개 URL | Konva `Image` 노드 source. 가운데가 알파 투명 |
| `inner_rect` | **정규화 0..1 직사각형** `{x, y, w, h}` | 사진이 들어갈 영역. PNG 안에서 사진이 보일 viewport |
| `preview_url` | 색상 스와치 썸네일 | OptionTabs의 색상 칩 미리보기 |

**`inner_rect`는 PNG 픽셀 기준 정규화**이며 Stage 픽셀 기준이 아니다. 예:
- 1200×1500 PNG 안에서 가운데 1000×1300 영역이 투명이면 `inner_rect = { x: 100/1200, y: 100/1500, w: 1000/1200, h: 1300/1500 } = { x: 0.0833, y: 0.0667, w: 0.8333, h: 0.8667 }`.
- **정규화로 저장하는 이유:** 같은 디자인의 프레임을 다른 해상도로 재제작해도 inner_rect는 동일하다.

### 2.2 `product_variants` 테이블 (사이즈 × 색상 × 매트 × 인화지)

| 컬럼 | 의미 | 편집기에서의 역할 |
|---|---|---|
| `width_mm`, `height_mm` | **실제 인쇄 사이즈(mm)** | Stage 종횡비 + 인쇄 캔버스 픽셀 계산의 기준 |
| `size_code` (4x6, 5x7, ...) | 사용자 UI 라벨 | OptionTabs 사이즈 칩 |
| `color_code` | 'black' 등 | `frame_assets.color_code`와 매칭. variant에 있고 frame_assets에 없으면 사용자 노출 금지 (Architect 검증) |
| `matte_code` | 'none' / 'with' | Phase 2: 매트 레이어 두께 5–15mm 시각화. Phase 1: 노출만, 시각 미반영 |
| `paper_code` | 'glossy' / 'matte' / 'fineart' | 시각 효과 없음. 가격/인쇄 옵션만 |

**variant의 `width_mm:height_mm` 비율 = Stage 종횡비** (예: 4×6 = 102×152 → 약 2:3 portrait). 사용자가 사이즈 변경 시 Stage 비율도 즉시 변경된다.

### 2.3 `CropTransform` (편집기 상태)

```ts
type CropTransform = {
  x: number;        // Stage 픽셀 좌표 — 사진의 회전 중심(=사진 중앙)이 놓일 위치
  y: number;
  scale: number;    // 1.0 = 사진 자연 사이즈 그대로. fit-cover scale은 lookup 시 계산
  rotation: number; // 도(degree). 양수 = 시계 방향
};
```

**이동·확대·회전 모두 사진의 자연 중앙을 기준점(pivot)으로** 한다 (Konva `offsetX = naturalWidth/2`, `offsetY = naturalHeight/2`). 이렇게 해야 회전이 직관적이고, 사이즈 변경(Stage 비율 변경) 시 사진의 중앙이 새 inner_rect 중앙으로 자동 정렬된다.

---

## 3. 좌표계 변환 (Coordinate Pipeline)

```
[사진 자연 픽셀]                                        ← 업로드 원본 (1600px 리사이즈 후)
       │ × scale (자연 → Stage 비율로 fit-cover)
       ▼
[Stage 픽셀] (예: 600 × 750)                           ← 미리보기 (Konva)
       │ × (variant.width_mm / Stage.w)
       ▼
[인쇄 mm 좌표] (예: 102 × 152 mm at 300dpi)
       │ × (300 / 25.4) → mm to px
       ▼
[인쇄 픽셀] (예: 1205 × 1795 px)                       ← 300dpi 인쇄 출력
       + 2mm 블리드 4면 확장
       ▼
[블리드 포함 인쇄 픽셀] (예: 1252 × 1842 px)            ← 최종 파일
```

**모든 변환 = 단일 스케일 팩터 + 단일 평행 이동.** 회전은 Konva가 처리 (사진에만 적용, frame PNG에는 미적용).

### 3.1 인쇄 픽셀 계산식

```ts
const PRINT_DPI = 300;
const MM_PER_INCH = 25.4;
const BLEED_MM = 2;

function mmToPx(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * PRINT_DPI);
}

// variant.width_mm = 102 (4×6 가로)
const printWidthPx = mmToPx(102);              // 1205 px
const printWithBleedPx = mmToPx(102 + 2 * BLEED_MM); // 1252 px
```

### 3.2 inner_rect의 두 가지 해석

| 컨텍스트 | inner_rect 적용 | 비고 |
|---|---|---|
| **Stage(미리보기)** | `innerRectPx = { x: rect.x * stage.w, y: rect.y * stage.h, w: rect.w * stage.w, h: rect.h * stage.h }` | 사진 clip 영역 |
| **인쇄 캔버스** | `innerRectPrintPx = { x: rect.x * printW, ... }` + 블리드 좌표 오프셋 | 사진 합성 영역 |

**Stage 종횡비는 variant의 mm 비율을 따른다.** 동시에 inner_rect는 PNG 픽셀 비율 기준이라 두 비율이 다를 수 있다. **Stage 비율이 우선**이며 PNG는 inner_rect의 비율을 그 위에 덧붙이는 형태로 그려진다. 즉:

- Stage = variant 비율 (예: 2:3 portrait)
- frame PNG는 Stage 풀-사이즈로 stretch (가운데 투명 부분이 inner_rect 영역과 겹침)
- 사진은 inner_rect 영역으로 clip되어 그 안에서만 보임

**제약:** frame PNG의 종횡비와 variant의 종횡비가 일치하지 않으면 PNG가 stretch되어 액자가 찌그러져 보인다. **Architect/Admin은 같은 product 안의 frame_assets와 variants가 비율 일관성을 유지하도록 강제**해야 한다. 어긋나는 경우 Admin 폼 단계에서 경고.

---

## 4. 합성 패턴 (미리보기, Konva)

### 4.1 Stage 구조

```
Stage  (width: variantRatio × baseSize)
└─ Layer (single)
   ├─ Group "clip"          ← clipFunc로 inner_rect 영역만 노출
   │  └─ KonvaImage photo   ← 사진 (드래그·확대·회전 가능)
   └─ KonvaImage frame      ← frame PNG (listening:false, listening 안 받음)
```

**중요:**
- 사진 Group이 frame PNG **아래**에 와야 한다. (Layer 안에서 자식 순서 = z-order 하위→상위.)
- frame PNG는 `listening:false`라 클릭/드래그가 사진에 전달된다.
- clip Group 안의 사진은 **inner_rect 밖으로 새어나가지 않는다**. clipFunc로 정확한 사각형 클리핑.

### 4.2 clipFunc 구현

```ts
// Group 안에서 inner_rect 영역만 자식을 그림
<Group
  clipFunc={(ctx) => {
    const r = innerRectPx; // { x, y, w, h } in stage pixels
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.closePath();
  }}
>
  <KonvaImage ... />
</Group>
```

### 4.3 사진 초기 배치 (fit-cover)

사진 업로드 직후, 또는 사이즈/색상 변경 직후:
1. inner_rect를 Stage 픽셀로 변환 (`innerRectPx`)
2. **fit-cover scale 계산**: `scale = max(innerRectPx.w / photo.w, innerRectPx.h / photo.h)`
3. 위치: 사진 중앙을 innerRectPx 중앙에 맞춤
4. rotation은 0으로 리셋 (사진 변경 시) / 유지 (옵션만 변경 시)

**기존 `fitPhotoToFrame`은 fit-cover 로직만 맞고 사용 자체는 정상.** 다만 호출 시점이 사진 로드 직후로만 한정되어, **사이즈 변경 시 자동 재계산이 누락**됨. 이 문서로 보정.

### 4.4 사이즈 변경 시 처리 (핵심 누락 기능)

사용자가 사이즈를 4×6 → 8×10으로 바꾸면:
1. variant 갱신 → Stage 비율 즉시 변경
2. inner_rect를 새 Stage 픽셀로 재변환
3. **사진 중앙(현재 cropTransform.x/y)을 새 innerRectPx 중앙으로 평행 이동** 단순화
4. scale은 기존 값 유지 (사용자가 미세조정한 줌을 보존)
5. 새 scale이 fit-cover scale 미만이면 fit-cover로 클램프 (인쇄 영역에 빈 곳 방지)

### 4.5 색상 변경 시 처리

같은 product 안 frame_assets에서 `color_code` 일치하는 row의 `png_url`로 swap. inner_rect도 함께 갱신 (다른 색상이라도 같은 디자인이면 동일 inner_rect, 다른 디자인이면 다를 수 있음). **사진은 그대로 유지** (cropTransform 보존), 새 inner_rect로 클램프만 필요.

### 4.6 매트(Matte) 변경 시 처리 (Phase 2)

Phase 1: 옵션만 노출, 시각적 변화 없음.

Phase 2 (예정): 매트 토글 시 사진 영역을 inner_rect의 안쪽으로 추가 5–15mm 축소(시각적으로 흰 매트가 사진 둘레에 보이는 효과). 매트 두께는 variant에 컬럼 추가 필요.

---

## 5. 인쇄 렌더링 (서버, Sharp/node-canvas — ADR-005)

### 5.1 입력 / 출력

**입력 (`POST /api/render/print`)**:
```json
{
  "orderId": "order-uuid",
  "variantId": "variant-uuid",
  "photoUrl": "https://...supabase.co/storage/v1/object/public/photos/<file>",
  "frameAssetId": "frame-uuid",
  "cropTransform": { "x": 300, "y": 375, "scale": 1.2, "rotation": 0 },
  "stageSize": { "w": 600, "h": 750 }
}
```

`stageSize`는 클라이언트 미리보기 stage 크기. 인쇄 좌표계 변환의 기준점.

**출력**: 300dpi PNG (또는 PDF) URL. Storage `previews/print/<orderNo>-<itemIdx>.png` 같은 경로.

### 5.2 변환 순서

1. **photo, frame PNG 다운로드** (Storage public URL)
2. **인쇄 캔버스 크기 계산**:
   ```ts
   const innerWMm = variant.width_mm;
   const innerHMm = variant.height_mm;
   const totalWPx = mmToPx(innerWMm + 2 * BLEED_MM);
   const totalHPx = mmToPx(innerHMm + 2 * BLEED_MM);
   const bleedPx = mmToPx(BLEED_MM);
   ```
3. **클라이언트 transform을 인쇄 좌표로 스케일**:
   ```ts
   const scaleStageToPrint = mmToPx(innerWMm) / stageSize.w;
   const printTransform = {
     x: cropTransform.x * scaleStageToPrint + bleedPx,
     y: cropTransform.y * scaleStageToPrint + bleedPx,
     scale: cropTransform.scale * scaleStageToPrint,
     rotation: cropTransform.rotation,
   };
   ```
   **블리드만큼 좌표를 우/하단으로 평행 이동**해서 사진이 인쇄 영역(블리드 안쪽) 기준으로 정확히 배치되도록 한다.
4. **Sharp 합성**:
   - 베이스 캔버스: `sharp({ create: { width: totalWPx, height: totalHPx, channels: 4, background: white } })`
   - 사진 합성: photo를 printTransform 기준으로 회전→스케일→배치 (`sharp(photo).rotate(rot).resize(targetW, null).extract({...}).composite(...)`)
   - **블리드 확장**: 사진이 인쇄 영역의 정확히 외곽에 닿는다면, 가장자리 픽셀을 mirror로 +2mm 확장 (Sharp의 `extend({ extendWith: 'copy' })` 또는 manual edge replicate)
5. **결과 PNG 저장**: `previews/print/<orderNo>-<idx>.png` → URL을 `order_items.print_file_url`에 저장

### 5.3 ICC 프로파일 / 색공간

- 화면: sRGB (Konva, 브라우저 기본)
- 인쇄: ICC profile (운영사가 결정 — CMYK 또는 Adobe RGB로 변환). Phase 1은 sRGB 유지 + 면책 고지. Phase 2 ICC 적용 ADR 추가 예정.

### 5.4 트리거 시점

- **PAID 전이 시점**에 자동 enqueue (`payment/confirm.ts`에서 `handleWebhook` 또는 `confirmPayment` 성공 후)
- Edge Function이 비동기로 처리 → `order_items.print_file_url` 채움
- Admin은 `/admin/orders` 상세에서 다운로드 (이미 ProductCard에 placeholder text "준비 중"으로 표시)
- 렌더 실패 시 retry 3회 + 실패 알림(`shared/BLOCKERS.md`)

---

## 6. 제약 조건 / 주의사항 (운영 코드에 반드시 적용)

### 6.1 SSR / 번들 격리 (ADR-015)

- **Konva 관련 모든 import는 `dynamic(() => import('./FrameCanvas'), { ssr: false })` 안에 격리**
- `src/types/editor.ts`는 Konva 타입을 절대 import하지 않음
- 서버에서 Konva 노드를 직접 생성하지 않음 (`new Konva.Stage` 등 서버에서 throw)
- 인쇄 렌더링은 **Sharp** 사용 (Konva의 node-canvas는 메모리/Native 의존성 부담)

### 6.2 메모리 / 모바일

- **클라이언트 1600px 리사이즈 강제** (`src/lib/image/resize-client.ts` 이미 구현, P1-05 fix). 원본 50MB가 모바일 메모리 OOM 유발
- Konva Stage `width × height`는 **최대 1080px**로 제한 (모바일 GPU 한계). variant가 큰 사이즈(11×14, 28×36cm)라도 base scale로 600~900 사이.
- `useImageBitmap` 훅의 이미지 객체는 컴포넌트 unmount 시 정리해야 메모리 누수 방지 (`img.onload = null`, `img.src = ''`)

### 6.3 좌표계 동기화 (어긋남이 가장 흔한 버그)

- **`cropTransform`은 항상 Stage 픽셀 단위**. 자연 픽셀이나 인쇄 mm가 섞이면 안 됨.
- Stage 비율(variant ratio)이 변하면 **반드시 inner_rect 픽셀 재계산** + 사진 위치 재배치.
- `offsetX/Y`는 사진의 자연 사이즈 절반 — Stage 사이즈가 아님. 헷갈리지 말 것.
- 회전은 **사진에만 적용**. frame PNG는 절대 회전시키지 않음 (액자가 돌아가면 inner_rect 정렬이 깨짐).

### 6.4 frame_assets vs product_variants 비율 일관성

- 같은 product의 모든 variants는 같은 종횡비 군에 속해야 한다 (예: 모두 portrait 4:5 또는 모두 square). 다른 종횡비를 섞으면 frame PNG stretch 문제 발생.
- Architect/Admin은 frame_asset의 PNG 비율과 variant의 mm 비율 차이가 5% 초과 시 저장 거부 또는 경고 표시.

### 6.5 블리드 누락 시 영향

- 인쇄 컷팅은 ±1mm 오차가 존재. 블리드 없이 사진 외곽이 인쇄 영역과 정확히 일치하면, 컷팅 후 외곽에 흰 띠가 생긴다 (인쇄 불량).
- **2mm는 산업 표준**이며 협력 인쇄소(추후 결정)와 별도 합의 없으면 변경 금지. 변경 시 ADR.

### 6.6 보안 / RLS

- 사진 URL은 anon photos 버킷에서 public이지만 (ADR-018), `frame_assets.png_url`은 admin이 업로드한 자산이며 누구나 read 가능. 다만 client-side에 frame_asset의 id는 노출돼도 무방.
- 인쇄 렌더링 API (`/api/render/print`)는 service_role 호출이 필요하므로 **server-only**. 호출 트리거는 `confirm.ts` → Edge Function (admin이 직접 호출 불가).
- 사용자가 cropTransform을 변조해서 인쇄 영역 밖의 사진(예: 다른 사람의 사진)을 합성하려는 시도 → 서버에서 `cropTransform.scale`이 fit-cover 최소값 미만이면 거부 (인쇄에 빈 곳 방지 + 위변조 방지).

### 6.7 키보드/모바일 키보드 가림 (PLAN §14)

- 모바일 키보드가 캔버스를 가리는 경우 `visualViewport` API로 감지 → 캔버스 자동 스크롤 (Phase 2).

### 6.8 미리보기 vs 인쇄 색차 면책

- StudioClient 하단에 항상 표시: "※ 미리보기는 화면 색공간 기준이며 실제 인쇄 결과와 차이가 있을 수 있습니다."
- 클레임 정책 (CS): 미리보기와 인쇄 색차는 교환 사유에 해당 안 함 (단, 인쇄 자체의 결함은 100% 교환).

---

## 7. Phase 별 범위

### Phase 1 (현재 작업 범위)

- [x] 사이즈/색상 옵션 변경
- [ ] 사진 업로드 + 액자 합성 (**구현 필요 — 현재 검은 화면 버그**)
- [ ] inner_rect 클리핑
- [ ] 사이즈 변경 시 Stage 비율 + 사진 재배치
- [ ] 색상 변경 시 frame PNG swap
- [ ] 사진 드래그 (단순 이동)
- [ ] 매트/인화지 옵션 노출만 (시각 효과 없음)
- [ ] 미리보기 toDataURL → cart_items.preview_url 저장
- [ ] 인쇄 렌더링 API 스켈레톤 (`/api/render/print`) — Phase 2에 ICC 적용
- [ ] 2mm 블리드 + 300dpi 출력 (Sharp)

### Phase 2

- [ ] 매트 토글 시각화 (inner_rect 축소)
- [ ] 핀치 줌 / 회전 제스처
- [ ] Undo/Redo (Zustand history middleware)
- [ ] ICC 프로파일 적용 (인쇄)
- [ ] 명화 갤러리 (StockPicker)
- [ ] 큐레이션 별로 frame_assets 추천

### Phase 3+

- [ ] Konva → WebGL 가속 검토 (대용량 사진)
- [ ] Multi-photo collage (한 액자에 여러 사진)
- [ ] AR 미리보기 (모바일 카메라로 벽 위에 가상 배치)

---

## 8. 테스트 시나리오 (회귀 가드)

| ID | 시나리오 | 기대 |
|---|---|---|
| FE-01 | 사진 업로드 → 검은 화면 X, 사진과 액자가 둘 다 보임 | photoImg와 frameImg 모두 Konva에 렌더 |
| FE-02 | 사이즈 4×6 → 8×10 변경 | Stage 비율 즉시 변경, 사진 중앙 정렬 유지 |
| FE-03 | 색상 black → brown 변경 | frame PNG src 즉시 swap, cropTransform 유지 |
| FE-04 | 사진을 inner_rect 밖으로 드래그 시도 | clipFunc로 inner_rect 안에만 렌더, scale ≥ fit-cover로 클램프 |
| FE-05 | 11×14 (가장 큰 variant) 선택 + 모바일 viewport | OOM 없이 1080px 이내 Stage로 정상 동작 |
| FE-06 | cropTransform 변조 (scale 0.001) → 서버 confirm | `INVALID_CROP_SCALE` 422 |
| FE-07 | 인쇄 렌더링 PNG 출력 사이즈 (4×6) | `1252 × 1842 px` (블리드 포함, 300dpi) |
| FE-08 | 인쇄 PNG 외곽 2mm 영역 | 블리드 영역에 사진 가장자리가 mirror/copy로 확장됨 |

---

## 9. 관련 문서 / ADR / 코드 위치

- **명세:** [docs/specs/editor.md](specs/editor.md)
- **마스터 플랜:** [docs/PLAN.md §5.2, §6, §13, §14](PLAN.md)
- **ADR-001:** Konva 채택 ([shared/DECISIONS.md](../shared/DECISIONS.md))
- **ADR-005:** 클라이언트 미리보기 vs 서버 인쇄 렌더링 분리
- **ADR-015:** Editor 타입의 Konva 격리
- **타입:** [src/types/editor.ts](../src/types/editor.ts) (CropTransform, EditorState — Konva-free)
- **순수 헬퍼:** [src/lib/editor/transform.ts](../src/lib/editor/transform.ts) (fitPhotoToFrame, applyCropTransform, lookupVariant)
- **클라이언트 컴포넌트:** [src/app/(shop)/studio/[orderId]/FrameCanvas.tsx](../src/app/(shop)/studio/[orderId]/FrameCanvas.tsx) (dynamic ssr:false)
- **상태 관리:** [src/store/editor.ts](../src/store/editor.ts) (Zustand)
- **서버 렌더링 (예정):** [src/lib/render/print.ts](../src/lib/render/print.ts) + [src/app/api/render/print/route.ts](../src/app/api/render/print/route.ts)

---

## 10. 운영 체크리스트 (Admin이 새 frame_asset 등록 시)

- [ ] PNG가 RGBA(알파 채널) 모드인가? (RGB만이면 가운데 투명이 안 됨)
- [ ] PNG의 가운데 투명 영역 비율이 같은 product의 variants `width_mm / height_mm` 비율과 일치하는가? (±5%)
- [ ] `inner_rect`의 `x + w ≤ 1`, `y + h ≤ 1`, 모든 값 `0 ≤ ≤ 1`
- [ ] inner_rect의 `w × h`가 0.3 이상인가? (너무 작은 사진 영역은 사용자 가치 낮음)
- [ ] preview_url(스와치)이 200×200 이상 정사각형인가?
- [ ] png_url의 최종 사이즈가 인쇄 시 충분한 해상도 (`width_mm × 300 / 25.4` 이상)인가?

---

_(이 문서는 편집기/인쇄 모듈의 단일 진실 원천. 변경 시 ADR + 이 문서 동시 갱신.)_
