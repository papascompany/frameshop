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
