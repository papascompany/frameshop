# FS-P1 확장형 편집기 웨이브 — 보안·시크릿 감사

- Date: 2026-07-06
- Reviewer: security-reviewer (QC)
- Scope: `feat/extended-p1-editor` 미커밋 변경 전체(git diff HEAD, base main@2e9a738) + untracked
  (StudioClient/PhotoPoolPanel/LineList/MultiCheckoutControls, cart.ts/order.ts/feature-probe.ts,
  draft.ts/editor.ts(store·types)/cart client, 신규 테스트 5파일)
- 계약: `shared/context/FS-P1-wave.md`, ADR-025(`shared/DECISIONS.md`)

## Summary

- P0: 0
- P1: 1
- P2: 5
- **Verdict: GO-WITH-RISKS** — P0 없음. P1-001은 마이그레이션 034/035 **적용과 동시에 활성화되는
  결함**이므로, 적용 전 반드시 수정할 것(적용 전까지는 probe=false 로 잠복).

## Findings

### P1-001: cartItemSchema 의 project 필드가 DB 컬럼 타입보다 느슨 — 22P02/22003 무처리 500
**Severity:** P1 (현재 잠복 — 034/035 적용 즉시 실동작 경로)
**Area:** 입력 검증 / DoS
**Files:**
- `src/types/cart.ts:108` — `projectId: z.string().min(1)` (uuid 아님)
- `src/types/cart.ts:109` — `projectSeq: z.number().int().nonnegative()` (상한 없음 → int4 초과 가능)
- 소비처: `src/app/api/cart/route.ts:66-75` → `src/lib/db/cart.ts:109-158`(upsertCartProject), `:165-183`
- `supabase/migrations/034:project_local_id uuid NOT NULL`, `035:project_seq int`

**Issue:**
1. 034 의 `cart_projects.project_local_id` 는 **uuid** 타입인데 API 경계 zod 는 `min(1)` 문자열만
   요구한다. probe=true(034/035 적용) 상태에서 `POST /api/cart` 에 `projectId:"x"` 를 보내면
   `upsertCartProject` 의 `.eq('project_local_id','x')` / insert 가 Postgres **22P02** 로 실패하고,
   `/api/cart` POST 는 try/catch 가 없어 **무처리 500**이 된다(라우트 전체 에러 매핑 부재).
2. `projectSeq` 는 2^53 까지 통과하는데 DB 컬럼은 int4 — 2,147,483,648 이상이면 **22003**.
   `/api/cart` 는 위와 같이 500. `/api/orders` 경로에선 order_items 벌크 insert 가 실패하는데,
   이 시점은 **orders 행 생성 이후**라 SEQUENCE_FAILED 보상(포인트 환급)은 되지만 죽은 CREATED
   주문 행이 남는다(rate limit 10/min 으로 상한은 있음).
3. 같은 라우트에서 `productId`(z.string().min(1))가 cart_projects.product_id(uuid FK RESTRICT)에
   그대로 들어간다 — 비uuid=22P02, 미존재 uuid=23503, 동일하게 500.

**Risk:** 034/035 적용일부터 변조 클라이언트(또는 손상된 localStorage v2 카트의 syncCartOnLogin)가
반복 500 을 유발 — Sentry 오염 + 오류 원인 은폐. 인증 필요 + cart_write 60/min 이라 대규모 DoS 는
아니나, "적용 즉시 터지는" 예고된 회귀다.
**Recommendation:** `projectId: z.string().uuid()`, `projectSeq: .max(9999)`(int4 여유 상한),
`productId: .uuid()` 로 조이고, `/api/cart` POST 에 try/catch → `{ok:false,code}` 매핑을 추가.
**Assigned to:** backend-dev (FS-P1-02 범위: src/types/cart.ts 는 FROZEN 옵셔널이므로 zod 강화는
ADR-025 무파손 — architect 확인 1줄이면 충분)

### P2-001: cart_projects 고아 헤더 누적 — 정리 경로 부재 + 무한 생성 가능
**Severity:** P2
**Area:** 자원 위생 / 남용
**File:** `src/lib/db/cart.ts:109-158`, `:220-246`(removeCartItem/clearCartItems — 라인만 삭제)
**Issue:** 헤더는 service-role 로 insert 만 되고 어떤 경로로도 삭제되지 않는다(주문 완료·라인 전체
삭제 후에도 잔존). 인증 사용자는 매 POST 마다 새 projectId 로 헤더를 60개/분씩 무한 생성 가능
(RLS 미적용 — service-role 쓰기). CASCADE 역방향(헤더 삭제→라인 삭제)은 **앱에 노출된 API 가
없어 도달 불가**(양호 — 아래 Positive 참조), 문제는 순수 누적.
**Recommendation:** (a) 마지막 자식 라인 삭제 시 고아 헤더 삭제, 또는 (b) 주기 cleanup(cron) +
사용자당 헤더 수 상한. P3 카트 시각화 전까지 헤더를 읽는 곳이 없으므로 급하지 않음.
**Assigned to:** backend-dev

### P2-002: listCartForUser 가 서버 헤더 PK 를 projectId 로 노출 — 미래 라운드트립 시 중복 헤더
**Severity:** P2 (정보성)
**Area:** 무결성
**File:** `src/lib/db/cart.ts:86-92`
**Issue:** GET /api/cart 응답의 `projectId` = cart_projects **서버 PK**. 현재 클라 코드는 GET 결과를
POST 로 되돌리지 않아 실경로 없음(정찰 확인: addToCart 는 로컬 항목만 POST, 수량변경은 PATCH).
단, 미래에 GET 항목을 재-POST 하는 클라이언트가 생기면 `project_local_id = 기존 헤더 PK` 인
중복 헤더가 조용히 생성된다(그룹 키 일관성은 유지되나 헤더가 이중화).
**Recommendation:** 주석은 이미 존재. upsertCartProject 에서 "project_local_id 가 기존 헤더 PK 와
일치하면 그 헤더를 재사용" 가드 한 줄이면 봉인 가능. P3 카트 시각화 때 처리해도 됨.
**Assigned to:** backend-dev (P3 백로그)

### P2-003: 확장형 멀티 업로드 vs 업로드 rate limit 10/min — 정당 사용자 충돌
**Severity:** P2
**Area:** 가용성 / UX (보안 우회 아님)
**File:** `src/app/(shop)/studio/[orderId]/StudioClient.tsx:262-288(uploadPhotoFile), 316-360(handlePoolFiles)`,
`src/lib/upload-ratelimit.ts:10(UPLOAD_RATE_PER_MIN=10)`
**Issue:** 사진풀 멀티 업로드는 기존 `/api/photos/upload` 를 파일당 1 POST 로 순차 호출 —
**검증 우회는 없음**(양호). 그러나 확장형은 "여러 장"이 전제인데 11장째부터 429 → 클라는
`body.ok` 만 보고 "사진 업로드에 실패했습니다" 일반 오류로 뭉개고 해당 파일을 건너뛴다.
정당 사용자가 원인 불명 부분 실패를 겪는다.
**Recommendation:** 429 를 구분해 Retry-After 기반 대기/재시도 또는 안내 문구. 한도 상향은
세션당 픽셀 총량을 고려해 신중히.
**Assigned to:** frontend-dev

### P2-004: 드래프트 photoPool URL 무프로토콜 검증 (심층방어 공백)
**Severity:** P2
**Area:** XSS 심층방어
**File:** `src/lib/editor/draft.ts:271-279(isValidPhotoPool)` → `PhotoPoolPanel.tsx:100`, `LineList.tsx:177(<img src>)`
**Issue:** localStorage 변조 드래프트의 `previewUrl/originalUrl` 이 `typeof string` 만 통과해
`<img src>` 에 그대로 들어간다. React 속성 이스케이프 + 최신 브라우저의 `javascript:` img 불활성으로
실행 XSS 는 아니고, 금전 경로는 API 경계 `httpsUrl()` + createOrder P0-03 사진 소유권 재검증으로
보호된다(잔여 위험: 임의 외부 URL 로드 = 트래킹 픽셀 수준).
**Recommendation:** `isValidPhotoPool` 에 `https://` 접두 검사 추가(cartItemSchema 의 httpsUrl 과
동일 원칙).
**Assigned to:** architect(FS-P1-00 파일) 또는 frontend-dev

### P2-005: 멀티 CTA 가 products.product_type 게이트를 참조하지 않음
**Severity:** P2 (정책 드리프트 — 보안 아님)
**Area:** 비즈니스 정책
**File:** `src/app/(shop)/product/[id]/page.tsx:198-201`, `src/app/(shop)/studio/[orderId]/page.tsx:733(mode 파싱)`
**Issue:** 034 는 `product_type('single'|'extended')` 를 "카탈로그/에디터 1차 분기축"으로 정의했지만,
`여러 장 만들기` CTA 는 모든 상품에 무조건 렌더되고 `?mode=multi` 는 어떤 상품에든 열린다.
가격은 라인별 variant 로 서버 재검증되므로 금전 위험은 없음 — 상품 정책 의도 확인 필요.
**Recommendation:** 의도된 것이면 ADR-025 에 한 줄 명시, 아니면 product_type 게이트 추가(034 미적용
DB 는 'single' 폴백이므로 graceful 유지 필요).
**Assigned to:** orchestrator 판단

## 집중 항목 답변 (파일:라인 근거)

1. **금전 경로 — 라인별 재검증 실동작 확인 (양호).** `createOrder` 는 전 라인의 variantId 를
   `.in('id', variantIds)` 로 일괄 조회 후(`src/lib/db/order.ts:77-83`) **아이템별 루프**에서
   `variantById.get(item.variantId)` 로 각 라인의 활성·가격을 검증한다(`:101-113` — 전역이 아닌
   variant 별 PRICE_MISMATCH). subtotal 도 DB 가격 × 수량으로 재계산(`:116-119`), 배송비/적립금
   재검증 후 totalPrice 산출(`:192`) — 묶음/단품 혼재는 그룹핑과 무관하게 동일 합산. 클라
   `lineVariant.price`(StudioClient.tsx:493)가 어긋나면 라인 단위로 주문 전체가 422 거부.
2. **소유권/무결성 (양호 + P1-001 예외).** `item.projectId` 는 createOrder 에서 **Map 파티션 키로만**
   사용되고(`order.ts:352-360`) 타입드 컬럼에 닿지 않는다 — 주문 경로 22P02 없음. 서버가
   `crypto.randomUUID()` 로 project_group_id 를 새로 발급, groupLabel 도 서버 생성(`묶음 N`).
   cart_projects dedup 유니크는 `(user_id, project_local_id) WHERE user_id IS NOT NULL`
   (034) — **사용자 스코프**라 타 사용자 project_local_id 충돌/탈취 불가. `/api/cart` 는 클라
   userId 를 무시하고 세션 userId 를 강제(`route.ts:73-74`). 23505 race 는 동일 user 스코프
   re-select 로 수습(`cart.ts:139-155`). 22P02 DoS 벡터는 **카트 경로에만** 존재 → P1-001.
3. **업로드 (양호).** PhotoPoolPanel 은 표현 전용, 업로드는 `uploadPhotoFile` → 기존
   `/api/photos/upload` 재사용(StudioClient.tsx:280). 서버측 sharp 매직바이트/메타 검증,
   40MP·12000px 픽셀 상한, MIME 허용목록, `checkUploadRate` 10/min 전부 그대로 적용 — 우회 없음.
   순차 업로드라 병렬 폭주도 없음. 잔여는 P2-003(정당 사용자 UX).
4. **FK/CASCADE (양호 + P2-001).** 헤더 삭제 API 는 **미노출**(cart.ts 에 delete 함수 없음,
   /api/cart 는 POST/GET, /api/cart/[localId] 는 라인 단위 PATCH/DELETE 만) — CASCADE 대량삭제는
   클라이언트에서 도달 불가. RLS 는 회원 SELECT 만 허용(034), 쓰기는 service-role 경유.
   고아 헤더 누적만 남음 → P2-001.
5. **드래프트/프리셀렉트 (양호 + P2-004).** `loadEditorDraft` 는 JSON.parse 후 구조 검증
   (`isValidStoredDraft` — version/kind/entries/photoPool 필드별 타입 확인) → v1 은 순수 함수
   `migrateEditorDraftV1` 로 승격(draft.ts:96-110). JSON.parse 의 `__proto__` 는 own property 로만
   생성되고 딥머지가 없어 프로토타입 오염 경로 없음. 복원 entries 의 photoUrl 로 타인 사진을
   가리켜도 createOrder P0-03 소유권 검증(order.ts:210-218)이 차단. basic 세션에 extended 드래프트
   복원 차단(URL 모드 우선, StudioClient.tsx:202-214)으로 가격 경로 혼선 방지.
6. **gitleaks/server-only (양호).** gitleaks(no-git) — src/lib·src/app·src/store 3스코프 **no leaks**.
   `server-only` 가드: cart.ts:8, order.ts, feature-probe.ts:16, supabase/service.ts 확인.
   probe·service-role 은 클라 번들 유입 시 빌드 실패 구조. cart/client.ts(브라우저)는 probe 를
   import 하지 않음(주석으로 계약 명시).

## Positive Findings
- 라인별 가격 재검증이 설계대로 variant 단위로 동작 — "세트 할인 없음 → 신규 가격 경로 0" 계약 준수.
- 클라 projectId 를 id 로 신뢰하지 않는 원칙(ADR-025 §5)이 주문 경로에서 코드로 지켜짐.
- 헤더 upsert → 자식 upsert FK 순서 보장, race(23505) 수습 포함.
- 마이그 미적용 graceful: probe false 시 명시 컬럼 리스트 2벌(CART_COLUMNS/WITH_PROJECT)로 42703 회피.
- 드래프트 v1 키 유지 + payload version 판별 — 기존 드래프트 무손실.

## Evidence
- `npx tsc --noEmit`: 0 errors
- `npx vitest run`: **510 passed | 14 todo** (베이스라인 451 무파손, 2 skipped 파일은 기존)
- gitleaks v(go/bin): src/lib 310KB·src/app 692KB·src/store 24KB 스캔, no leaks found
- 코드 수정·시크릿 접근·프로덕션 호출 없음 (읽기 전용 감사 + 본 보고서 작성만)
