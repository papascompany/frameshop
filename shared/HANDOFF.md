# Inter-Agent Handoff Notes

> 에이전트 간 인계 사항. 다음 에이전트가 무엇부터 해야 하는지 명확하게 적습니다.

## Format
```
### [YYYY-MM-DD HH:mm] <from-agent> → <to-agent>
**컨텍스트:** 무엇이 끝났는지
**다음 액션:** 받는 쪽이 해야 할 일
**참고 파일:** 관련 파일 경로
**주의사항:** 함정/엣지케이스
```

---

## Active Handoffs

### [2026-05-12] planner → architect
**컨텍스트:** 모든 10개 모듈 spec 완료 (catalog + 9). docs/specs/*.md 참조.
**다음 액션:**
  1. PLAN.md §6 스키마 + 부록 A 타입을 src/types/*.ts 및 supabase/migrations/*.sql로 동결
  2. 각 모듈 spec의 Interface 섹션을 TypeScript 타입으로 변환
  3. shared/INTERFACES/types-frozen.md 와 api-contract.md 생성
**주의사항:**
  - Editor 모듈의 CropTransform / EditorState는 store 타입과 연결
  - Order 상태 머신은 union 타입 + transition map (`Record<OrderStatus, OrderStatus[]>`)
  - Product 타입에 thumbnail은 join 결과(products 테이블 컬럼 아님) — 별도 ProductListItem 타입 고려
  - Cart 모듈의 `localId` 필드는 LocalStorage/DB dedup key — `cart_items` 테이블에 컬럼 추가 검토
  - Payment 모듈에서 제안한 `payment_events` 테이블 (paymentKey UNIQUE) 신설 여부 결정
  - Photo 모듈에서 비회원 사진 격리(Storage path prefix `photos/anon/<sessionId>`) — `photos` 테이블 sessionId 컬럼 추가 검토
  - Curation payload는 jsonb이며 타입별 Zod 스키마 분기(BannerPayload/CollectionPayload/FeaturePayload)
  - Konva는 반드시 `dynamic({ssr:false})` 패턴 — 타입은 클라이언트 전용으로 분리
  - `'server-only'` import 강제 모듈: M-Order.transitionTo, M-Payment 서버 함수, 토스 시크릿 키
  - 각 spec의 "자율 결정" 표기(Edge Cases/Out of Scope)를 Architect가 검토 후 ADR 추가 여부 판단
  - **ADR-008 배송 정책:** `shipping_methods` 테이블 또는 `shipping_settings` 단일 row 선택, `orders.shipping_method` 컬럼 추가, `calculateShippingFee` 순수 함수 위치 결정 (M-Checkout vs M-Order). `ShippingMethod` union(`'STANDARD'|'PICKUP'|'QUICK'`) + `ShippingMethodConfig` 타입 동결.
**참고 파일:** docs/specs/*.md, docs/PLAN.md §6 + 부록 A, shared/DECISIONS.md

### [2026-05-12] architect → designer + backend-dev + tester (병렬 Phase 3)
**컨텍스트:** 모든 타입 동결 완료. `npm run typecheck` 통과.

**산출물 위치:**
  - `src/types/*.ts` (11개 파일 + index.ts 배럴)
  - `supabase/migrations/001~012.sql` (12개 파일, RLS 포함)
  - `shared/INTERFACES/types-frozen.md` (타입 카탈로그)
  - `shared/INTERFACES/api-contract.md` (Backend ↔ Frontend 계약)
  - `shared/DECISIONS.md`에 ADR-009~015 추가 (Architect 자율 결정)

**다음 액션:**
  - **Designer:** `shared/INTERFACES/types-frozen.md`와 `docs/PLAN.md` §11.4 (디자이너 시스템 프롬프트) 참조. Pretendard 폰트, dark header #2A2A2A, white body, red accent #E74C3C, 모바일 우선. `src/components/ui/*` (shadcn 패턴 — 단 Next.js 16 + React 19 호환 확인) + `src/components/layout/*` 작성. Tailwind v4 사용 (이미 설치됨, postcss.config.mjs는 `@tailwindcss/postcss`로 설정됨 → CSS variables 토큰 패턴).
  - **Backend Dev:** `shared/INTERFACES/api-contract.md` 모듈별 server functions를 그대로 구현. `src/lib/supabase/{server,client,service}.ts` 3분리, `src/lib/db/{catalog,product,photo,cart,order,admin,shipping,curation}.ts` 모듈별 query, `app/api/{photos/upload,payment/confirm,webhook/payment,cart,...}/route.ts` Route Handlers, `src/lib/payment/toss.ts` (`'server-only'`), `src/lib/shipping/calc.ts` (순수 함수 `calculateShippingFee`). 모든 입력 Zod 검증.
  - **Tester:** Vitest 설정 (jsdom + Testing Library) + Playwright 설정 + MSW(Supabase REST + Toss API 모킹). UT-01~08 + `calculateShippingFee` UT, IT-01~06 스켈레톤, E2E-01~06 + ADR-008 시나리오. 전부 TDD Red 상태(컴파일은 OK, 실행은 실패).

**병렬 안전성 (디스조인트 디렉토리):**
  - Designer: `src/components/ui/`, `src/components/layout/`, `tailwind.config.ts`, `src/app/globals.css`
  - Backend: `src/lib/`, `app/api/`, `src/store/` (cart/editor의 사용자 측 store 헬퍼는 backend 영역 X — frontend 단계로 미룸. 단, 순수 cart 함수 `serializeCartItem`은 lib에 둠.)
  - Tester: `tests/`, `vitest.config.ts`, `playwright.config.ts`, `tests/mocks/`

**주의사항 (Architect → 모두):**
  - `'server-only'` 강제 모듈: `src/lib/db/order.ts` (transitionTo), `src/lib/payment/toss.ts`, webhook 핸들러, `src/lib/supabase/service.ts`
  - 익명(`user_id=NULL`) INSERT 대상: `photos`, `orders` — service-role 라우트 통해서만. RLS가 anon insert 차단.
  - 결제 금액 검증: `confirmPayment`에서 `orders.total_price === amount` 매칭 후에만 토스 confirm API 호출.
  - `calculateShippingFee`는 클라이언트도 호출 가능 (UI 즉시 계산용)하지만, `createOrder`는 서버 측 재계산 결과를 권위로 삼는다.
  - Toss SDK는 `@tosspayments/payment-sdk` (이미 설치). v2/v1 confirm API URL: `https://api.tosspayments.com/v1/payments/confirm` (Basic Auth로 `TOSS_SECRET_KEY:`).
  - `.env.local`은 빈 상태 — backend는 코드만 작성하고 실제 DB는 호출 안 함. 테스트는 MSW로 모킹.

**검증 기준:**
  - Designer: 모바일 375px / PC 1280px 양쪽에서 컴포넌트 시각 점검 (Playwright story 없으면 `app/(dev)/preview` 임시 페이지 OK), `npm run build` 통과
  - Backend: `npm run typecheck` + `npm run build` 통과. 모든 함수 시그니처가 `api-contract.md`와 일치
  - Tester: `npm run test` 실행 시 의도된 실패만 (컴파일 에러 0). MSW 핸들러로 backend 부재 상태에서도 통합 테스트 가능해야 함

**참고 파일:**
  - 동결 타입: `src/types/*` (배럴: `import { … } from '@/types'`)
  - API 계약: `shared/INTERFACES/api-contract.md`
  - 마이그레이션: `supabase/migrations/*.sql`
  - 결정: `shared/DECISIONS.md` ADR-008~015
  - 모듈 spec: `docs/specs/*.md`

## Completed Handoffs

### [2026-05-12] planner → architect — DONE
**컨텍스트:** 모든 10개 모듈 spec 완료 (catalog + 9).
**결과:** Architect가 타입/스키마/INTERFACES 동결 완료. typecheck 통과.

### [2026-05-12] planner → planner (다음 모듈) — DONE
**컨텍스트:** catalog.md 완료 → 9개 모듈 순차 진행 완료.
**결과:** product/photo/editor/cart/checkout/payment/order/admin/landing 모두 작성됨.

---

### [2026-07-03] EC 웨이브(orchestrator) → 다음 세션 — 이커머스 기본 완성 웨이브 핸드오프

**브랜치:** `feat/ecommerce-basics-photowall` (base: main@e108550). 이 요약만 읽고 이어받을 수 있게 작성.

**컨텍스트(완료 — 구현 7단위, FS-EC-00~06):**
1. **FS-EC-00 Foundation** — 마이그 038(refunded_amount)/039(cash_receipt) + 타입 계약(order/checkout/
   shipping 옵셔널 + points.ts 신규) + `src/lib/db/feature-probe.ts`(server-only, TTL 60초) +
   `src/lib/shipping/surcharge.ts` 순수모듈.
2. **FS-EC-01 체크아웃 FE** — 필수 동의 2종 + 적립금 사용 + 현금영수증 신청 + 추가배송비 표시,
   `/account/points` 페이지 + `/api/account/points`.
3. **FS-EC-02 주문 서버 코어** — `createOrder`: redeem fail-closed + 보상 트랜잭션 · surcharge 서버
   재계산 · receipt 저장 · conditional-spread INSERT. `confirmPurchase`: 1% earn 멱등.
4. **FS-EC-03 관리자 주문/결제** — 부분환불(Toss cancelAmount + refunded_amount 누적 + 낙관 잠금),
   현금영수증 Toss 발급 훅(현금성 결제만), 주문 ZIP(jszip).
5. **FS-EC-04 포토월** — `/wall`: mm 실측 Konva 벽 시뮬레이터 + 스튜디오 딥링크 프리셀렉트 +
   localStorage v1.
6. **FS-EC-05 법적고지/SEO** — `/terms` `/privacy` + `src/lib/legal/company.ts` SSOT + 404 + JSON-LD 테스트.
7. **FS-EC-06 관리자 통계** — admin 통계 대시보드 + artworks 썸네일 sharp.

**정책/패턴(ADR-024, CTO 승인):** 재고 차감 제외(주문제작) · 포토월=스튜디오 딥링크 · 적립 1%
(`POINTS_EARN_RATE_BPS=100`) + redeem 후 최소 결제 100원 · **적립 회수=전액 환불·취소 시 자동**
(리뷰 후속 격상, ADR-024 Postscript — 부분환불(누적<전액)은 무조정) ·
부분환불 누적==total 시 REFUNDED 전이(IN_PRODUCTION/SHIPPED 등 전이 불가 상태면 유지+경고 로그) ·
현금영수증 income=소득공제/proof=지출증빙, 현금성 결제만 · **graceful feature-probe + conditional-spread**
(029~039 전부 미적용에서도 앱 정상, 적용 시 자동 활성화).

**적대 리뷰(Security+Final) verdict: NO-GO(P0 1건) → 수정 랜딩 완료** — `shared/audit/FS-EC-security.md`
·`FS-EC-final.md`. 수정 5+1건:
1. **(P0)** `/api/orders` route 가 `redeemPoints`/`receipt` 를 `createOrder` 로 미전달하던 브리지 공백 →
   필드 전달 + `POINTS_*`/`RECEIPT_*` 에러 422 매핑 + 라우트 seam 통합 테스트 신설.
2. 딥링크 진입 시 기존 편집 드래프트 보존(ADR-022 정합, persist 억제).
3. `receipt_info` PII 서버측 마스킹(admin + account).
4. 주문 ZIP fetch Supabase origin 제한.
5. 현금영수증 식별번호 최소 숫자 8자리.
+1. **(정책 격상)** 적립 회수 자동화 — 전액 환불·취소 시 `reversePointsForOrder`(사용분 복원
   ADJUSTMENT+ / 적립분 회수 REFUND−, `(order_id,type)` 멱등, fire-and-forget, 031 미적용 skip).

**검증(최종, 리뷰 수정 반영):** `vitest` 451 passed | 14 todo (2026-07-03 직접 실행 확인, 관리자취소 회수 +4 포함; 구현 시점
413 → 리뷰 수정으로 +34). 구현 시점: `tsc` 0 · `eslint src tests --max-warnings=0` 0 · `next build` exit 0.
로컬 QA: `/terms` `/privacy` 404 콘텐츠 서버 HTML 확증, `/wall` graceful 빈 상태(로컬 env 없음).
**데이터 화면은 배포 후 프로덕션 스모크 예정.**

**다음 액션(CTO):**
1. **마이그레이션 적용** — `docs/MIGRATIONS-APPLY.md` 기준 029~033 + 038/039(권장) + 034/035(P1 직전).
   적용 시 적립금/추가배송비/부분환불/현금영수증이 코드 배포 없이 자동 활성화(probe TTL 60초).
2. **Toss 실키 설정** — 프로덕션 클라키가 `test_ck_placeholder` 라 결제 완주 불가(BACKLOG §6, 런칭 전 과제).
3. **법률 자문** — `/terms` `/privacy` 는 초안(`LEGAL_DRAFT_NOTICE` 게시 중). 시행일 확정 필요.
4. **사업자 placeholder 7건 확정** — `src/lib/legal/company.ts` 에서만 갱신(SSOT): ①통신판매업신고번호
   (FrameShop 명의 여부) ②고객문의 이메일 ③호스팅 사업자 표기(현재 'AWS' — 실제 Vercel/Supabase)
   ④배송사(택배사) 상호 ⑤Vercel 국외 이전 고지 ⑥Supabase 국외 이전 고지 ⑦시행일(`LEGAL_EFFECTIVE_DATE`).

**다음 액션(개발, 후보):** Merge Gate → PR/배포 → 프로덕션 스모크(데이터 화면). 이후 후보 =
쿠폰/1:1문의/위시리스트(CTO 결정으로 다음 세션), 부분환불 적립 비례 조정(정책 미정 — CTO 결정 필요),
REDEMPTION 원장 order_id 사후 링크, 전액환불 통계 규칙 보완, SMS/알림톡, 회원정보 관리,
배송 추적 API(이상 BACKLOG §5), 확장형 P1 편집기(BACKLOG §1A).

**참고 파일:** `shared/context/FS-EC-00~06.md`(컨텍스트 패키지) · `shared/DECISIONS.md` ADR-024(+Postscript) ·
`shared/audit/FS-EC-security.md`·`FS-EC-final.md`(적대 리뷰) · `docs/MIGRATIONS-APPLY.md` ·
`docs/BACKLOG.md` · `shared/STATUS.md`(EC 웨이브 섹션).

**주의사항:** 마이그레이션 미적용 상태에서 orders INSERT 에 신규 컬럼을 무조건 넣으면 42703 —
반드시 feature-probe + conditional-spread 패턴 유지(ADR-024). FROZEN 타입은 옵셔널 추가만.
카트/상품 SELECT 명시 컬럼 목록에 미적용 컬럼 추가 금지(ADR-023).

---

### [2026-07-06] 확장형 P1 편집기 웨이브(orchestrator) → 다음 세션 — P1 핸드오프

**브랜치:** `feat/extended-p1-editor` (base: main@2e9a738). 이 요약만 읽고 이어받을 수 있게 작성.

**컨텍스트(완료 — 구현 4유닛, FS-P1-00~03):**
1. **FS-P1-00 기반(architect)** — ADR-025(FROZEN 옵셔널 계약 게이트) · `EditorPhotoEntry` 옵셔널
   (`selectedOptions?`/`orientation?`) · 드래프트 v2 무손실 승격(v1 자동 승격, 손실 0) ·
   `OrderItemSnapshot` orientation/projectSeq/groupLabel · `isProjectCartAvailable` probe.
2. **FS-P1-01 스토어** — `kind:'basic'|'extended'` 분기(basic=현행 코드 문자 그대로, entries 초기화 유지) ·
   `photoPool` · 라인 액션 5종 · 라인별 totals `sum(price_i×qty_i)` · `suggestOrientation`(best-fit).
3. **FS-P1-02 서버** — `createOrder` 그룹 동결(variant_snapshot jsonb — 035 미적용에서도 보존 +
   035 적용 시 probe conditional-spread 로 컬럼 동결) · `cart_projects` 헤더 upsert(dedup+race) ·
   로그인 카트 sync probe 폴백.
4. **FS-P1-03 UI** — `mode=multi`(PhotoPoolPanel/LineList/MultiCheckoutControls) · 묶음 담기 ·
   드래프트 v2 연동 · 상품상세 "여러 장 만들기" CTA · 모바일 · i18n 24키.

**커버리지:** CTO 케이스 1~4 전부(같은 사진 다른 사이즈 / 사진별 상이 사이즈·방향 / 같은 사이즈 N장 /
혼합 방향). **베이직(단품) 경로 회귀 0** — 베이직 회귀 고정 테스트 다수.

**graceful(ADR-023/024 패턴 계승):** 익명은 034/035 무관 완전 동작(localStorage). 로그인 카트 동기화만
probe 폴백 — 미적용 시 평면 저장(묶음 정보는 주문 스냅샷 jsonb 에 보존). **034/035 적용 시 로그인 묶음
동기화가 코드 배포 없이 자동 활성화**(probe TTL 60초).

**검증:** tsc 0 · eslint 0 · next build exit 0 · **vitest 510 passed | 14 todo**(베이스라인 451 → +59).

**다음 액션(CTO):**
1. **마이그레이션 034/035 적용 — 권장으로 격상**(기존 "선택/P1 직전" → P1 라이브로 적용 권장).
   적용 시 로그인 묶음 카트 동기화 자동 활성화. 가이드 = `docs/MIGRATIONS-APPLY.md`(앱 검증 절 포함).
   미적용분 029~033 + 038/039 도 함께 적용 권장.
2. Merge Gate → PR/배포 → 프로덕션 스모크(`mode=multi` 편집기 · 묶음 담기 → 주문 스냅샷 확인).
3. (지속) Toss 실키 설정 — 결제 완주 불가(BACKLOG §6, 런칭 전 과제).

**다음 액션(개발, 후보):**
- **P2 세트·어드민 워크스페이스**(036/037 — set_templates 슬롯 빌더 · bundle_rules 폼 ·
  `/admin/products/[id]` 워크스페이스) → **P3 주문 6화면 묶음 시각화**(그룹핑 뷰모델·카드 UI).
- 잔여 P2 후보: 재크롭 배지 베이스라인 드래프트 영속화 · extended 에서 명화/Google Photos 소스 ·
  StudioClient 본문 i18n · 갤러리월(036/037) · 카트/주문 6화면 묶음 시각화(P3) · 서버 드래프트(교차기기).

**참고 파일:** `shared/context/FS-P1-wave.md`(컨텍스트 패키지) · `shared/DECISIONS.md` ADR-025 ·
`docs/specs/extended-product.md` §8(롤아웃) · `docs/MIGRATIONS-APPLY.md` · `docs/BACKLOG.md` §1A ·
`shared/STATUS.md`(P1 웨이브 섹션).

**주의사항:** FROZEN 타입은 옵셔널 추가만(ADR-025 게이트). 카트/상품 SELECT 명시 컬럼에 미적용 컬럼
추가 금지 — project 컬럼은 probe true 일 때만 conditional-spread(ADR-023/024). `kind:'basic'` 의
`setSize`/`setOrientation` entries 초기화는 의도된 현행 동작 — 제거 금지(베이직 회귀 테스트가 고정).
variantId 는 저장하지 않고 `variantsByKey[variantKey(selectedOptions)]` 로 파생(이중 진실 방지).
