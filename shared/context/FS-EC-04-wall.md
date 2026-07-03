# CONTEXT PACKAGE — FS-EC-04 (포토월 시뮬레이터 /wall)
작성: orchestrator @ 2026-07-03 · 수신 역할: frontend-dev (배치 2)

## 1. Goal
고객이 벽 치수(cm)를 입력하고 실제 판매 중인 액자(variant 실측 mm)를 실측 비율로 벽에 배치해 보는 **포토월 시뮬레이터** `/wall` 신설. 각 배치 프레임에서 "이 액자 편집하기" → 스튜디오 딥링크(사이즈/색상/방향 프리셀렉트). **마이그레이션 0(schema-free MVP), 기존 단품 경로 무변경.**

## 2. Scope
### In-scope
- `src/app/(shop)/wall/**` (신규 page + Client)
- `src/modules/wall/**` (신규 — Konva 캔버스 컴포넌트)
- `src/store/wall.ts` (신규 zustand)
- `src/lib/db/wall.ts` (신규 — 읽기 전용 카탈로그 쿼리, 명시 컬럼)
- `src/lib/wall/**` (신규 — 순수 스케일/배치 계산)
- `src/app/(shop)/studio/[orderId]/page.tsx`·`StudioClient.tsx` — **searchParams 프리셀렉트(size/color/orientation) 수용 최소 diff만** (트레이/체크아웃 로직 불변)
- `src/components/layout/Header.tsx` — "포토월" 내비 링크 1개 추가만
- 신규 테스트
### Out-of-scope (수정 금지)
- Footer(타 에이전트), admin/**, checkout/**, `src/store/editor.ts` 시그니처 변경, types FROZEN 파일들.

## 3. 환경 사실
- ADR-001 Konva + react-konva(이미 의존성 있음). ADR-015: Konva는 `src/modules/` 안에서만, 페이지는 `dynamic({ssr:false})` 로드. ADR-002 모바일 우선(375px 먼저).
- 실측 데이터: `product_variants.width_mm/height_mm`(존재), `frame_assets.png_url/inner_rect/preview_url/color_code/color_label`.
- 스튜디오 URL: `/studio/{uuid}?productId={id}` (uuid는 클라 생성 sessionId). 프리셀렉트 파라미터는 현재 없음 → 이번에 `size`·`color`·`orientation` 옵션 쿼리 추가(존재하면 초기 옵션 적용, 없으면 기존 동작).
- 검증 게이트 동일(tsc/eslint/vitest). select('*') 금지.

## 4. 알려진 함정
- **mm→px 스케일**: `pxPerMm = stageWidthPx / wallWidthMm` 단일 계수로 벽·프레임 모두 렌더(비율 왜곡 금지). devicePixelRatio는 Konva가 처리하나 라벨·격자 선명도 확인. 프레임 PNG는 종횡비 유지.
- **이미지 CORS**: frame_assets PNG는 Supabase Storage(https, 동일 출처 아님) — Konva Image에 crossOrigin 'anonymous'(기존 FrameCanvas 패턴 참조). 스냅샷 내보내기(toDataURL)는 CORS 실패 가능 — 실패 시 graceful(내보내기 버튼 숨김/토스트), 필수 기능 아님.
- **모바일**: 375px에서 캔버스 full-width + 팔레트는 하단 시트/가로 스크롤 칩. 드래그는 Konva draggable(터치 지원 내장). 핀치줌은 범위 외(고정 스케일).
- 벽 프리셋: 기본 300×230cm, 입력 범위 100~1000cm. 걸이 가이드: 중심선 + 눈높이 145cm 라인 표시.
- 상태: zustand + localStorage persist(키 `frameshop.wall.v1`, 버전키+안전파싱 — `src/lib/editor/draft.ts` 패턴 참조). Placed item: {id, productId, variantId, sizeLabel, wMm, hMm, orientation, colorCode, frameUrl, xMm, yMm, price}.
- 가격 합계 바(개수·합계) + 항목별 "편집하기"(딥링크 새 세션) / 삭제. 겹침 허용(z순서 = 추가순).
- 카탈로그 쿼리: 활성 상품(hasFrame true) + 활성 variant(사이즈 대표: 같은 sizeCode 중 최저가 1개) + 프레임 색상 목록. 서버 컴포넌트에서 조회해 Client props로.
- StudioClient 프리셀렉트: 초기 마운트 1회만 적용(useRef 가드), 유효하지 않은 코드면 무시(기존 기본값). **entries 초기화 등 부작용 유발 금지** — setSize/setOrientation의 기존 시맨틱 확인 후 초기 옵션 상태로만 주입.

## 5. 읽기 목록
1. `src/modules/editor/FrameCanvas.tsx`(및 이웃) — Konva 패턴·이미지 로드·dynamic 로드 방식
2. `src/store/editor.ts` — 스토어 컨벤션(FrameOrientation, 옵션 상태) · `src/lib/editor/draft.ts` — localStorage 버전키 패턴
3. `src/app/(shop)/studio/[orderId]/page.tsx` + `StudioClient.tsx` — 세션/옵션 초기화 구조(프리셀렉트 삽입 지점)
4. `src/lib/db/product.ts`·`catalog.ts` — 쿼리 스타일(명시 컬럼, mapper 사용)
5. `src/components/layout/Header.tsx` — 내비 구조

## 6. 계약
- 순수 계산(`src/lib/wall/scale.ts` 등): `mmToPx`, `clampToWall`, `wallLayoutSchema`(zod, localStorage 파싱용) — 단위 테스트 대상.
- 신규 라우트는 서버 컴포넌트 page + 'use client' Client 구성(기존 페이지 패턴).

## 7. Done Criteria
- [ ] tsc 0 · eslint 0 · vitest green + 신규 테스트 ≥5 (mmToPx/클램프/스키마 파싱/딥링크 URL 빌더/프리셀렉트 파서)
- [ ] `npx next build` 통과(Konva SSR 미포함 — 서버 번들에 konva 누출 없음)
- [ ] 기존 스튜디오 동작 회귀 0(프리셀렉트 파라미터 없을 때 기존과 동일)
- [ ] diff In-scope 내

## 8. 핸드오프
마지막 응답 = 페이로드 JSON. 커밋 금지.
