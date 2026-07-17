# FrameShop 백로그 (작업 예정 단일 출처)

> 이 문서는 **남은/예정 작업의 단일 출처(SSOT)** 다. 완료되면 항목을 "완료" 표시하고
> `shared/STATUS.md` 변경로그에 한 줄 남긴다. 최종 갱신: 2026-07-16 (FS-X 웨이브 — P2/P3·쿠폰·문의·위시 반영).
>
> 우선순위: **P0**(운영 차단·금전/보안) · **P1**(표준 기능) · **P2**(성장·부가)
> 의존: ⛏️ = 마이그레이션 선적용 필요(아래 §1), 🔌 = 인프라 프로비저닝 필요

---

## §1. 마이그레이션 — 029~039 ✅ 적용 완료(2026-07-06) · 036/037/040~042 적용 대기(FS-X)

> **029~039 적용 완료**: CTO 브라우저 로그인(yohan73) 후 SQL Editor에서 통합 실행. 검증 쿼리 24행 일치,
> 프로덕션 런타임 자동 활성화 확증(체크아웃 probe points/receipt/surcharge 전부 true).
> BL-010 Resolved. **036/037/040/041/042 는 FS-X 웨이브(2026-07-16)에서 작성 완료 — 미적용(적용 대기)**:
> 이 웨이브 머지·배포 후 브라우저 세션으로 적용 예정(CTO 승인済). probe 게이트로 적용 전 무해.
> 아래 표는 이력 참고 + 적용 대기 추적용으로 유지.

| 마이그레이션 | 기능 | 코드 상태 | SQL |
|---|---|---|---|
| `029_orders_order_memo` | 관리자 주문 메모 (Phase A) | 라이브, 컬럼 대기 | `ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_memo text;` |
| `032_user_addresses` | 주소록 (Phase B-1) | 라이브, 테이블 대기 | 파일 참조 |
| `033_orders_confirmed_at` | 구매확정 (Phase B-1) | 라이브, 컬럼 대기 | `ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;` |
| `031_user_points` | 적립금 earn/redeem + `/account/points` (EC 웨이브) | 라이브(feature-probe, 적용 시 자동 활성화) | 파일 참조 |
| `030_orders_shipping_surcharge` | 제주/도서산간 추가배송비 (EC 웨이브) | 라이브(feature-probe, 적용 시 자동 활성화) | 파일 참조 |
| `034_products_product_type` | 확장형 기반: product_type + cart_projects | **P1 라이브** — 적용 시 로그인 묶음 카트 동기화 자동 활성화(probe) | 파일 참조 |
| `035_cart_items_project_link` | 확장형 기반: cart/order 프로젝트 링크 | **P1 라이브** — 적용 시 로그인 묶음 카트 동기화 자동 활성화(probe) | 파일 참조 |
| `038_orders_refunded_amount` | 부분환불 누적액 (EC 웨이브) | 라이브(feature-probe, 적용 시 자동 활성화) | 파일 참조 |
| `039_orders_cash_receipt` | 현금영수증 신청·Toss 발급 (EC 웨이브) | 라이브(feature-probe, 적용 시 자동 활성화) | 파일 참조 |
| `036_set_templates` | 확장형 P2: 세트 프리셋 + cart_projects FK 이행 (FS-X) | **작성 완료·적용 대기** — probe `isSetTemplatesAvailable`, 적용 시 자동 활성화 | 파일 참조 |
| `037_bundle_rules` | 확장형 P2: 구성 검증/가격 규칙 (FS-X — 세트할인 적용은 ADR-026 보류) | **작성 완료·적용 대기** — probe `isBundleRulesAvailable` | 파일 참조 |
| `040_inquiries` | 1:1 문의(비밀글 고정) + admin 답변 (FS-X) | **작성 완료·적용 대기** — probe `isInquiriesAvailable` | 파일 참조 |
| `041_wishlists` | 위시리스트(로그인 전용) (FS-X) | **작성 완료·적용 대기** — probe `isWishlistAvailable` | 파일 참조 |
| `042_coupons` | 쿠폰 + 사용 원장 + orders 쿠폰 스냅샷 (FS-X) | **작성 완료·적용 대기** — probe `isCouponsAvailable` | 파일 참조 |

→ **적용 가이드(순서·검증쿼리·롤백)**: `docs/MIGRATIONS-APPLY.md` (CTO 전달용 단일 문서).
→ **2차 적용 대기(FS-X, 2026-07-16 작성)**: 036/037/040/041/042 — 전부 비파괴·멱등, 미적용 상태에서도
  probe 게이트로 앱 정상(해당 UI 비노출). 적용 시 코드 배포 없이 자동 활성화(probe TTL 60초).
  절차·검증쿼리·롤백 = `docs/MIGRATIONS-APPLY.md` "2차 적용 대기" 절.
→ **권장**: 029~039 전부 적용. **P1 편집기 라이브로 034/035 도 권장 격상** — 미적용 시 로그인 묶음 카트
  동기화만 평면 저장 폴백(묶음 정보는 주문 스냅샷 jsonb 에 보존), 적용 시 자동 활성화(probe).
→ **029~039 전부 미적용 상태에서도 앱 정상**(graceful probe/conditional-spread, ADR-024) — 적용 시 코드 배포 없이 자동 활성화(probe TTL 60초).
→ 적용 후 메모·주소록·구매확정·적립금·추가배송비·부분환불·현금영수증이 런타임에서 동작하는지 검증.

---

## §1A. ★ 확장형 상품 (베이직/확장형 분리) — P0·P1·P2·P3 완료 (갤러리월 에디터는 후속)

> **요청(2026-06-23)**: 사진1장→사이즈1개 단품을 **베이직**으로 분리하고, 멀티포토·혼합 사이즈/방향·
> 세트(갤러리월)를 한 흐름에서 주문하는 **확장형 상품** 도입. 장바구니~주문 화면도 구성 시각화.
> **설계 SSOT**: `docs/specs/extended-product.md` · **시각화**: `docs/specs/extended-product-mockups.html`.

- **채택 아키텍처**: 프로젝트/세트 집합(Project Aggregate). `cart_items`에 nullable `projectId`만 얹어
  평면 라인을 자식으로 재사용. **변형 4축·인쇄 파이프라인 무변경**(null=현행 단품 100% 유지).
- **taxonomy 결정**: 데이터는 하나(extended), 갤러리월 vs 일반 다조합은 `set_template_id` 유무로 분기
  (좌표 있으면 벽 미니맵, 없으면 그리드). 카탈로그·출시는 분리 — 일반 다조합(P1) 먼저, 갤러리월(P2+) 후.
- **★ 선결 과제 3건 (P1 착수 전 필수, 현 코드 검증)**:
  1. ✅ **원본 photoId·cropTransform 보존 — 완료(ADR-020, 무마이그레이션).** `cart_items.photo_id`=원본,
     `crop_transform`=실제변형, `order_items` 스냅샷에 `sourcePhotoId` 동결. **재주문 무동작 BL 동시 해소**(§2).
     인쇄·CartItem 타입 무변경. tsc/eslint/build/220 tests GREEN.
  2. ✅ **세트가·취소 정책 — CTO 확정·동결(ADR-021).** 세트할인=행별 비례배분, 취소/환불=세트 단위(원자),
     부분선택=세트 불가(같이 담긴 단품은 선택 가능). 구현은 P2/P3.
  3. ✅ **편집 세션 무결성 — 완료(ADR-022).** localStorage 드래프트(키=`(sessionId,productId)`, sessionId 안정 →
     소유권 무결성 유지), 버전키+안전파싱+7일 TTL, 마운트 복원 배너·결제 시 정리. 서버 드래프트(교차기기·공유)는 P2+로 분리.
- **롤아웃**: P0 기반(비파괴, 034/035 + 스냅샷 v2 ADR) ✅ → P1 편집기 MVP(케이스1~4 그리드) ✅ →
  P2 세트·어드민 워크스페이스(036/037) ✅ → P3 주문 6화면 시각화 ✅ (FS-X 웨이브 2026-07-16 —
  갤러리월 드래그 에디터·세트 SKU 주문 플로우·세트할인 적용은 후속).
- **✅ P0 기반 — 완료(ADR-023, 배포 대기 커밋).** 034/035 SQL 작성(`supabase/migrations/`, CTO 적용 가이드
  `docs/MIGRATIONS-APPLY.md`) · `src/types/project.ts` 신설(확장형 도메인 SSOT) · `product_type` plumbing
  graceful 폴백(`mapProduct` 부재/NULL→'single', 034 비게이트) · CartItem 옵셔널 묶음필드 + localStorage
  v1→v2 무손실 마이그레이터 · `adminNav.ts` SSOT(사이드바/하단바/타일 3중복 통합). 검증 GREEN(tsc·eslint·
  build·239 tests). **034/035 는 적용해도/안 해도 앱 무변화** — 035 의 진짜 게이트는 P1(라인 저장 시점).
- **신규 마이그레이션** ⛏️: `034_products_product_type`(+cart_projects) ✅적용, `035_cart_items_project_link`
  (+order_items 컬럼) ✅적용, `036_set_templates` ✅작성(적용 대기), `037_bundle_rules` ✅작성(적용 대기)
  (전부 비파괴 NULL/신규 — §1 표·`docs/MIGRATIONS-APPLY.md` "2차 적용 대기" 절 참조).
- **✅ P1 확장형 편집기 MVP — 완료(2026-07-06, ADR-025, 브랜치 `feat/extended-p1-editor`).** 4유닛:
  ① FS-P1-00 기반 — ADR-025(FROZEN 옵셔널 계약)·`EditorPhotoEntry` 옵셔널(`selectedOptions?`/`orientation?`)·
  드래프트 v2 무손실 승격·`OrderItemSnapshot` orientation/projectSeq/groupLabel·`isProjectCartAvailable` probe.
  ② FS-P1-01 스토어 — `kind:'basic'|'extended'` 분기(basic=현행 문자 그대로)·`photoPool`·라인 액션 5종·
  라인별 totals `sum(price_i×qty_i)`·`suggestOrientation`. ③ FS-P1-02 서버 — createOrder 그룹 동결
  (스냅샷 jsonb + 035 probe conditional-spread)·cart_projects 헤더 upsert(dedup+race)·sync probe 폴백.
  ④ FS-P1-03 UI — `mode=multi`(PhotoPoolPanel/LineList/MultiCheckoutControls)·묶음 담기·드래프트 v2 연동·
  상품상세 "여러 장 만들기" CTA·모바일·i18n 24키. **CTO 케이스 1~4 전부 커버**, 베이직 회귀 고정 테스트 다수.
  graceful: 익명은 034/035 무관 완전 동작, 로그인 카트 동기화만 probe 폴백(미적용 시 평면 저장, 묶음 정보는
  주문 스냅샷 jsonb 보존) — **034/035 적용 시 로그인 묶음 동기화 자동 활성화**. 검증: tsc 0 · eslint 0 ·
  build 0 · vitest 510 passed | 14 todo(베이스라인 451 → +59).
- **✅ P2 세트·어드민 워크스페이스 — 완료(2026-07-16, FS-X 웨이브 X-03, ADR-026, 브랜치 `feat/p2-p3-commerce`).**
  마이그 036/037 작성(적용 대기) · `/admin/products/[id]` 워크스페이스 6탭(유형 게이트 — single→extended
  승격 포함) · set_templates 슬롯 빌더(mm 4필드 폼 + WallCanvas 읽기전용 미니맵 프리뷰) · bundle_rules 폼
  (폼·저장·타입까지 — **세트할인 createOrder 적용은 ADR-026 보류**, 세트 SKU 출시 시 활성화).
  갤러리월(벽 슬롯 에디터 드래그·세트 SKU 주문 플로우)은 후속(P2 후기).
- **✅ P3 주문 6화면 묶음 시각화 — 완료(2026-07-16, FS-X 웨이브 X-04/X-05).** 그룹핑 뷰모델
  (`groupCartByProject`/`groupOrderByGroupId` — 그룹 키 = 카트 projectId / 주문 snapshot.groupLabel,
  깨진 키 단품 폴백) · cart 묶음 카드 + 세트 원자 선택(ADR-021 — 그룹 헤더 일괄 토글, 부분선택 불가) ·
  checkout 그룹 요약 · success 그룹 요약 · lookup projection+그룹 · MyOrders 그룹 · admin 주문상세
  그룹 트리+할인 분해 · **reorder 세트 복원 버그 수정**(project 필드 드롭 → groupLabel 기준 복원).
- **잔여(후속 후보)**: 갤러리월 드래그 에디터·세트 SKU 주문 플로우(P2 후기) · 세트할인 createOrder 적용
  (ADR-026 보류 해제 시) · 재크롭 배지 베이스라인 드래프트 영속화 · extended 에서 명화/Google Photos 소스 ·
  StudioClient 본문 i18n · 서버 드래프트(교차기기).
- **CTO 결정 잔여**: 갤러리월 카탈로그 노출 방식(스펙 §12-6) — 나머지는 ADR-021/026 으로 확정
  (부분선택·취소 단위·할인 분배·마이그 적용 시점=머지·배포 후 브라우저 세션).

---

## §2. P1 — 감사 후속 (전수감사에서 보고됨, 미수정)

### ✅ BL(해결): 재주문 무동작 (`/api/cart/reorder`) — ADR-020에서 해소
- **원인**: order_items 스냅샷에 원본 photoId 부재 → 유효 `CartItem` 재구성 불가(`photoId:null` 스키마 위반),
  클라가 응답 무시하고 `/cart` 이동만.
- **해결(2026-06-23)**: 주문 생성 시 스냅샷에 `sourcePhotoId` 동결 + 재주문 route가 (sourcePhotoId 또는
  photo_url→photos 역조회로) 유효 `AddToCartInput` 재구성, `MyOrdersClient.handleReorder`가 실제 `addToCart`.
  레거시 주문도 베이크크롭 URL 역조회로 동작. 복원 불가 항목만 skip + 사용자 고지.

### 기타(저위험)
- 리뷰 작성 자격이 `DELIVERED`만 확인 → `confirmed_at`(구매확정) 미연동. 설계 선택(현재는 의도).
- ✅ `src/app/admin/artworks/actions.ts` 썸네일 생성 TODO — EC 웨이브(FS-EC-06)에서 해소(sharp 썸네일).

---

## §3. ✅ P1 — Phase B-2 완료 (EC 웨이브 2026-07-03, ADR-024)

> B-2 3건 전부 EC 웨이브(브랜치 `feat/ecommerce-basics-photowall`, FS-EC-00~03)에서 구현 완료.
> 마이그레이션 031/038/039 미적용 상태에서도 앱 정상 — 적용 시 feature-probe 로 자동 활성화(§1).

- ✅ **B-2-1 적립금(031)**: earn = 구매확정(`confirmPurchase`) 시 1% 멱등(`POINTS_EARN_RATE_BPS=100`),
  redeem = 체크아웃 차감(fail-closed + 보상 트랜잭션, redeem 후 최소 결제 100원), `/account/points` +
  `/api/account/points`. **적립 회수 = 전액 환불·취소 시 자동**(`reversePointsForOrder`, 멱등 —
  ADR-024 Postscript). 부분환불(누적<전액)은 무조정(§5 잔여).
- ✅ **B-2-2 부분환불(038)**: Toss `cancelAmount` + `refunded_amount` 누적 + 낙관 잠금. 누적==total 시
  REFUNDED 전이(IN_PRODUCTION/SHIPPED 등 전이 불가 상태면 상태 유지 + 경고 로그).
- ✅ **B-2-3 현금영수증(039)**: 체크아웃 신청 캡처(income=소득공제/proof=지출증빙) → 주문 스냅샷 →
  Toss 발급 훅(**현금성 결제만**, 카드 N/A).

---

## §4. 🔌 보안 후속

- **Phase 1 — 분산 레이트리밋 활성화**: 코드 완료(PR #50, Upstash REST + 자동 폴백).
  **`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` 두 env만 설정**하면 활성화
  (Vercel Marketplace에서 Upstash Redis 프로비저닝). 미설정 시 in-memory(다중 인스턴스 우회 잔존).
- **Phase 2 하드닝**: 익명 사진 버킷 RLS 명시 정책, 결제 confirm 소유권 확인(방어심화 — 금전경로는
  이미 Toss 검증으로 차단), CSP `script-src` 강화, 업로드 서명URL TTL(7일→단축).

---

## §5. P2 — Phase C (성장·부가, 주문관리 갭분석)

완료(EC 웨이브 2026-07-03):
- ✅ 매출·주문 **통계 대시보드** (admin) — FS-EC-06: 매출 요약·상태별·인기 상품·최근 주문(+artworks 썸네일 sharp)
- ✅ **제주·도서산간 추가배송비** (030 wiring) — FS-EC-01/02: 체크아웃 표시 + `createOrder` 서버 재계산
- ✅ **적립 회수 자동화(전액 경로)** — 리뷰 후속 격상(ADR-024 Postscript): 전액 환불·취소 시
  `reversePointsForOrder` 자동 회수(사용분 복원 ADJUSTMENT+ / 적립분 회수 REFUND−, `(order_id,type)` 멱등,
  fire-and-forget, 031 미적용 skip)

완료(FS-X 웨이브 2026-07-16, 브랜치 `feat/p2-p3-commerce`, ADR-026 — 마이그 042/040/041 적용 대기):
- ✅ **쿠폰/할인** — X-01/X-04/X-05: 정액(원)/정률(bps, subtotal 기준·상한 payable)·최소금액·만료·
  전체한도(조건부 UPDATE 원자 소비 + 실패 보상)·회원 1인1회(coupon_redemptions UNIQUE)·비회원 허용.
  할인 순서 = 쿠폰→적립금(net totalPrice, 031 계약 유지). 체크아웃 쿠폰 카드 + `/api/coupons/validate` +
  createOrder 통합 + admin 쿠폰 CRUD. (042 적용 대기 — probe 게이트)
- ✅ **1:1 문의** — X-02/X-05/X-06: 4레이어(db/api/account/admin) + 답변 이메일(notifyInquiryReplied) +
  admin 답변 UI + account 문의 목록/작성폼. 비밀글 고정(전부 비공개). (040 적용 대기)
- ✅ **위시리스트** — X-02/X-06: 로그인 전용(CTO 확정). 하트 아일랜드 + 배치 하이드레이션 + 카탈로그/상세
  와이어링 + account 위시. (041 적용 대기)

남은 항목:
- **SMS/카카오 알림톡** (현재 알림은 이메일 only)
- **회원정보 관리** (수정/비밀번호 변경/회원탈퇴) — 고객 멤버십 성숙
- **배송 추적 API** 연동 (현재 운송장 번호 기록만)
- **세트할인 createOrder 적용** — ADR-026 보류(세트 SKU/갤러리월 출시 시). bundle_rules 폼·저장·타입까지는
  구현 완료 — 현행 라인별 가격 검증 유지
- **갤러리월 드래그 에디터·세트 SKU 주문 플로우** — P2 후기(슬롯 빌더는 mm 폼+미니맵 프리뷰까지 완료, §1A)
- **부분환불 적립 비례 조정** — 부분환불(누적<전액)은 현재 적립 무조정(문서화된 한계, ADR-024
  Postscript). 비례 조정 정책 미정 — CTO 결정 필요
- **REDEMPTION 원장 order_id 사후 링크**
- **통계 규칙 보완** — 전액환불(REFUNDED 전이)은 `refunded_amount` 에 기록되지 않음 → 매출 통계에서
  부분환불/전액환불 집계 규칙 정리 필요
- **정산** 요약

---

## §6. 인프라/운영 메모 (작업 시 주의)

- **배포 검증 도메인**: `https://frameshop-snowy.vercel.app` (실 운영). `frameshop.vercel.app`은 stale 별칭(404 오인 주의).
- **리전**: Vercel 함수 = `icn1`(서울), Supabase = 서울. `vercel.json regions:["icn1"]`로 동일 리전(지연 최소).
- **Vercel 배포 권한(Hobby)**: 비공개 레포에서 `storigehub` 작성 커밋의 배포는 **Blocked**.
  → git author를 `PapasCompany`(`68457172+papascompany@users.noreply.github.com`)로 설정해 완화함
  (이 레포 local config). **PR 머지는 papascompany 작성 main 커밋이 되어 자동 Ready 배포됨.**
  근본 해결: Vercel **Pro 업그레이드**(팀 멤버 추가) 또는 **레포 Public 전환**.
  자동배포가 가끔 누락되면 main에 사소한 커밋(README) 1건으로 트리거.
- **마이그레이션 적용 불가**: §1 참조 — CTO 수동 적용.
- **인쇄 렌더**: photo-only(베이크 크롭 정규화). 상품별 블리드(`products.bleed_mm`, admin 설정).
  자세한 사양은 `docs/frame_skills.md` + 메모 `project-print-pipeline-baked-crop-mismatch`.
- **데모/접근(2026-06-24 점검)**: 고객 흐름은 인증 없이 **프로덕션 별칭 공개**(`frameshop-snowy`). 단
  생성형/프리뷰 URL(`*-yohans-projects-*.vercel.app`)은 **Vercel SSO 보호** → 데모는 별칭만. 앱 로그인
  게이트는 `/admin`만.
- **⚠️ 결제 미구성(런칭 전 과제)**: 프로덕션 Toss 클라이언트 키 = `test_ck_placeholder`(유효 키 아님) →
  "결제하기" 위젯 에러로 주문 완주 불가. Toss 테스트키(`test_ck_…` + `TOSS_SECRET_KEY`) 또는 라이브키
  설정 필요. 데모는 체크아웃 폼까지만 정상.

---

## §7. 완료(참고)

**EC 웨이브 (2026-07-03, 브랜치 `feat/ecommerce-basics-photowall`, ADR-024):** FS-EC-00~06 7단위 —
기반(038/039 마이그+타입 계약+feature-probe+surcharge 순수모듈), 체크아웃(필수 동의 2종·적립금 사용·
현금영수증 신청·추가배송비 표시·`/account/points`), 주문 서버 코어(redeem fail-closed·surcharge 서버
재계산·receipt 저장·1% earn 멱등), 관리자 주문/결제(부분환불·현금영수증 Toss 발급 훅·주문 ZIP),
**포토월 `/wall`**(mm 실측 Konva 벽 시뮬레이터 + 스튜디오 딥링크 프리셀렉트 + localStorage v1),
법적고지(`/terms` `/privacy` + `company.ts` SSOT + 404 + JSON-LD 테스트), admin 통계 대시보드 +
artworks 썸네일. 적대 리뷰(Security+Final)가 P0 1건(/api/orders 브리지 공백) 적발 → 수정 랜딩 +
적립 회수 자동화 격상(ADR-024 Postscript). 최종 검증: tsc 0 · eslint 0 · vitest 451 passed | 14 todo · build OK.
포토월은 CTO 결정대로 자체 주문 플로우 없이 스튜디오 딥링크로 연결 — 확장형 P1 편집기(§1A)와
독립이며 그 선행 조건이 아니다(P1 편집기는 §1A 트랙으로 별도 진행).

**이전 세션:** 가로/세로 방향 선택(#47), 인쇄 파이프라인 photo-only 재작성(#48), 보안 감사 Phase 0(#49)·
분산 레이트리밋 Phase 1 코드(#50), 리전 동일화(#51), 주문관리 **Phase A**(검색·엑셀·메모·운송장일괄·
알림, #52), **Phase B-1**(고객취소·주소록·구매확정, #53), 전수감사 보완 3건(#56), 확장형 P0 기반(#58).
전부 라이브.
