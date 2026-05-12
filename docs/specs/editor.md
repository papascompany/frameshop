# Module: Editor (FrameEditor + CropEditor)

## Purpose
M-Editor는 FrameShop의 핵심 기능 모듈로, 두 책임의 합성이다: (1) **M-FrameEditor** — 선택된 상품과 사진을 받아 Konva 캔버스 위에 사진 + 프레임 PNG 오버레이 + 매트 레이어를 합성하고, 옵션 변경(사이즈/색상/매트/인화지)에 따라 실시간으로 미리보기와 가격을 재렌더링한다. (2) **M-CropEditor** — 사용자가 사진을 드래그/스케일/회전(모바일 핀치)할 수 있게 하며, 액자 비율에 맞춘 클리핑 영역(`inner_rect`)을 기준으로 인쇄 영역을 정의한다. 출력은 `CropTransform` 객체와 `Stage.toDataURL()` 미리보기 PNG다. ADR-001(Konva 채택), ADR-005(클라이언트 미리보기/서버 300dpi 분리)를 따른다. Konva의 SSR 충돌을 방지하기 위해 **반드시 `dynamic(() => import(...), { ssr: false })` 패턴으로 import**한다. Zustand `editorStore`로 상태를 관리하며, 모바일 메모리 한계와 키보드 가림 리스크에 대응한다.

## User Stories
- B2C 구매자로서, 사진을 업로드한 직후 편집기에 진입하면 기본 옵션(가장 작은 사이즈/블랙)으로 즉시 합성된 미리보기를 보고 싶다.
- B2C 구매자로서, 사이즈 옵션을 바꾸면 100ms 이내에 새 비율의 미리보기와 가격이 갱신되길 원한다.
- B2C 구매자로서, 색상 옵션(블랙→브라운)을 바꾸면 프레임 PNG가 즉시 교체되고 가격이 재계산되길 원한다.
- B2C 구매자로서, 매트(있음/없음) 토글로 매트 레이어가 합성되고 사진 표시 영역이 좁아지길 원한다.
- B2C 구매자(모바일)로서, 두 손가락 핀치 줌과 회전 제스처로 사진 크기/각도를 조정하고, 한 손가락 드래그로 위치를 옮기고 싶다.
- B2C 구매자(PC)로서, 마우스 드래그로 위치 조정, 스크롤 휠로 줌, 슬라이더 UI로 회전 각도 조정을 하고 싶다.
- B2C 구매자로서, 사진이 인쇄 영역을 벗어났을 때 "사진이 인쇄 영역을 벗어났습니다" 경고를 보고 자동으로 클램프(또는 fit)할 수 있길 원한다.
- B2C 구매자로서, "장바구니 담기"를 누르면 현재 합성된 미리보기 PNG와 모든 옵션이 캡처되어 다음 단계로 넘어가길 원한다.
- 운영자로서, 잘못 등록된 프레임 PNG(inner_rect 좌표 오류)가 있어도 편집기가 크래시하지 않고 폴백 동작하길 원한다.

## Acceptance Criteria
1. **GIVEN** `/studio/[sessionId]?productId=p1`에 진입했고 사진이 업로드되었다 **WHEN** `<FrameEditor>`가 마운트된다 **THEN** Konva Stage가 `dynamic(...{ ssr: false })`로 lazy-load되며, 첫 paint 후 SSR HTML에 캔버스가 포함되지 않는다.
2. **GIVEN** 편집기 초기화 시점 **WHEN** `defaultVariantId`가 결정된다 **THEN** Zustand `editorStore`의 `selectedVariantId`가 그 값으로 세팅되고, 캔버스는 사진을 inner_rect에 fit-cover 배치한 초기 상태를 렌더한다.
3. **GIVEN** 사용자가 색상 탭에서 "브라운"을 탭한다 **WHEN** `setColor('brown')` 액션이 dispatch된다 **THEN** `frame_assets.color_code='brown'` PNG의 src가 Konva Image 노드에 즉시 적용되고, `lookupVariant({size, color:'brown', matte, paper})`로 새 변형이 조회되어 가격이 재계산된다(목표: <100ms).
4. **GIVEN** 매트 토글이 "있음"으로 변경된다 **WHEN** 옵션이 바뀐다 **THEN** 매트 레이어(폭 8mm 가정, 실측은 어드민에서 정의)가 inner_rect 안쪽에 추가되어 사진 가시 영역이 축소되고, `applyCropTransform`이 자동으로 fit-cover 재적용한다.
5. **GIVEN** 사용자가 사진을 드래그한다 **WHEN** Konva `dragmove` 이벤트가 발생한다 **THEN** `editorStore.cropTransform.x/y`가 업데이트되고, 인쇄 영역 경계(inner_rect)를 벗어나면 클램프(또는 시각적 경고)된다. 자율 결정: Phase 1은 부드러운 클램프(경계에서 멈춤).
6. **GIVEN** 모바일에서 두 손가락 핀치 줌을 한다 **WHEN** 핀치 거리가 변한다 **THEN** `cropTransform.scale`이 0.5~3.0 범위에서 갱신된다 (사진이 inner_rect를 완전히 덮는 최소 scale을 하한으로 보장 — 빈 영역 방지).
7. **GIVEN** 회전 슬라이더를 -45°~45°로 조작한다 **WHEN** 값이 바뀐다 **THEN** `cropTransform.rotation`이 갱신되고 캔버스 위 사진이 그 각도로 회전한다.
8. **GIVEN** 옵션 변경이 trigger되었다 **WHEN** 매트릭스에 매칭되는 활성 변형이 없다 **THEN** 사용자에게 "선택하신 조합은 현재 판매하지 않습니다" 토스트를 표시하고 이전 옵션으로 롤백한다(상태는 그대로).
9. **GIVEN** 사용자가 "장바구니 담기" 버튼을 클릭한다 **WHEN** 액션이 시작된다 **THEN**: (a) `Stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' })`로 미리보기 PNG 생성, (b) 생성된 base64를 Blob 변환 후 Supabase Storage `previews/<sessionId>/<uuid>.png`에 업로드, (c) `M-Cart.addToCart(...)` 호출, (d) 성공 시 `/cart` 라우팅 또는 토스트.
10. **GIVEN** 모바일 키보드가 떠 캔버스를 가린다(드문 케이스) **WHEN** `window.visualViewport.resize` 이벤트가 발생한다 **THEN** 편집기는 캔버스 영역을 visualViewport 높이에 맞게 재계산해 핵심 컨트롤이 가려지지 않도록 한다.
11. **GIVEN** 사진이 너무 크거나(EXIF rotate 후 5000×7000) 디바이스 메모리가 부족하다 **WHEN** Konva Image 로드가 실패한다 **THEN** `try/catch`로 잡아 "이미지를 불러올 수 없습니다. 더 작은 사진으로 다시 시도해주세요" 안내 (M-Photo의 1600px 리사이즈로 사실상 발생 안 함, 안전망).
12. **GIVEN** SSR 빌드/런타임 환경 **WHEN** `<FrameEditor>` 모듈이 import된다 **THEN** Konva 의존성은 절대 서버 번들에 포함되지 않아야 한다 (빌드 검증 항목).

## Edge Cases
- **Konva SSR 충돌 (PLAN.md §14 리스크):** `import dynamic from 'next/dynamic'` + `ssr: false` 강제. 캔버스 컴포넌트는 별도 파일로 분리, 페이지에서는 dynamic으로 import. 직접 import 금지.
- **inner_rect 오류:** `frame_assets.inner_rect`의 x,y,w,h가 0~1 범위를 벗어나거나 합산이 1 초과면 폴백 `{x:0.1,y:0.1,w:0.8,h:0.8}` 적용 + 콘솔 경고.
- **매트릭스 룩업 실패:** 옵션 조합이 매트릭스에 없으면 직전 유효 옵션으로 롤백(원자적 옵션 변경).
- **핀치 줌 하한:** 사진이 inner_rect를 완전히 덮지 못하는 scale은 거부. 사용자가 더 작게 만들려 해도 최소 scale에서 멈춤(여백/빈 영역 방지).
- **회전 후 인쇄 영역 보장:** 회전 각도에 따라 사진의 외접 경계가 inner_rect를 완전히 덮는 scale을 자동 보정. **자율 결정:** Phase 1은 단순 클램프(회전 시 자동 확대), Phase 2에서 시각적 가이드로 개선.
- **메모리 누수:** 캔버스 unmount 시 `stage.destroy()` 호출. 옵션 변경 시 새 Image 노드 생성 전 기존 노드 `destroy()`.
- **toDataURL 실패:** Stage 합성 미완료 상태에서 호출되면 빈 이미지 반환 → 명시적으로 모든 Image의 `onload` 완료를 기다린 후 호출.
- **여러 탭에서 동시 편집:** 같은 sessionId가 두 탭에서 열리면 Zustand 상태 격리(별 가드 없음, 최신 액션이 이김). LocalStorage 기반 cart에서 마지막 저장이 우선.
- **HiDPI/Retina 디스플레이:** Stage `pixelRatio: window.devicePixelRatio`로 설정해 선명도 보장.
- **컬러 일관성 (PLAN.md §14):** 미리보기는 sRGB. 인쇄와 색차 가능성을 UI에서 한 줄 면책 고지("미리보기는 화면 색공간 기준이며 실제 인쇄 결과와 차이가 있을 수 있습니다").
- **Undo/Redo:** Phase 1 미지원. **자율 결정:** Zustand store 구조만 history 확장 가능하게 설계(액션 패턴 유지)하고, 실제 history stack은 Phase 2.

## Out of Scope
- **Undo/Redo 히스토리** — Phase 2.
- **여러 사진 합성(콜라주)** — Out of Scope (영구).
- **텍스트 추가** — Out of Scope (영구).
- **필터/색조 조정** — Phase 3.
- **저장된 작업물 재편집** — Phase 2 (cartItem.previewUrl만 보관, 편집 상태 재현 X. Phase 2에 cropTransform 기반 재구성 검토).
- **300dpi 인쇄용 실시간 렌더링** — 서버 책임(ADR-005). 편집기는 화면용만.
- **AI 자동 크롭/구도 추천** — Out of Scope.
- **PC 키보드 단축키** — Phase 2.

## Dependencies
- **Depends on:**
  - **Konva.js + react-konva** (ADR-001) — `dynamic(...{ssr:false})` 강제
  - Zustand `editorStore` (`src/store/editor.ts`)
  - M-ProductDetail — `getProductOptions(productId)` → OptionMatrix + variantsByKey
  - M-Photo — 업로드된 `Photo` 객체와 `resizedDataUrl`(또는 storage URL)
  - `src/types/editor.ts` — `CropTransform`, `EditorState`, `SelectedOptions` (Architect 동결)
  - Supabase Storage `previews` bucket — 미리보기 PNG 저장
  - `lib/konva/` 헬퍼 (`fitPhotoToFrame`, `applyCropTransform`, `pinchHandler`)
- **Used by:**
  - M-Cart (`addToCart(cartItem)` 호출, previewUrl 전달)
  - 페이지: `app/(shop)/studio/[orderId]/page.tsx`

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다. Konva import는 반드시 dynamic.

- `<FrameEditor product={ProductDetail} options={OptionMatrix} photo={Photo} onConfirm={(payload: EditorConfirmPayload) => void} />`
  - **EditorConfirmPayload:** `{ variantId: string; cropTransform: CropTransform; previewBlob: Blob; selectedOptions: SelectedOptions }`
  - **동작:** Konva Stage 마운트 + 옵션 탭 UI + 핀치/드래그 핸들러 + "장바구니 담기" 버튼.
  - **import 패턴 강제:**
    ```
    // page.tsx
    const FrameEditor = dynamic(() => import('@/modules/editor/FrameEditor'), { ssr: false, loading: () => <EditorSkeleton /> });
    ```

- `<CropCanvas aspectRatio={number} image={HTMLImageElement | string} innerRect={{x,y,w,h}} transform={CropTransform} onChange={(t: CropTransform) => void} />`
  - **동작:** Konva Stage > Layer > Group(clip=innerRect) > Image. 드래그/줌/회전 이벤트 → onChange.
  - **반환:** 명시적 반환값 없음. transform 변경은 onChange 콜백.

- `lookupVariant(params: { variantsByKey: Record<string, ProductVariant>; size: string; color: string; matte: string; paper: string }): ProductVariant | null`
  - **동작:** key 생성 `${size}|${color}|${matte}|${paper}` → 매칭. 없으면 null.
  - **순수 함수** (TDD 1순위, PLAN.md UT-08).

- `applyCropTransform(image: { width: number; height: number }, transform: CropTransform): { x, y, scaleX, scaleY, rotation }`
  - **동작:** CropTransform을 Konva Image 속성으로 변환. 회전 중심점 보정 포함.
  - **순수 함수** (TDD 1순위, PLAN.md UT-02).

- `fitPhotoToFrame(photoSize: { w, h }, innerRect: { x, y, w, h }, stageSize: { w, h }): CropTransform`
  - **동작:** 사진을 inner_rect에 fit-cover 배치하는 초기 CropTransform 계산.
  - **순수 함수** (TDD 1순위, PLAN.md UT-03).

- `editorStore` (Zustand):
  - **State:** `{ productId, photoId, selectedOptions: SelectedOptions, selectedVariantId: string, cropTransform: CropTransform, previewDataUrl: string | null, isProcessing: boolean }`
  - **Actions:** `setColor(code)`, `setSize(code)`, `setMatte(code)`, `setPaper(code)`, `setCropTransform(t)`, `setPhoto(photo)`, `generatePreview()`, `reset()`
  - **Selector:** `useEditorPrice()` → 현재 선택 변형의 가격 반환 (lookupVariant 사용).

- `generatePreviewBlob(stage: Konva.Stage): Promise<Blob>`
  - **동작:** `stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' })` → fetch로 Blob 변환.

## Test Scenarios

### Unit (Vitest, TDD 1순위)
- `lookupVariant`: 정확한 키 매칭 시 변형 반환, 미매칭 시 null. (PLAN.md UT-08)
- `applyCropTransform`: 90도 회전 + scale 1.5 입력 시 Konva 속성 정확. (UT-02)
- `fitPhotoToFrame`: 가로 사진(4:3)을 정사각 inner_rect에 fit-cover → scale, x, y 정확. (UT-03)
- `fitPhotoToFrame`: 세로 사진을 가로 frame에 fit-cover → 좌우 잘림 없음.
- `editorStore.setColor`: 색상 변경 시 selectedVariantId가 매트릭스 lookup 기반으로 업데이트.
- `editorStore` 무효 옵션 조합: 매칭 변형 없으면 state 변경 안 됨(롤백) + 에러 플래그 세팅.
- `generatePreview` 동작: mock stage의 toDataURL 결과가 Blob으로 반환.
- 핀치 줌 하한 가드: 최소 scale 미만 입력 시 최소 scale로 클램프.

### Integration (Testing Library + jsdom + Konva mock)
- `<FrameEditor>` 마운트 → 첫 paint에 옵션 탭과 캔버스 placeholder 보임.
- 색상 변경 → frame PNG src 변경 + 가격 텍스트 변경. (PLAN.md IT-01)
- 매트 토글 → 사진 영역 축소. (IT-02)
- "장바구니 담기" 클릭 → Storage 업로드 mock + onConfirm 콜백 호출.
- 옵션 무효 조합 클릭 → 토스트 + 옵션 롤백.

### E2E (Playwright)
- **E2E-Editor-01 (모바일 375px):** 사진 업로드 → 편집기 마운트 → 색상 3회 변경 → 가격 변경 확인.
- **E2E-Editor-02 (모바일):** 두 손가락 핀치 줌 시뮬레이션 → cropTransform.scale 변경. (PLAN.md E2E-04)
- **E2E-Editor-03 (PC 1280px):** 마우스 드래그로 사진 위치 변경.
- **E2E-Editor-04:** 매트 토글 → 사진 영역 시각적 축소 (스크린샷 비교).
- **E2E-Editor-05:** "장바구니 담기" 클릭 → 미리보기 PNG가 Supabase Storage에 업로드되고 `/cart`로 라우팅.
- **E2E-Editor-06:** 빌드 산출물에서 `'konva'` 문자열이 서버 청크에 포함되지 않는지 grep 검증 (SSR 가드).
