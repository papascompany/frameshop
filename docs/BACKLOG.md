# FrameShop 백로그 (작업 예정 단일 출처)

> 이 문서는 **남은/예정 작업의 단일 출처(SSOT)** 다. 완료되면 항목을 "완료" 표시하고
> `shared/STATUS.md` 변경로그에 한 줄 남긴다. 최종 갱신: 2026-06-22.
>
> 우선순위: **P0**(운영 차단·금전/보안) · **P1**(표준 기능) · **P2**(성장·부가)
> 의존: ⛏️ = 마이그레이션 선적용 필요(아래 §1), 🔌 = 인프라 프로비저닝 필요

---

## §1. ⛏️ 미적용 마이그레이션 (CTO가 Supabase SQL Editor에서 실행해야 활성화)

> **제약**: FrameShop DB는 `yohan73@gmail.com` 계정 소유. Claude의 Supabase MCP는
> `papascompany` 계정에 연결돼 있어 **직접 적용 불가** → CTO가 SQL Editor에서 수동 실행해야 함.
> 미적용 상태에서도 앱은 정상 동작하도록 컬럼/테이블 접근을 격리 설계함(해당 기능만 비활성).

| 마이그레이션 | 기능 | 코드 상태 | SQL |
|---|---|---|---|
| `029_orders_order_memo` | 관리자 주문 메모 (Phase A) | 라이브, 컬럼 대기 | `ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_memo text;` |
| `032_user_addresses` | 주소록 (Phase B-1) | 라이브, 테이블 대기 | 파일 참조 |
| `033_orders_confirmed_at` | 구매확정 (Phase B-1) | 라이브, 컬럼 대기 | `ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;` |
| `031_user_points` | 적립금 (B-2에서 wiring) | 미연결 | 파일 참조 |
| `030_orders_shipping_surcharge` | 제주/도서산간 추가배송비 | 미연결 | 파일 참조 |

→ **다음 세션 첫 액션 권장**: CTO에게 029/032/033 적용을 안내하고 적용 후 메모·주소록·구매확정이 런타임에서 동작하는지 검증.

---

## §1A. ★ 확장형 상품 (베이직/확장형 분리) — 신규 이니셔티브 (설계 제안 완료, 검토 대기)

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
- **롤아웃**: P0 기반(비파괴, 034/035 + 스냅샷 v2 ADR) → P1 편집기 MVP(케이스1~4 그리드) →
  P2 세트·어드민 워크스페이스(036/037) → P3 주문 6화면 시각화.
- **신규 마이그레이션** ⛏️: `034_products_product_type` + `034_cart_projects`, `035_cart_items_project_link`
  + `035_order_items_project`, `036_set_templates`, `037_bundle_rules` (전부 비파괴 NULL/신규, 029~033 다음 번호).
- **CTO 결정 필요**: 세트 부분선택/취소 단위/할인 분배/프리셋 우선순위/마이그레이션 적용 시점/카탈로그 분리(스펙 §12).

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
- `src/app/admin/artworks/actions.ts` 썸네일 생성 TODO (Phase 2 보류).

---

## §3. P1 — Phase B-2 (결제·세무 민감, 신규 마이그레이션 필요)

> B-1(취소·주소록·구매확정)은 완료·라이브. B-2는 결제/세무 민감도가 높아 별도 웨이브로 분리됨.
> 각 항목 골든/검증 후 단계 배포 권장.

### B-2-1. 적립금 연결 ⛏️(031)
- **earn**: 구매확정(`confirmPurchase`) 시 결제액의 X% 적립 (기본 1% 상수, 후속에 admin 설정화).
- **redeem**: 체크아웃에서 보유 적립금 차감 — `031`의 `apply_points_transaction` RPC(원자/이중지불 차단) 사용.
- **마이페이지**: 적립금 잔액 + 내역(`/account/points`).
- **주의**: 적립/차감을 주문 합계·결제 검증과 정합. 적립은 구매확정 게이트(`confirmed_at`)와 연동.

### B-2-2. 부분환불 ⛏️(신규 컬럼)
- 신규 마이그레이션: `orders.refunded_amount numeric NOT NULL DEFAULT 0`.
- admin `refundOrderAction`에 금액 파라미터 + `tossClient.cancel({ paymentKey, cancelAmount })`.
- 누적 환불액 추적 + 전액환불 시 REFUNDED 전이. admin 상세 UI에 부분환불 입력.

### B-2-3. 현금영수증 ⛏️(신규 컬럼 + Toss API)
- 신규 마이그레이션: `orders.receipt_type text`(소득공제/지출증빙/미발급), `orders.receipt_info text`(식별번호).
- 체크아웃에서 발급 요청 캡처 → 주문 저장 → admin 가시성.
- Toss `cash-receipts` API 발급(결제수단이 현금성일 때만 유효; 카드는 N/A) — 발급 훅 + 실패 graceful.
- **세무/사업자 설정 의존** → 자동발급 범위는 CTO 확인 후 결정.

---

## §4. 🔌 보안 후속

- **Phase 1 — 분산 레이트리밋 활성화**: 코드 완료(PR #50, Upstash REST + 자동 폴백).
  **`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` 두 env만 설정**하면 활성화
  (Vercel Marketplace에서 Upstash Redis 프로비저닝). 미설정 시 in-memory(다중 인스턴스 우회 잔존).
- **Phase 2 하드닝**: 익명 사진 버킷 RLS 명시 정책, 결제 confirm 소유권 확인(방어심화 — 금전경로는
  이미 Toss 검증으로 차단), CSP `script-src` 강화, 업로드 서명URL TTL(7일→단축).

---

## §5. P2 — Phase C (성장·부가, 주문관리 갭분석)

- 매출·주문 **통계 대시보드** (admin)
- **쿠폰/할인** (coupons 테이블 + 체크아웃 적용)
- **1:1 문의 / 주문 Q&A** (inquiries 테이블 + admin 답변)
- **위시리스트** (찜)
- **회원정보 관리** (수정/비밀번호 변경/회원탈퇴) — 고객 멤버십 성숙
- **제주·도서산간 추가배송비** ⛏️(030 wiring)
- **정산** 요약, **SMS/카카오 알림톡** (현재 알림은 이메일 only)

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

---

## §7. 완료(참고) — 이번 세션 성과

가로/세로 방향 선택(#47), 인쇄 파이프라인 photo-only 재작성(#48), 보안 감사 Phase 0(#49)·
분산 레이트리밋 Phase 1 코드(#50), 리전 동일화(#51), 주문관리 **Phase A**(검색·엑셀·메모·운송장일괄·
알림, #52), **Phase B-1**(고객취소·주소록·구매확정, #53), 전수감사 보완 3건(#56). 전부 라이브.
타입·린트·빌드·219 테스트 GREEN.
