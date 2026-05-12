# Konva Canvas Patterns for FrameShop

> Frontend Dev 에이전트가 편집기 구현 시 참조하는 패턴 가이드.
> 실제 코드는 만들지 않고, **구현 가이드** 수준으로 정리.

---

## 1. 기본 Stage 구조

편집기의 Konva Stage는 4개 Layer로 구성한다:

```
Stage (전체 캔버스)
├── Layer 1: Background (흰 배경 또는 투명)
│   - listening=false (이벤트 받지 않음)
│
├── Layer 2: Photo Layer (사용자 사진)
│   - draggable=true
│   - 사용자가 이동/크기/회전 조작
│   - Group으로 감싸서 transform 적용
│   - 사진 외곽은 inner_rect로 마스킹 (clipFunc)
│
├── Layer 3: Matte Layer (옵션: 매트 있음일 때)
│   - 사진과 프레임 사이에 흰색/검은색 매트
│   - 매트 두께만큼 사진이 inner_rect보다 더 작은 영역에 표시
│
└── Layer 4: Frame Overlay (프레임 PNG)
    - listening=false
    - z-index 최상위
    - inner_rect 영역만 투명한 PNG가 사진을 가리지 않음
```

## 2. 좌표계 / 단위

- **Stage 크기:** 부모 컨테이너의 width × height (반응형)
- **Frame PNG:** 원본 비율을 유지하며 Stage에 fit (object-fit: contain)
- **Inner Rect:** 정규화 좌표 (0~1) — DB에 저장된 값을 Stage 픽셀로 변환
  ```
  innerRectPx = {
    x: frame.innerRect.x * frameWidth,
    y: frame.innerRect.y * frameHeight,
    w: frame.innerRect.w * frameWidth,
    h: frame.innerRect.h * frameHeight
  }
  ```

## 3. 사진 초기 배치 (fit-cover)

사진이 처음 로드되면:
1. 사진의 원본 비율 계산
2. innerRect 영역에 fit-cover로 배치 (영역을 채우되 비율 유지, 넘치는 부분은 마스킹)
3. 중심 정렬

수도코드:
```
function calculateInitialTransform(photo, innerRect):
    scaleX = innerRect.w / photo.naturalWidth
    scaleY = innerRect.h / photo.naturalHeight
    scale = max(scaleX, scaleY)   // cover (fit이면 min)
    
    scaledW = photo.naturalWidth * scale
    scaledH = photo.naturalHeight * scale
    
    x = innerRect.x + (innerRect.w - scaledW) / 2
    y = innerRect.y + (innerRect.h - scaledH) / 2
    
    return { x, y, scale, rotation: 0 }
```

## 4. 사용자 인터랙션

### 4.1 드래그 (이동)
- `Image` 노드에 `draggable={true}`
- `dragBoundFunc`으로 사진이 innerRect를 완전히 벗어나지 않도록 제한
- 드래그 중에는 매트/프레임 레이어 일시적으로 약간 투명하게 (UX 개선)

### 4.2 핀치 줌 (모바일)
- Stage의 `touchmove` 이벤트 직접 처리
- 두 손가락 거리 변화로 scale 계산
- `requestAnimationFrame`으로 throttle

### 4.3 두 손가락 회전
- 두 터치 포인트 사이의 각도 변화 추적
- `rotation` 누적 (0~360 정규화)
- 스냅: 0°, 90°, 180°, 270° 근처에서 자석처럼 붙도록

### 4.4 마우스 휠 줌 (PC)
- Stage의 `wheel` 이벤트
- `e.deltaY > 0` 이면 축소, 아니면 확대
- 스크롤 한 번에 5% 변화
- Ctrl+휠은 OS 줌과 충돌 → preventDefault

### 4.5 사용자 변환 후 데이터 저장
- 모든 변환 종료 시 (`dragend`, `touchend`, `wheel debounce 200ms`):
- `cropTransform` 객체 업데이트하여 Zustand store에 저장
  ```
  cropTransform = { x, y, scale, rotation }
  ```
- 이 값은 DB 저장 + 서버 인쇄 렌더링 시 동일하게 사용

## 5. 옵션 변경 → 재렌더링

### 5.1 액자 색상 변경
- `frame_assets` 테이블에서 새 PNG URL 조회
- Frame Layer의 Image src 교체
- 사진은 그대로 (cropTransform 유지)
- **inner_rect가 색상마다 다를 수 있으므로** 사진 위치 재계산 필요

### 5.2 사이즈 변경 (예: 4X6 → 8X10)
- 화면용 Stage 크기는 동일 (DPI는 변하지 않음)
- 사진 비율만 새 사이즈에 맞춰 재계산
- 사용자에게 "사진 위치가 재조정되었습니다" 토스트 노출

### 5.3 매트 토글
- 매트 있음 → Matte Layer 추가, 사진을 더 작은 영역에 재배치
- 매트 없음 → Matte Layer 제거, 사진을 원래 inner_rect에 재배치
- 변환은 부드럽게 (200ms tween)

### 5.4 인화지 변경
- 시각적 효과는 미미 (광택/무광택은 거의 같게 렌더)
- 단순히 옵션값과 가격만 갱신

## 6. 미리보기 PNG 내보내기

장바구니 담을 때:
```
stage.toDataURL({
  mimeType: 'image/png',
  pixelRatio: 2,           // retina
  quality: 1
})
```

- 결과: Base64 dataURL → Supabase Storage 업로드 → `cart_items.preview_url`에 저장
- 크기: 일반적으로 100~300KB

## 7. 서버사이드 렌더링 (인쇄용)

- 결제 완료 후 Edge Function에서:
  1. `order_items` → `crop_transform` + `photo_url` + `frame_asset_url` + 사이즈(mm) 조회
  2. 300 DPI 기준 픽셀 계산:
     ```
     widthPx = widthMm / 25.4 * 300
     heightPx = heightMm / 25.4 * 300
     ```
  3. Sharp 또는 node-canvas로 동일한 Layer 구조 재현
  4. ICC 프로파일 적용 (선택)
  5. PNG 또는 PDF 출력 → `print_file_url` 갱신

> 💡 클라이언트 transform과 서버 transform이 **동일한 좌표계**를 사용해야 한다. 정규화 좌표 유지가 핵심.

## 8. 성능 최적화

### 필수
- 비-인터랙티브 Layer에 `listening={false}`
- 사진 Image에 `perfectDrawEnabled={false}`
- 큰 이미지는 클라이언트에서 사전 리사이즈 (1600px max)
- `requestAnimationFrame`으로 transform throttle

### 권장
- Stage `pixelRatio={Math.min(devicePixelRatio, 2)}` (3x는 과함)
- 사진 변경 시에만 `layer.batchDraw()`; 그 외엔 자동
- 모바일에서 `Stage.cache()` 적극 사용 (정적인 Layer)

## 9. SSR 안전성

```ts
// 반드시 dynamic import
const FrameEditor = dynamic(() => import('./FrameEditor'), {
  ssr: false,
  loading: () => <EditorSkeleton />
})
```

- `react-konva` 자체가 window 의존이라 SSR 시 에러
- 페이지의 다른 부분(헤더, 옵션 UI)은 SSR 가능
- Konva가 마운트되는 부분만 클라이언트 컴포넌트

## 10. 자주 발생하는 함정

| 증상 | 원인 | 해결 |
|---|---|---|
| 화면 회전 시 사진이 사라짐 | Stage 크기 미갱신 | resize observer로 stage.width/height 갱신 |
| 모바일에서 핀치 줌이 페이지 전체 줌으로 작동 | `touch-action: none` 미설정 | Stage 컨테이너에 CSS `touch-action: none` |
| 사진이 흐릿하게 보임 | pixelRatio 미설정 | `Stage pixelRatio={2}` |
| Konva 빌드 실패 (canvas 모듈) | Node 24 + canvas 호환성 | `engines.node: 20.x` 고정 |
| iOS에서 두 손가락 동작이 페이지 스와이프 | `passive: true` 기본값 | 이벤트 리스너에 `{ passive: false }` |
| 사진 드래그 후 위치가 어긋남 | Group의 offset 미고려 | `node.absolutePosition()` 사용 |

---

이 가이드는 Frontend Dev 에이전트가 편집기를 구현할 때 참조한다.
실제 코드는 docs/specs/editor.md의 acceptance criteria를 기반으로 작성한다.
