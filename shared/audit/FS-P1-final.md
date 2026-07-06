# FS-P1 확장형 편집기 MVP — Final Audit
Date: 2026-07-06
Reviewer: qc-reviewer (Final Reviewer)
Scope: feat/extended-p1-editor 미커밋 변경 전체 (17 modified + 8 untracked src/tests)
계약: shared/context/FS-P1-wave.md + ADR-025 (shared/DECISIONS.md)

## Summary
- P0: 2
- P1: 2
- P2: 5
- **Overall: NO-GO** (P0 2건 해소 전 병합/다음 단계 금지)

## 게이트 재실행 결과
| 게이트 | 결과 |
|---|---|
| `npx vitest run` | 510 passed / 14 todo (베이스라인 451 무파손 — 기존 테스트 2파일은 순수 추가 229줄, 삭제 0) |
| `rm -rf .next/types && npx tsc --noEmit` | 0 errors |
| `npx eslint <수정 경로 전체>` | 0 |
| `npx next build` | 통과 |
| 금지 토큰 diff 스캔 (`any`/`@ts-ignore`/`console.log`/`select('*')`) | 0건 |
| 범위 오염 | 없음 — 전 변경이 §4 In-scope 합집합 내 (예외 잔존물: `.claude/*`, `README 2.md` — 웨이브 이전부터 존재) |

## Findings

### P0-001: 로그인 카트 경로에서 묶음 필드가 주문 도달 전 유실 — ADR-025 폴백 계약("스냅샷 동결로 보존") 불성립
**Severity:** P0
**Area:** Seam / Business Logic (직전 웨이브 P0-001과 동일 클래스 — 계층 간 필드 드롭)
**Files:** src/lib/db/cart.ts (upsertCartItem probe-false 분기), src/lib/cart/client.ts:54-63 (getCart), src/app/(shop)/checkout/CheckoutClient.tsx:80,312
**Issue:** 전 구간 추적 결과, **로그인 사용자 + 034/035 미적용 DB(probe false — 현 프로덕션 상태)** 에서 묶음 필드가 주문에 도달하지 못한다:
1. `handleCheckoutAllExtended` → `addToCart({projectId, projectSeq, orientation})` — 로컬 미러 기록 + `/api/cart` POST ✅
2. `/api/cart` route → `cartItemSchema` 파싱 — 필드 통과 ✅
3. `upsertCartItem` — probe false → project 필드 **드롭, 평면 저장** (계약상 의도된 동작) ✅
4. **끊기는 지점:** `CheckoutClient`는 `getCart()`로 주문 페이로드를 구성하는데, 로그인 시 getCart는 **DB만 읽고 로컬 미러를 무시**한다 → `listCartForUser`(probe false, 레거시 컬럼 SELECT)가 projectId 없는 평면 items 반환
5. `/api/orders` → `createOrder`: `projectGroups`가 빈 Map → **variant_snapshot에 groupLabel/projectSeq/orientation 미동결**
**결과:** 미적용 기간의 로그인 확장형 주문은 묶음 메타가 **영구 소실**. src/lib/cart/client.ts:110-116, feature-probe.ts:88-93, db/cart.ts upsertCartItem 주석의 "드롭은 유실이 아니다 — 주문 스냅샷에 동결" 주장 및 ADR-025 Decision 7·Consequences("주문 시점 스냅샷으로는 보존")와 **구현이 모순**. 익명 경로(localStorage 왕복)와 probe true 경로는 정상.
**테스트가 못 잡은 이유:** `order-create-project-group.test.ts`는 cartItems에 projectId가 이미 실린 시점부터 시작 — 상류(카트 왕복) 유실은 커버 범위 밖. `cart-db-project.test.ts`도 upsert/list를 각각 검증할 뿐 checkout 페이로드 조립 이음새는 미검증.
**Recommendation:** (a) probe false 시에도 로그인 담기의 로컬 미러를 주문 페이로드 SSOT로 사용(체크아웃에서 DB items에 로컬 미러의 project 필드를 local_id 기준 병합), 또는 (b) probe false 시 project 필드를 기존 jsonb 컬럼(options 등) 안에 동봉해 왕복 보존, 또는 (c) 최소한 ADR-025/주석의 "유실 아님" 주장을 철회하고 CTO에 034/035 선적용을 병합 전제조건으로 명시. (a)/(b)가 계약 유지 관점에서 정답.
**Assigned to:** backend-dev (FS-P1-02) — 이음새 검증 테스트(카트 왕복→주문 조립) 추가 필수

### P0-002: extended→basic 교차 진입 시 잔존 라인이 basic 결제 경로로 유입 — 표시≠청구 + 베이크 기하≠주문 variant
**Severity:** P0
**Area:** Business Logic / 베이직 회귀 (웨이브 불변식 "basic은 현행 문자 그대로" 위반 — basic 결제 경로가 스냅샷 보유 라인을 소비 가능)
**Files:** src/app/(shop)/studio/[orderId]/StudioClient.tsx:159-232 (마운트 이펙트·draft-skip 분기), :538-577 (basic handleCheckoutAll), src/store/editor.ts (전역 zustand, unmount 정리 없음)
**Issue:** zustand 스토어는 모듈 전역이고 StudioClient에 unmount 정리가 없다. 재현: ① multi CTA로 extended 스튜디오 진입, 라인 N개 담기(체크아웃 안 함) ② SPA 내비게이션으로 같은 상품의 기본 CTA(`mode` 없음) 진입 ③ basic 마운트는 `reset`을 실행하지 않고, extended 드래프트 skip 분기(L204~)는 **복원만 건너뛰고 메모리의 entries/photoPool은 방치** ④ basic 트레이에 extended 라인(라인별 스냅샷 보유)이 그대로 노출 ⑤ `useEditorTotals`는 라인 스냅샷 가격으로 합계 **표시** ⑥ basic `handleCheckoutAll`은 각 라인을 **전역 variantId·전역 price**로 담음(L556-568) ⑦ 서버 PRICE_MISMATCH는 전역가-전역variant가 일치하므로 통과.
**Risk:** (1) 스튜디오 표시 합계 ≠ 실제 청구액(FS-EC P0-001과 동일한 표시≠청구 클래스), (2) 라인의 베이크 크롭(라인 기하)과 주문 variant(전역 기하)가 불일치한 **결함 실물 주문**이 결제 완료됨. skip 분기 주석이 방지하려던 바로 그 어긋남("라인별 옵션 스냅샷이 basic 결제 경로와 어긋난다")이 in-memory 경로로 그대로 발생.
**Recommendation:** basic 마운트 시 `storeKind === 'extended'`(또는 스냅샷 보유 entry 존재)면 `reset('basic')` 후 드래프트 복원 진행. 혹은 StudioClient unmount cleanup에서 reset. 회귀 테스트: "extended 라인 잔존 상태에서 basic 마운트 → 트레이 비움" 고정.
**Assigned to:** frontend-dev (FS-P1-03, 스토어 접점은 FS-P1-01 협의)

### P1-001: basic 드래프트를 `?mode=multi`로 복원하면 스냅샷 없는 라인이 extended 세션에 유입 — ADR-025 "extended 라인은 항상 채움" 위반
**Severity:** P1
**Area:** Correctness (edge)
**Files:** src/app/(shop)/studio/[orderId]/StudioClient.tsx:199-231 (복원 분기 — draft.kind 무시하고 URL kind 사용), src/store/editor.ts restoreDraft
**Issue:** basic(또는 v1 승격) 드래프트 + `?mode=multi` 진입 시 entries가 스냅샷 없이 복원된다(주석으로 의도 명시). 이 라인들은 `entry.selectedOptions ?? globalOpts` 폴백으로 **전역 옵션을 따르므로**, extended의 setSize/setOrientation(트레이 유지)이 라인의 유효 옵션·가격·variant를 암묵 변경한다 — 베이크 크롭은 구 기하 그대로. LineCard의 재크롭 배지도 미발화(`recordBaseline`은 라인 카드 이벤트 핸들러에서만 기록, 전역 변경은 미포착) → 무경고 기하 불일치 담기 가능.
**Recommendation:** basic 드래프트를 extended로 복원할 때 각 entry에 복원 시점 전역 옵션/방향을 스냅샷으로 스탬프(간단·계약 복구). 회귀 테스트 추가.
**Assigned to:** frontend-dev (FS-P1-03) / architect 계약 주석 갱신 (FS-P1-00)

### P1-002: 재크롭 배지가 담기를 차단하지 않고, 베이스라인이 컴포넌트 로컬 state라 새로고침 후 소실
**Severity:** P1
**Area:** Correctness (edge) / UX
**Files:** src/app/(shop)/studio/[orderId]/LineList.tsx:50-63, StudioClient.tsx handleCheckoutAllExtended
**Issue:** 라인 옵션 변경 후 재크롭 없이 담기가 가능하다(배지는 권고일 뿐). 게다가 배지 판정 기준(bakedGeom)이 LineList 로컬 state라 새로고침/드래프트 복원 후에는 배지 자체가 사라져(코드에 문서화된 P1 한계) 기하 불일치 라인이 무경고로 주문된다. 결제·가격은 정합(라인 variant로 담음)하나 인쇄 기하 품질 결함 가능.
**Recommendation:** 최소 담기 시점에 needsRecrop 라인 존재 여부 confirm(또는 차단). 근본적으로는 베이크 기하를 entry에 보존해야 하나 타입 FROZEN — ADR 후속(P2+)으로 이관 명시.
**Assigned to:** frontend-dev (FS-P1-03)

### P2-001: 묶음 담기 부분 실패 비멱등
**Files:** StudioClient.tsx handleCheckoutAllExtended, src/lib/cart/client.ts addToCart
루프 중 네트워크 예외 시 일부 라인만 담기고, 재시도는 **새 projectLocalId**로 중복 담김(localId도 매회 신규). basic도 동일 구조(기존 동작)이나 extended는 호출 수가 커 노출 확대. 라인 배열 선구성 후 일괄 실패 롤백 또는 localId 결정화 권고.

### P2-002: extended 담기 가드 `if (!variantId) return;`
전역(새 라인 기본값) 조합이 비활성이면 모든 라인이 유효해도 CTA가 무반응/비활성 — 사유 미표시. 라인 유효성과 분리 권고.

### P2-003: extended photoPool의 basic 드래프트 누출
extended 세션 잔존 pool이 basic 마운트 후 persist 이펙트에 의해 kind:'basic' 드래프트에 기록됨 → 빈 트레이여도 드래프트가 소거되지 않고 부활. P0-002 수정(reset)으로 함께 해소됨 — 수정 시 회귀 테스트에 포함할 것.

### P2-004: 신규 코드 `as unknown as` 이중 캐스트 4건
StudioClient 합성 Photo(SessionId/IsoTimestamp 캐스트). 동작상 안전(widthPx null → 방향 제안 폴백)하나 strict 우회 — 합성 헬퍼로 정리 권고.

### P2-005: 잔존물 `README 2.md`
웨이브 이전부터 존재(Finder 복제 추정). 커밋 전 정리/의도 확인. `.claude/launch.json`·`.claude/worktrees/`는 워크트리 잔존물 예외 처리.

## 검증된 것 (Positive)
- **이음새(probe true) 전 구간 연결 확인:** addToCart → cartItemSchema(project 필드 P0 웨이브 기지원) → /api/cart → upsertCartItem(cart_projects 헤더 **선행** upsert, 23505 race re-select 수습, service-role RLS 우회 사유 문서화) → listCartForUser(이중 SELECT 문자열 — 미적용 42703 방지) → createOrder(클라 키 불신, 서버 group id 신규 발급, jsonb 동결 + conditional-spread, 단품 혼재 시 균일 키 NULL).
- **익명 경로 완전 동작:** localStorage v2 왕복(storage.ts가 cartItemSchema로 파싱 — 필드 보존) → /api/orders cartItemSchema 배열 파싱 → 동결. 034/035 무관.
- **레거시 회귀 고정:** 단품 주문 INSERT 컬럼 집합 문자 그대로 + probe 무호출을 테스트로 고정(order-create-project-group.test.ts L381-406). basic 분기 밖 변경은 전부 kind 가드 또는 의미 등가(useEditorTotals의 basic 수렴, suggestOrientation 추출) — 기존 테스트 무수정 통과.
- **드래프트 v2:** 키 유지+payload version 판별(ADR-025 대안 기각 사유 타당), v1 무손실 승격, 손상 폐기, 라인 옵션 형태 검증 — 테스트 견고.
- **ADR-021 준수:** 세트 할인 로직 0, 신규 가격 경로 0 — 라인별 서버 재검증 그대로.
- **정독 테스트(order-create-project-group.test.ts):** 인프라만 모킹, 산출 행 검증 — 자기모킹/기대완화 없음. 기존 테스트 파일 2건은 순수 추가.

## Verdict
**NO-GO.** P0-001(로그인 폴백 계약 불성립 — 현 프로덕션 DB 상태에서 발생하는 라이브 경로)·P0-002(basic 결제 경로 오염) 해소 및 이음새 회귀 테스트 추가 후 재감사.
