# CONTEXT PACKAGE — FS-X 통합 웨이브 (P2 세트·어드민 + P3 묶음 시각화 + 쿠폰·1:1문의·위시리스트)
작성: orchestrator @ 2026-07-16
승인: CTO Review Gate 통과 — ①계획 승인(세트할인 createOrder 적용만 보류) ②쿠폰 추천안 확정 ③마이그 5본 적용 진행(머지 후 브라우저 세션) ④위시 로그인 전용

## 1. Goal
① **P2**: `/admin/products/[id]` 상품 워크스페이스(6탭) + set_templates 슬롯 빌더(mm 폼+WallCanvas 미니맵 프리뷰) + bundle_rules 폼 + product_type 게이트(single→extended 승격)
② **P3**: 6화면(cart/checkout/success/lookup/MyOrders/admin 상세) 묶음 시각화 + 세트 원자 선택 + 재주문 세트 복원
③ **쿠폰** ④ **1:1문의** ⑤ **위시리스트(로그인 전용)**

## 2. 환경 사실 (전 유닛 공통)
- 브랜치 `feat/p2-p3-commerce` (base main@a186121). 커밋은 orchestrator만.
- 검증: `rm -rf .next/types && npx tsc --noEmit` · `npx eslint <경로> --max-warnings=0` · `npx vitest run`(베이스라인 **535 passed | 14 todo**) · `npx next build`
- 마이그 029~039 **프로덕션 적용 완료**(probe 전부 true). 신규 036/037/040/041/042는 이번 웨이브 작성 → 머지·배포 후 적용 예정. **배포~적용 사이 창을 위해 신규 기능도 probe 게이트 유지**(ADR-024 패턴).
- 의존성 추가 시 pnpm-lock.yaml 동시 갱신(`pnpm install --lockfile-only`) — 이중 lockfile 함정.
- TS strict·any 금지·select('*') 금지(상품 예외 기존 유지)·server-only 가드·Next16 set-state-in-effect 금지. FROZEN 타입은 옵셔널 추가만.
- Konva는 src/modules/ + dynamic ssr:false(ADR-015).

## 3. 확정 설계 (정찰+승인 근거 — 변경은 orchestrator 승인)

### 마이그레이션 (전부 비파괴·멱등, 미적용 graceful 주석 필수 — 034/038 스타일)
| # | 파일 | 내용 |
|---|---|---|
| 036 | set_templates | spec §4: `id, product_id FK, name, slots jsonb([{slotIndex,sizeCode,orientation,slotPos{xMm,yMm,wMm,hMm}}]), wall_w_mm, wall_h_mm, set_price int NULL, set_discount_bps int NULL, is_active, created_at`. RLS: 공개 SELECT(is_active — 카탈로그 노출용), 쓰기 service-role. + `cart_projects.set_template_id` FK 추가(034에서 FK 없이 둔 컬럼) |
| 037 | bundle_rules | spec §4: `id, product_id FK UNIQUE(1:1), min_slots, max_slots, allowed_size_codes text[], allowed_orientations text[], allow_size_mix bool, allow_orientation_mix bool, allow_photo_reuse bool, pricing_strategy CHECK('sum','sum_with_discount','flat'), discount_bps int NULL, flat_price int NULL, is_active`. RLS: 공개 SELECT, 쓰기 service-role |
| 040 | inquiries | 정찰안: `id, user_id uuid NULL→auth.users ON DELETE SET NULL, order_id NULL, product_id NULL, contact_email text NOT NULL, category text NULL, subject text NOT NULL, body text NOT NULL, status CHECK('OPEN','ANSWERED','CLOSED') DEFAULT 'OPEN', admin_reply text NULL, answered_at timestamptz NULL, created_at`. 인덱스 (user_id,created_at DESC),(status). RLS: owner-select + own-insert(user_id=auth.uid()), 답변·전체목록은 service-role. 문의는 전부 비공개(공개 정책 없음) |
| 041 | wishlists | `id, user_id NOT NULL→auth.users CASCADE, product_id NOT NULL→products CASCADE, created_at, UNIQUE(user_id,product_id)`. RLS: 032 스타일 owner FOR ALL |
| 042 | coupons | `coupons(id, code text UNIQUE NOT NULL(대문자 정규화), type CHECK('fixed','percent'), value int(fixed=원, percent=bps), min_subtotal int DEFAULT 0, expires_at timestamptz NULL, usage_limit int NULL, used_count int DEFAULT 0, is_active bool DEFAULT true, created_at)` + `coupon_redemptions(id, coupon_id FK, user_id FK, order_id NULL, created_at, UNIQUE(coupon_id,user_id))`(회원 1인1회) + `orders.coupon_code text NULL, orders.coupon_discount int NOT NULL DEFAULT 0`(스냅샷). RLS: coupons SELECT는 service-role만(코드 열거 방지 — 검증은 서버 API), redemptions owner-select |

### 쿠폰 정책 (CTO 확정 — ADR-026로 명문화)
- 정액(fixed, 원)/정률(percent, bps — subtotal 기준, 상한 payable) 2종 · min_subtotal · expires_at · 전체 usage_limit(**조건부 UPDATE 원자 차감**: `SET used_count=used_count+1 WHERE id=? AND is_active AND (usage_limit IS NULL OR used_count<usage_limit)` → 0행이면 소진 거부) · **회원 1인 1회**(coupon_redemptions UNIQUE — 비회원은 미기록, 전체 한도만 적용) · 비회원도 코드 입력 가능.
- **할인 순서: subtotal + shipping + surcharge − 쿠폰할인 − 적립금 = totalPrice(net 저장, 031 계약 유지 — confirm.ts 무변경)**. 쿠폰할인은 subtotal 기준 계산, 상한 = payable(음수 방지). redeem 상한(maxRedeemable)은 쿠폰 적용 후 payable 기준으로 재계산.
- createOrder 체인 위치: variant 검증→subtotal→surcharge→fee-mismatch→**쿠폰 검증·원자 사용·할인 확정**→redeem 검증(쿠폰 반영 payable 기준)→redeem RPC→receipt→INSERT(coupon_code/coupon_discount conditional-spread). 실패 보상: 주문 INSERT 실패 시 used_count 원복(-1) + redemptions 행 삭제 + redeem 환급(기존) — redeem 보상 패턴 미러.
- 에러코드: `COUPON_INVALID`(부재/비활성/만료/최소금액 미달), `COUPON_EXHAUSTED`(한도 소진), `COUPON_ALREADY_USED`(회원 재사용) — 422 매핑.

### 세트할인 보류 (CTO 확정)
bundle_rules **폼·저장·타입까지만** 이번에 구현. createOrder의 세트가 재계산·할인 적용은 세트 SKU/갤러리월 출시 시 후속(ADR-021 정합 경로는 그때 활성화). 현행 라인별 가격 검증이 계속 유효.

### P3 그룹핑 (정찰 확정)
- **그룹 키 SSOT**: 카트 = `CartItem.projectId`(null=단품). 주문 = `snapshot.groupLabel`(035 무관 durable — mapOrderItem이 컬럼 미노출하므로 groupLabel이 유일 키).
- 뷰모델(foundation 산출, 순수): `groupCartByProject(items) → {groups:[{key, lines, subtotal}], singles}` / `groupOrderByGroupId(items) → 동형(키=groupLabel)`. 깨진 키는 단품 폴백.
- 세트 원자 선택(ADR-021): cart 선택 `Set<localId>` 유지하되 그룹 헤더 토글 = 그룹 전 라인 일괄 add/remove, 그룹 내 개별 해제 금지(부분선택 불가 — 라인 체크박스 비활성+안내), 단품은 개별 유지.
- 세트 단위 취소: 현행 customerCancelOrder(주문 전체)는 유지 — P3 표시에서 "세트는 주문 단위로만 취소" 안내. 세트만 부분취소는 미구현(ADR-021 원자 원칙 안에서 주문 전체 취소가 유일 경로 — 문서화).
- **reorder 세트 복원 버그 수정**: api/cart/reorder가 project 필드 드롭 중(route.ts:100-111) → snapshot.groupLabel 기준 그룹을 새 projectLocalId(uuid)로 복원 + projectSeq/orientation 전달.
- success 화면: 항목 미표시 현행 → 그룹 요약 1줄(선택). lookup: route가 snapshot 벗겨 groupLabel 미반환 → projection에 groupLabel/orientation 추가 + 클라 그룹 렌더.

### admin 워크스페이스 (정찰 확정)
- `/admin/products/[id]` 신설(목록은 유지, 행 "수정"→[id] 링크 전환). 탭: 0 유형(product_type 게이트 — productFormSchema/ProductFormInput/upsertProduct row에 product_type 추가, 승격 토글) · 1 속성(기존 Dialog 폼 인라인화) · 2 프레임(FramesClient 임베드 — selectedProductId 고정, dropdown/router.push 제거 prop) · 3 옵션(OptionsClient 동일) · 4 구성규칙(bundle_rules 폼, extended만) · 5 세트템플릿(slots 행 목록+mm 4필드 폼(FramesClient inner_rect 패턴)+WallCanvas 읽기전용 미니맵(dynamic ssr:false), extended만).
- categories 흡수 = 속성 탭의 categoryId Select만(전역 카테고리 CRUD는 기존 페이지 유지).
- 신규 DB/액션: admin.ts에 listSetTemplates/upsertSetTemplate/deleteSetTemplate/getBundleRule/upsertBundleRule + upsertProduct product_type(upsertFrameAsset onConflict 패턴). 서버액션은 src/app/admin/products/[id]/actions.ts 신규 파일.

### 문의·위시 (정찰 확정 — addresses 4레이어 패턴 복제)
- lib/db/inquiries.ts·wishlists.ts(service-role+코드레벨 user_id 스코핑+DbResult 튜플+mapRow) · /api/account/inquiries·wishlist({ok} 봉투+isSameOrigin+checkRate+zod) · account 페이지(points 선례: force-dynamic+로그인 redirect+probe 게이트+Client 낙관 업데이트) · admin/inquiries(reviews 선례+답변 textarea) · notifyInquiryReplied(contact_email 사용, fire-and-forget) 신규.
- 하트: ProductCard가 단일 Link라 **버튼 중첩 금지** → `wishlistSlot?: ReactNode` prop + absolute overlay. 상세는 ISR(revalidate 300)이라 **하트 상태는 클라 마운트 후 fetch 하이드레이션**('use client' 아일랜드).
- account NAV(layout NAV_ITEMS)에 문의/위시 추가 · adminNav에 inquiries·coupons 추가(inBottomNav 미포함 — 5개 만석).

## 4. 유닛별 In-scope (그 외 수정 금지 — 특히 서로의 영역)
| 유닛 | 담당 | In-scope |
|---|---|---|
| X-00 | architect | supabase/migrations/036·037·040·041·042, src/types/{set,inquiry,wishlist,coupon}.ts(신규)+common.ts 브랜드, src/lib/db/feature-probe.ts(wrapper 5종), src/lib/cart/grouping.ts+src/lib/order/grouping.ts(뷰모델 순수), src/lib/coupon/calc.ts(순수 계산), shared/DECISIONS.md(ADR-026), tests/** |
| X-01 | backend-dev | src/lib/db/coupons.ts(신규), src/lib/db/order.ts(createOrder 쿠폰 통합), src/app/api/coupons/**(validate 라우트 신규), tests/** |
| X-02 | backend-dev | src/lib/db/{inquiries,wishlists}.ts(신규), src/app/api/account/{inquiries,wishlist}/**(신규), src/app/admin/inquiries/actions.ts(신규), src/lib/notify/index.ts(notifyInquiryReplied 추가만), tests/** |
| X-03 | frontend-dev | src/app/admin/products/**([id] 신규+목록 링크 전환), src/lib/db/admin.ts(set/rule CRUD+product_type), src/types/admin.ts(productType 추가), src/modules/wall/**(읽기전용 어댑터 필요 시), tests/** |
| X-04 | frontend-dev | src/app/(shop)/cart/**, src/app/(shop)/checkout/**(쿠폰 입력 카드+그룹 요약), src/app/(shop)/order/**(success·lookup route+client), tests/** |
| X-05 | frontend-dev | src/app/(shop)/account/orders/**, src/app/api/cart/reorder/**(세트 복원), src/app/admin/orders/[id]/**(그룹 트리), src/app/admin/coupons/**(신규 CRUD UI+actions), src/app/admin/inquiries/{page,Client}(UI만 — actions는 X-02 산출 소비), src/lib/admin/adminNav.ts, tests/** |
| X-06 | frontend-dev | src/components/wishlist/**(하트 아일랜드 신규), src/components/ProductCard.tsx(slot prop), src/app/(shop)/product/[id]/page.tsx(하트·문의 진입 배치), src/app/(shop)/account/{wishlist,inquiries}/**(신규), src/app/(shop)/account/layout.tsx(NAV), src/messages/*.json, tests/** |

배치: X-00 직렬 → 배치1(X-01∥X-02∥X-03) → 배치2(X-04∥X-05∥X-06) → 리뷰(Security∥Final)→수정→docs→배포→마이그 적용.

## 5. Done Criteria (전 유닛 공통)
- tsc 0 · eslint(수정 경로, --max-warnings=0) 0 · vitest 전체 green(535 무파손) · (UI) next build 통과
- 신규 테스트 ≥ 유닛별 명시치. 금전 경로(X-01)는 보상·원자성·경계 필수.
- probe 게이트: 신규 스키마 의존 기능은 미적용 시 UI 비노출/명시 에러(42703 노출 금지).
- diff In-scope 내 · 커밋 금지 · 마지막 응답 = 핸드오프 페이로드 JSON.
