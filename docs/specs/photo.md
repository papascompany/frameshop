# Module: Photo (Source + Picker)

## Purpose
M-Photo는 사용자가 액자에 인쇄할 사진을 시스템에 등록하는 입구 모듈이다. 두 개의 책임으로 구성된다: (1) **M-PhotoSource** — 사진 소스 선택 UI(디바이스/클라우드/명화이미지)를 노출하고 디바이스 분기로 라우팅한다. (2) **M-PhotoPicker** — 디바이스에서 선택한 파일에 EXIF 자동 회전을 적용하고, 클라이언트에서 사전 리사이즈(긴 변 1600px)한 뒤 Supabase Storage에 업로드하고 `photos` 레코드를 생성한다. Phase 1에서는 디바이스 소스만 구현하며, 클라우드/명화이미지는 UI 자리만 잡고 비활성 상태로 둔다(Out of Scope 표기). 모바일 메모리 한계와 50MB+ 대용량 사진 업로드 실패 리스크를 클라이언트 리사이즈로 방어한다.

## User Stories
- B2C 구매자로서, 편집 세션에 진입한 직후 "사진 가져오기" 화면에서 디바이스/클라우드/명화이미지 중 어떤 소스를 쓸지 한눈에 보고 선택하고 싶다.
- B2C 구매자(모바일)로서, "휴대폰 사진" 탭을 누르면 OS 표준 사진 선택 UI(또는 카메라)가 즉시 열려야 한다.
- B2C 구매자로서, 세로/가로로 찍힌 사진이 EXIF 회전 메타데이터에 맞춰 자동으로 올바른 방향으로 표시되길 원한다.
- B2C 구매자로서, 50MB 원본 사진을 골라도 앱이 죽지 않고 업로드가 성공하길 원한다.
- B2C 구매자로서, 업로드 중 진행률을 보고, 실패 시 다시 시도할 수 있길 원한다.
- B2C 구매자(미래 기능)로서, Phase 2에 구글 드라이브/원드라이브에서 사진을 직접 가져오고, 운영자가 등록한 명화 갤러리에서도 선택할 수 있길 원한다.
- 운영자로서, Phase 1에는 클라우드/명화 탭이 "준비 중"으로 표시되어 혼란이 없길 원한다.

## Acceptance Criteria
1. **GIVEN** 사용자가 `/studio/[sessionId]`에 진입한다 **WHEN** 사진이 아직 선택되지 않았다 **THEN** `<PhotoSourceSelector>` 모달/스텝이 렌더되고 디바이스/클라우드/명화 3개 탭이 보인다 (Phase 1: 클라우드·명화는 disabled + "Coming Soon" 배지).
2. **GIVEN** 사용자가 "휴대폰 사진" 탭을 탭한다 **WHEN** `DevicePicker`가 마운트된다 **THEN** `<input type="file" accept="image/jpeg,image/png,image/heic,image/webp">`가 트리거되어 OS 파일 선택기가 열린다. 모바일에서는 `capture` 속성으로 카메라 분기도 제공.
3. **GIVEN** 사용자가 JPEG 파일(EXIF orientation=6, 즉 시계방향 90도 회전 필요)을 선택한다 **WHEN** `uploadPhoto(file)`이 실행된다 **THEN** 클라이언트에서 EXIF를 파싱해 픽셀을 회전 적용하고, EXIF orientation 태그는 1(정상)로 재기록되거나 제거된다.
4. **GIVEN** 사용자가 4000×3000px 사진을 선택한다 **WHEN** 업로드가 실행된다 **THEN** 클라이언트에서 긴 변 1600px로 리사이즈된 버전이 생성되어 Supabase Storage `photos/<userIdOrSession>/<uuid>.jpg`에 저장된다. 원본은 Phase 1에서는 업로드하지 않음(메모리/대역폭 절약).
5. **GIVEN** 사용자가 51MB 파일(또는 정의된 상한 초과)을 선택한다 **WHEN** `uploadPhoto`가 호출된다 **THEN** 클라이언트가 사이즈 초과를 감지하고 "사진은 50MB 이하로 업로드해주세요" 에러를 반환한다. 서버 호출 없이 차단.
6. **GIVEN** 파일 타입이 PDF 또는 GIF다 **WHEN** 업로드가 시도된다 **THEN** 허용 MIME 화이트리스트(`image/jpeg|png|heic|webp`) 검사에서 차단되고 명확한 에러 메시지가 표시된다.
7. **GIVEN** 업로드가 시작된다 **WHEN** XHR/fetch 진행률 이벤트가 발생한다 **THEN** UI 진행률 바가 0~100%로 갱신된다 (Storage 업로드 SDK가 진행률 미지원이면 "업로드 중" 인디케이터로 대체 가능 — 자율 결정).
8. **GIVEN** 업로드 도중 네트워크가 끊긴다 **WHEN** Storage 업로드가 실패한다 **THEN** 사용자에게 "다시 시도" 버튼이 노출되며 Storage에 부분 업로드된 파일은 정리(`remove`) 시도된다.
9. **GIVEN** 업로드가 성공한다 **WHEN** Storage URL을 받는다 **THEN** `photos` 테이블에 `{ user_id, original_url, thumb_url, width_px, height_px, exif }` 레코드가 생성되며 `Photo` 객체가 호출자에게 반환된다. 비회원이면 `user_id`는 `null`로 저장.
10. **GIVEN** `<PhotoGallery photos={...}>`이 사용자의 이전 업로드 사진 목록을 표시한다 (Phase 2 마이페이지) **WHEN** 사용자가 사진 카드를 탭한다 **THEN** `onSelect(photo)` 콜백이 호출되며 편집기로 전달된다. Phase 1에서는 가장 최근 1건만 보여도 OK.
11. **GIVEN** HEIC 파일을 업로드한다 (iOS 기본 포맷) **WHEN** 클라이언트 처리한다 **THEN** 브라우저 디코드 가능 여부를 감지하고, 실패 시 "JPEG로 변환 후 다시 시도해주세요" 안내 (Phase 1). Phase 2에서 `heic2any` 라이브러리로 변환 검토.

## Edge Cases
- **EXIF 결손/손상:** EXIF가 없거나 파싱 실패 → orientation=1로 가정하고 무회전으로 처리. throw 금지.
- **회전 후 캔버스 크기 폭주:** orientation 5~8(90°/270°)일 때 가로/세로 픽셀이 swap되므로 리사이즈 기준(긴 변 1600px)을 회전 후 기준으로 적용.
- **이미지가 너무 작음:** 긴 변 800px 미만 사진은 인쇄 품질 경고("저해상도 이미지입니다. 인쇄 품질이 떨어질 수 있습니다") 표시. 업로드는 허용.
- **MIME 사칭:** 확장자만 `.jpg`이고 실제 헤더가 다른 파일 → 클라이언트 매직 바이트 검증 (`FileReader` 첫 12바이트). 서버에서 Sharp가 다시 검증.
- **모바일 메모리 OOM:** 사전 리사이즈는 `createImageBitmap` + `OffscreenCanvas` 우선 사용(가능한 환경). 미지원 환경은 `Image` + `<canvas>` 폴백. Web Worker 사용은 Phase 2.
- **세션 격리:** 비회원의 사진은 `photos.user_id IS NULL`로 저장되고 `session_id` 컬럼(추가 필요) 또는 Storage path의 `<sessionId>/` 분기로 격리한다. **자율 결정:** Phase 1은 path prefix(`photos/anon/<sessionId>/<uuid>.jpg`)로 격리하고 schema 컬럼 추가는 Architect가 결정.
- **중복 업로드:** 동일 파일을 두 번 업로드해도 별개 photo 레코드 생성(해시 dedup은 Phase 3).
- **iOS Safari 카메라 권한 거부:** 권한 거부 시 OS 알림 외 별도 처리 불가. UI에서 "설정에서 권한을 허용해주세요" 안내만 표시.
- **클라우드/명화 탭 클릭:** Phase 1에서는 토스트로 "곧 제공될 기능입니다"만 표시. 라우팅/모달 진입 막음.
- **Storage URL 만료:** Supabase Storage public bucket 사용 시 만료 없음. private bucket이면 signed URL 발급 로직 필요 — **자율 결정:** Phase 1은 `photos` bucket을 public + RLS 차단으로 운영 (Architect 검토).

## Out of Scope
- **클라우드 사진 가져오기** (Google Drive/OneDrive OAuth) — Phase 3.
- **명화/스톡 이미지 갤러리** — Phase 2 (운영자가 등록한 라이선스 정리된 이미지).
- **HEIC → JPEG 자동 변환** — Phase 2 (`heic2any`).
- **다중 파일 동시 업로드** — Phase 2. Phase 1은 1장씩.
- **이미지 필터/보정(밝기/대비)** — Phase 3.
- **사진 중복 dedup** (SHA-256 해시) — Phase 3.
- **이전 업로드 사진 라이브러리 / 마이페이지 갤러리** — Phase 2.
- **Web Worker 기반 리사이즈** — Phase 2 최적화.
- **얼굴 인식 자동 크롭** — Out of Scope (영구).

## Dependencies
- **Depends on:**
  - Supabase Storage bucket `photos` (path 규칙: `photos/<userId|anon-sessionId>/<uuid>.<ext>`)
  - Supabase 테이블: `photos` (PLAN.md §6)
  - `src/types/product.ts` 또는 신규 `src/types/photo.ts` — `Photo` 타입 (Architect 동결)
  - EXIF 파싱 라이브러리 (예: `exifr` — 클라이언트 호환), 리사이즈는 Canvas API
  - `lib/image/exif.ts` 헬퍼 (PLAN.md §5.1)
  - 인증: 비회원은 `user_id=null`, 회원은 Supabase Auth 세션
- **Used by:**
  - M-FrameEditor (사진 선택 직후 편집기에 주입)
  - M-Cart (cartItem.photoUrl에 Storage URL 저장)
  - 페이지: `app/(shop)/studio/[orderId]/page.tsx`

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다.

- `<PhotoSourceSelector onSelect={(source: PhotoSource) => void} />`
  - **PhotoSource type:** `'device' | 'cloud' | 'stock'`
  - **동작:** 3개 탭 표시. Phase 1에서 `cloud`, `stock`은 disabled + 토스트.

- `<DevicePicker onPicked={(file: File) => void} />`
  - **동작:** 숨겨진 file input + 트리거 버튼. 모바일은 `capture="environment"` 옵션 분기.
  - **허용 MIME:** `image/jpeg, image/png, image/heic, image/webp`
  - **최대 사이즈:** 50MB (상수 `MAX_UPLOAD_BYTES = 50 * 1024 * 1024`)

- `<PhotoGallery photos={Photo[]} onSelect={(photo: Photo) => void} />`
  - **동작:** Phase 1에서는 마운트되지 않거나 가장 최근 1건만 표시. Phase 2에서 마이페이지에서 본격 사용.

- `uploadPhoto(file: File, options?: UploadOptions): Promise<UploadResult>`
  - **UploadOptions:** `{ sessionId?: string; onProgress?: (percent: number) => void; signal?: AbortSignal }`
  - **UploadResult:** `{ photo: Photo; resizedDataUrl: string }` — `resizedDataUrl`은 캔버스 즉시 사용을 위한 base64(메모리에서만, 저장 X).
  - **동작 순서:**
    1. MIME/사이즈 검증 (`MAX_UPLOAD_BYTES`)
    2. EXIF 파싱 → orientation 추출
    3. Canvas/ImageBitmap으로 회전 적용 + 긴 변 1600px 리사이즈 → JPEG quality 0.85
    4. 썸네일 생성 (긴 변 400px, JPEG quality 0.75)
    5. Supabase Storage 업로드 (original_url, thumb_url 2개 경로)
    6. `photos` insert → `Photo` 반환
  - **에러:** `'FILE_TOO_LARGE' | 'UNSUPPORTED_MIME' | 'UPLOAD_FAILED' | 'EXIF_PARSE_FAILED'` (마지막은 fallback으로 무회전 처리).

- `parseExif(buffer: ArrayBuffer): ExifMeta` (PLAN.md UT-06)
  - **ExifMeta:** `{ orientation: 1|2|3|4|5|6|7|8; width?: number; height?: number; takenAt?: string }`
  - **동작:** EXIF 없으면 `{ orientation: 1 }` 반환.

## Test Scenarios

### Unit (Vitest)
- `parseExif` orientation 1~8 각각의 mock JPEG 헤더 파싱.
- `parseExif` EXIF 결손 → `{ orientation: 1 }`.
- 리사이즈 알고리즘: 4000×3000 → 1600×1200 (긴 변 기준).
- 리사이즈 알고리즘: orientation 6 (90° rot) 적용 후 3000×4000 → 1200×1600.
- MIME 검증: PDF/GIF는 `UNSUPPORTED_MIME` 에러.
- 파일 크기 검증: 51MB는 `FILE_TOO_LARGE` 에러.
- 매직 바이트 검증: 확장자 `.jpg`이지만 PDF 헤더(`%PDF`) → 차단.
- 빈 파일(0 bytes) → 차단.

### Integration (Testing Library + MSW)
- `<PhotoSourceSelector>` 클라우드 탭 클릭 → 토스트 "곧 제공될 기능입니다" + 라우팅 변동 없음.
- `<DevicePicker>` 트리거 클릭 → 파일 input change 이벤트 → `onPicked` 호출.
- `uploadPhoto` 흐름 통합: 파일 선택 → 진행률 0→100 → 성공 콜백에 Photo 객체 전달.
- 업로드 실패 시 "다시 시도" 버튼 렌더 + Storage `remove` 호출 확인.

### E2E (Playwright)
- **E2E-Photo-01 (모바일 375px):** `/studio/...` 진입 → "휴대폰 사진" 탭 → 파일 input upload → 편집기로 사진 전달됨.
- **E2E-Photo-02:** EXIF orientation=6 fixture 파일 업로드 → 미리보기에서 사진이 올바른 방향으로 표시.
- **E2E-Photo-03:** 51MB 파일 업로드 시도 → 즉시 차단 + 에러 메시지 노출.
- **E2E-Photo-04:** 클라우드/명화 탭 클릭 → "곧 제공될 기능" 토스트.
- **E2E-Photo-05:** 네트워크 차단 시뮬레이션 후 업로드 → 실패 처리 + 재시도 버튼.
