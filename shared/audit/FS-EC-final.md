# FS-EC Final Review — 이커머스 완성 웨이브 (FS-EC-00~06)
Date: 2026-07-03
Reviewer: final-reviewer (적대 검증 — diff/코드 직접 재검증)
Scope: 브랜치 `feat/ecommerce-basics-photowall` 미커밋 변경 전체 (modified 25 + untracked 신규 파일)
Verdict: **NO-GO** (P0 1건 잔존)

## Summary
- P0: 1 (결제 금액 정합 파괴 — redeemPoints/receipt가 API 라우트에서 유실)
- P1: 1 (스튜디오 딥링크가 기존 편집 드래프트 삭제 — ADR-022 충돌)
- P2: 5
- 게이트: tsc 0 에러 / eslint 0 / `npx vitest run` **413 passed, 14 todo(기존), 2 skipped 파일(기존 e2e)** / `npx next build` exit 0 (Konva SSR 누출 없음, /wall /terms /privacy /account/points 라우트 생성 확인)

## Findings

### P0-001: /api/orders 라우트가 redeemPoints·receipt를 createOrder에 전달하지 않음
**Severity:** P0 (결제 정확성 — 고객이 화면에서 본 금액과 실제 청구 금액 불일치)
**File:** `src/app/api/orders/route.ts:84-98`
**Issue:** `bodySchema`(= `.and(createOrderInputSchema)`)는 `redeemPoints`/`receipt`를 파싱하지만, 라우트가 `input: CreateOrderInput`을 명시적 필드 나열로 조립하면서 두 필드를 **누락**한다. `createOrder`(src/lib/db/order.ts)의 redeem/receipt 로직은 완전하지만 이 라우트를 통해서는 절대 도달하지 못한다.
**Impact 재현 체인:**
1. 체크아웃 FE(CheckoutClient.tsx:326-330)가 `redeemPoints: 5000` 전송, 요약 UI에는 5,000원 차감된 합계 표시.
2. 서버 `createOrder`는 `input.redeemPoints === undefined` → `redeemRequested = 0` → `totalPrice = 전액`.
3. FE는 서버 응답 `order.totalPrice`(전액)로 Toss 위젯 호출 → **고객이 본 합계보다 큰 금액이 청구**. 포인트는 차감되지 않음(잔액 손실은 없으나 FS-EC-02 §4 "암묵 전액결제 금지" 위반).
4. `receipt` 동일 유실 → 현금영수증 신청이 조용히 무시됨(주문에 저장 안 됨, 발급 훅 비활성).
**왜 테스트가 못 잡았나:** 신규 테스트(order-create-ec.test.ts)는 `createOrder`를 직접 호출 — 라우트 계층 seam 미검증. 라우트는 이번 웨이브 In-scope에 명시되지 않아 어느 에이전트도 소유하지 않은 통합 공백(오케스트레이션 seam miss).
**Fix:** route.ts input 조립에 `redeemPoints: parsed.data.redeemPoints`, `receipt: parsed.data.receipt ?? null` 추가 + 에러 status 매핑에 `POINTS_UNAVAILABLE`/`POINTS_INSUFFICIENT`/`RECEIPT_UNAVAILABLE` → 4xx(422 권장) 추가 + 라우트 레벨 통합 테스트 1개(redeem 요청 → insert된 total_price 검증).
**Assigned to:** backend-dev (FS-EC-02 소유자)

### P1-001: 스튜디오 딥링크(프리셀렉트) 진입 시 같은 상품의 기존 드래프트가 300ms 후 삭제됨
**Severity:** P1 (사용자 작업물 유실 — ADR-022 편집 세션 무결성 충돌)
**File:** `src/app/(shop)/studio/[orderId]/StudioClient.tsx:118-133` (드래프트 복원 skip) + `:150-161` (persist effect)
**Issue:** 프리셀렉트 적용 시 드래프트 복원을 건너뛰며 주석은 "the saved draft stays intact in localStorage for a later plain visit"라고 주장한다. 그러나 persist effect가 마운트 직후(debounce 300ms) 빈 트레이로 `saveEditorDraft(...entries: [])`를 호출하고, `src/lib/editor/draft.ts:69-71`은 빈 entries에 대해 `localStorage.removeItem`을 실행 → **기존 드래프트가 즉시 파괴**된다. 코드와 주석이 모순.
**전제 조건:** 로그인 사용자(sessionId=userId 안정 키)가 상품 X 드래프트 보유 상태에서 포토월 → 같은 상품 X "편집하기" 딥링크 클릭. (게스트도 sessionId가 유지되는 동안 동일.)
**Fix 후보:** (a) 프리셀렉트 적용 시 첫 persist를 억제(드래프트 존재 && entries 빈 동안 skip), 또는 (b) 드래프트 존재 시 복원 후 옵션만 프리셀렉트로 덮기, 또는 (c) 주석/스펙을 "딥링크는 새 세션 시작 = 드래프트 대체"로 정정하고 사용자 확인 UI. wall-preselect 테스트는 순수 함수만 검증해 이 상호작용을 못 잡음.
**Assigned to:** frontend-dev (FS-EC-04 소유자)

### P2-001: package-lock.json 대량 재동기화(+3,334줄)가 jszip 1건 범위를 초과
**File:** `package-lock.json`
**Issue:** HEAD lockfile이 package.json과 드리프트 상태였음(@sentry/nextjs·next-intl 등이 lockfile에 부재 — `npm ci` 이미 깨져 있었음). jszip 설치가 전체 재동기화를 유발. 수정 자체는 필요했으나 이번 웨이브 계약 밖의 무통제 변경(신규 transitive 다수: @opentelemetry, @apm-js-collab 등 Sentry 계열).
**Fix:** 커밋 메시지에 드리프트 재동기화 명시 + 클린 환경 `npm ci && npx next build` 1회 검증(로컬 build는 통과 확인됨).

### P2-002: points 조회 로직 이중화 — `src/lib/db/points.ts`(service-role) vs `src/app/(shop)/account/points/points-data.ts`(user JWT)
**Issue:** FS-EC-01 §5의 충돌 회피 지침(“db/points.ts를 import하지 말 것”)대로 만들어졌으나, 통합 단계에서 정리하기로 한 이중화가 최종 상태에 남음. 잔액/원장 매핑 로직 2벌.
**Fix:** 후속 정리 티켓 — RLS(owner-select) 유지가 필요하면 points-data.ts를 정본으로 하고 db/points.ts는 mutation 전용으로 문서화.

### P2-003: /api/orders 신규 에러코드 status 매핑 부재 (P0-001 수정에 포함)
**File:** `src/app/api/orders/route.ts:105-111`
**Issue:** `POINTS_UNAVAILABLE`/`POINTS_INSUFFICIENT`/`RECEIPT_UNAVAILABLE`가 default `500`으로 떨어짐 — 사용자 입력 오류가 서버 오류로 기록됨(Sentry 노이즈).

### P2-004: 범위 외 소음 파일
- `.claude/launch.json` (untracked) — 커밋 제외 또는 .gitignore 추가 권장.
- `src/messages/en.json`/`ko.json` `nav.wall` 1줄 — In-scope 명시엔 없으나 Header `t('wall')`에 필수(수용). `account/layout.tsx`의 '적립금'은 하드코딩(주석으로 TODO 명시됨) — 통합 시 i18n 승격 필요.

### P2-005: /terms·/privacy가 정적(○)이 아닌 동적(ƒ) 렌더
**Issue:** FS-EC-05는 "신규, 정적"을 의도. 빌드 출력상 ƒ — 상위 레이아웃/헤더의 동적 요인으로 추정. 실해 없음(콘텐츠 정적), 성능 미세 손실.

## 교차 검증 결과 (절차별)
1. **범위 오염:** 예외(README 2.md·shared/·.claude/worktrees) 제외 시 P2-004 외 전부 In-scope 합집합 내. FS-EC-05의 product/[id] JSON-LD는 HEAD에 기구현 확인(safeJsonLd + buildProductJsonLd) — 이번엔 직렬화 라운드트립 테스트만 추가(완화 없음, add-only).
2. **정합성 교차:**
   - (a) createOrder 페이로드: FE `clientShippingFee = base+surcharge` ↔ 서버 `shippingFee + surchargeFee` 비교 — 일치. **단 redeemPoints/receipt는 라우트에서 유실(P0-001)**.
   - (b) 합계 산식: FE `computeCheckoutTotals`(subtotal+fee+surcharge−redeem) ↔ 서버 `payable − redeemRequested` — 동일 순수 함수(`classifyZip`/`calcSurcharge`/`maxRedeemable`) 공유, 일치. Toss 요청 금액 = 서버 totalPrice(권위) — 구조는 정상.
   - (c) admin 부분환불: `refundOrderAction(orderId, opts?)` 시그니처 변경 — 호출부 2곳(AdminOrderDetailClient:172, 207) 전부 opts 형태로 갱신 확인, 타 호출부 없음. 낙관적 잠금(`eq refunded_amount prev`)·Toss 선집행·기록 실패 비은폐 — 양호. getOrder는 `select('*')`(기존)라 038 적용 시 refundedAmount 정상 유입.
   - (d) /account/points: route 응답 `{ok, available, balance, ledger}` ↔ 페이지/체크아웃 소비 일치. 401/미적용/DB오류 분기 테스트로 검증됨.
   - (e) 스튜디오 프리셀렉트: 파라미터 없으면 기존 경로 문자 그대로(no-op) — 회귀 없음. 단 딥링크+기존 드래프트 조합에서 P1-001.
3. **회귀 표면:** 기존 단품 주문(redeem 0/mainland/no receipt) INSERT 컬럼 집합이 레거시와 동일함을 테스트로 고정(order-create-ec "keeps the exact legacy INSERT column set"). 전액환불은 `fullRefund()`로 분리돼 로직 무변경. confirm.ts의 `totalAmount !== input.amount` 검증 무변경. 체크아웃은 zod 스키마 직접 사용으로 전환(checkoutFormSchema는 HEAD 기존 + 옵셔널 확장) — 레거시 필드 검증 의미 동일.
4. **graceful(029~039 전부 미적용):** feature-probe(60s TTL, 성공 영구캐시) → 체크아웃 3섹션 비노출·partial refund UI/액션 차단·receipt 훅 자동 skip·accrual skip. orders INSERT conditional-spread 검증(테스트 포함). 신규 SELECT 전부 명시 컬럼이며 신규 컬럼 미포함(admin-stats는 refunded_amount 미반영을 문서화). mapOrder/mapShippingMethod undefined-safe 폴백. 위반 0.
5. **증거 재실행:** `npx vitest run` → **Test Files 48 passed | 2 skipped (50) · Tests 413 passed | 14 todo (427)**. skipped/todo 전원 HEAD 기존(e2e placeholder·integration todo). 정독 파일: `tests/unit/modules/order-create-ec.test.ts` — 인프라(supabase/probe/shipping)만 모킹, 실제 createOrder 실행, 보상 트랜잭션·conditional-spread·fail-closed 경계 실질 검증. account-points/admin-refund-partial도 대상 함수 자체는 미모킹.
6. **테스트 무결성:** 신규 `.skip` 0, 기대값 완화 0, 대상 함수 자기모킹 0. 기존 테스트 수정 1건(seo-metadata) — add-only.

## Positive Findings
- 금전 경로 설계 견고: redeem RPC 차감을 INSERT 직전 배치 + 이중 실패 지점(orders/order_items) 모두 보상 트랜잭션 + 비은폐 구조화 로그.
- 부분환불 낙관적 잠금과 "Toss 집행 후 기록 실패" 시 수동 보정 금액까지 포함한 에러 메시지.
- feature-probe 캐시 설계(성공 영구/실패 60s)로 마이그 적용 시 무재배포 자동 활성화.
- 현금영수증 훅의 멱등 가드(`receipt_issued_at IS NULL` 조건 UPDATE) + 민감정보(식별번호) 로그 배제.
- ZIP 라우트: requireAdmin 이중 게이트, 엔트리명 새니타이즈, STORE 무압축, manifest 실패 기록.

## Gate 판정
| Gate | 결과 |
|---|---|
| Scope | PASS (P2 소음 2건) |
| Integration | **FAIL** (P0-001) |
| Regression | PASS |
| Graceful (029~039 미적용) | PASS |
| Tests re-run | PASS — vitest 413 passed/0 failed · tsc 0 · eslint 0 · next build exit 0 |

**P0-001 수정 + 라우트 통합 테스트 추가 + 본 리뷰어 재검증 전까지 머지 금지.**
