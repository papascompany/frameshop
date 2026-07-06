# CONTEXT PACKAGE — FS-P1 확장형 편집기 MVP 웨이브
작성: orchestrator @ 2026-07-06
승인: CTO Review Gate 통과(계획 승인 + 로그인 묶음 동기화 = probe 폴백)

## 1. Goal
한 편집 세션에서 멀티포토 업로드(사진풀) → 라인별 독립 사이즈/방향/수량(혼합) → 묶음(projectLocalId 공유) 담기.
CTO 케이스 1~4(같은 사진 다른 사이즈 / 사진별 다른 사이즈·방향 / 같은 사이즈 N장 / A·B·C+혼합방향) 전부 커버.
**베이직(단품) 경로 회귀 0** — `kind:'basic'`은 현행 코드 문자 그대로.

## 2. 환경 사실 (전 유닛 공통 — 추측 금지)
- 브랜치: `feat/extended-p1-editor` (base: main@2e9a738). 커밋은 orchestrator만.
- 검증: `rm -rf .next/types && npx tsc --noEmit` · `npx eslint <경로>` · `npx vitest run`(베이스라인 **451 passed | 14 todo**) · `npx next build`
- 마이그 034/035는 **미적용 가능** — graceful 필수(ADR-023/024 패턴: feature-probe + conditional-spread + 명시 컬럼).
- 의존성 추가 시 **pnpm-lock.yaml도 갱신**(`pnpm install --lockfile-only`) — 이중 lockfile 함정(#60 실사고).
- FROZEN 옵셔널 추가만 허용(ADR-025가 게이트). TS strict, any 금지, select('*') 금지(상품 테이블 예외 기존 유지).
- Konva는 src/modules/ 안 + dynamic ssr:false(ADR-015). Next.js 16 react-hooks set-state-in-effect 금지(파생상태는 스토어로).

## 3. 확정 설계 (정찰 3차원 근거 — 변경하려면 orchestrator 승인)
### 모드 분기
- 진입: 상품 상세 "여러 장 만들기" CTA → `/studio/{uuid}?productId=...&mode=multi`.
- 스토어 `kind: 'basic' | 'extended'` (init 시 URL mode로 결정, 기본 'basic').
- `kind:'basic'`: setSize(~L209)/setOrientation(~L192)의 `entries:[]` 초기화 **유지**, PhotoPoolPanel/LineList 미렌더 — 현행과 라인 단위 동일 동작.
- `kind:'extended'`: entries 초기화 **미실행**(라인별 독립), 전역 옵션 변경은 "활성 컨텍스트(새 라인 기본값)"만 변경.

### 라인(Entry) 계약 — ADR-025 옵셔널 추가
- `EditorPhotoEntry` 옵셔널 추가: `selectedOptions?: SelectedOptions`(라인 스냅샷) · `orientation?: 'portrait'|'landscape'` · (variantId는 variantsByKey[variantKey(selectedOptions)]로 파생 — 저장하지 않음, 이중 진실 방지).
- basic 라인은 이 필드들 없음(undefined) → 전역 옵션 사용(현행). extended 라인은 항상 채움.
- `useEditorTotals`: entry에 selectedOptions 있으면 라인별 가격, 없으면 전역 가격 — `sum(price_i × qty_i)`.

### 사진풀
- 스토어 `photoPool: ProjectPhotoRef[]`(src/types/project.ts 기존 타입 재사용) + 액션: `addPhotoToPool`, `removeFromPool`.
- 라인 생성: `createLineFromPhoto(photoId)` — 사진 종횡비 best-fit으로 orientation 기본값 제안. 크롭/베이크는 기존 handleAddToTray 플로우 재사용(라인별 variant 기하).
- 라인 조작: `updateLineOptions(entryId, selectedOptions, orientation)`, `duplicateLine(entryId)`, `applyOptionsToAllLines(selectedOptions)`(일괄적용).

### 드래프트 v2 (ADR-022 진화)
- `EditorDraft` version 2: `kind`, `photoPool?`, entries(라인 옵션 포함). v1 로드 시 자동 승격(kind:'basic', photoPool 없음, 손실 0). 키/TTL/안전파싱 현행 유지.

### 묶음 담기 → 주문
- extended `handleCheckoutAll`: 세션당 1회 `projectLocalId = crypto.randomUUID()` 생성, 라인 N개를 `addToCart({..., projectId: projectLocalId, projectSeq: i, orientation})` — CartItem 옵셔널 필드(P0) 사용. localStorage v2는 이미 지원.
- **가격**: 세트 할인 없음(P1) → 라인별 개별 CartItem이라 기존 createOrder 서버 가격 재검증(PRICE_MISMATCH)이 라인별로 그대로 동작. 신규 가격 경로 0.
- `createOrder`: cartItems를 projectId로 그룹 → 그룹당 서버 `project_group_id = randomUUID()` 부여 → order_items에 (a) **variant_snapshot(jsonb)에 orientation/projectSeq/groupLabel 동결**(마이그 불필요 — 035 미적용에서도 보존), (b) 035 적용 시(probe) `project_group_id/project_seq/orientation` 컬럼도 conditional-spread. 단품(projectId null) 혼재 허용.
- 로그인 카트 DB 동기화(probe 폴백 — CTO 확정): `isProjectCartAvailable()` probe(cart_items.project_id 존재 확인). true → cart_projects 헤더 upsert(034) 후 cart_items에 project 컬럼 포함 upsert(FK 순서: 헤더 먼저). false → project 필드 생략(평면 저장, 묶음 정보는 주문 스냅샷에 보존됨을 주석 문서화).
- 익명: localStorage만 — 034/035 무관 완전 동작.

### ADR-021 준수(P1 범위)
- 세트 할인 없음 → 비례배분 로직 불필요. 세트 단위 취소/부분선택 불가 UI는 P3(카트 시각화)에서 — P1 카트는 평면 N줄 표시(기존 카트 페이지가 projectId 필드를 무시하므로 안전 — 정찰 확인).

## 4. 유닛별 In-scope
| 유닛 | 담당 | In-scope(수정 가능) |
|---|---|---|
| FS-P1-00 | architect | shared/DECISIONS.md(ADR-025), src/types/editor.ts, src/lib/editor/draft.ts(타입·마이그레이터), src/types/order.ts(스냅샷 옵셔널), src/lib/db/feature-probe.ts(wrapper 추가), tests/** |
| FS-P1-01 | frontend-dev | src/store/editor.ts, tests/** |
| FS-P1-02 | backend-dev | src/lib/db/cart.ts, src/lib/db/order.ts(createOrder 그룹 동결), src/app/api/cart/**(배치 sync), src/lib/cart/**(sync/client), tests/** |
| FS-P1-03 | frontend-dev | src/app/(shop)/studio/[orderId]/**(StudioClient+신규 컴포넌트), src/modules/editor/**(필요 시), src/app/(shop)/product/[id]/**(CTA), src/messages/*.json(studio 키), tests/** |

Out-of-scope(전 유닛): admin/**, checkout/**, wall/**, shared/STATUS·HANDOFF(orchestrator/docs 전용), 서로의 In-scope.

## 5. Done Criteria (전 유닛 공통)
- [ ] tsc 0 · eslint(수정 경로) 0 · vitest 전체 green(기존 451 무파손) · (UI 유닛) next build 통과
- [ ] 신규 테스트: 유닛별 ≥5 (베이직 회귀 고정 테스트 필수 — basic 모드에서 현행 동작 문자 그대로)
- [ ] diff In-scope 내, 커밋 금지, 마지막 응답 = 핸드오프 페이로드 JSON
