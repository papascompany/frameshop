# 확장형 상품 (베이직/확장형 분리) 설계 스펙

> 상태: **제안(검토 대기)** · 작성 2026-06-23 · 근거: 멀티에이전트 경쟁사 리서치(7클러스터) +
> 현 코드 정밀 분석(5축) + 후보 아키텍처 3종 심사 + 적대적 비평. 시각화: `docs/specs/extended-product-mockups.html`.
> 본 스펙은 **구현 전 합의용 SSOT**. 확정 후 `docs/BACKLOG.md` §확장형 상품과 동기화.

---

## 1. 배경 / 문제

현재 FrameShop은 **"사진 1장 → 사이즈 1개"** 단품 주문만 가능하다. 편집기에 같은 variant로
N장을 담는 트레이(`EditorPhotoEntry`)는 있으나 **사이즈 변경 시 트레이가 초기화**되고,
장바구니(`CartItem`)는 (사진×variant) **평면 리스트라 묶음/세트 개념이 없다**.

CTO가 받고자 하는 주문 유형(예시):
1. 사진1을 가로 액자 2개(다른 사이즈) + 사진2/3로 세로 액자 여러 사이즈
2. N장 업로드 → 각각 다른 사이즈/방향
3. N장 업로드 → 같은 사이즈로 여러 개
4. 사진1을 A/B/C 사이즈 + 가로·세로 혼합

→ 현 UI/UX로는 불가. 베이직(단품)은 분리·보존하고, 위 케이스에 대응하는 **확장형 상품**을 도입한다.

---

## 2. 채택 아키텍처 — 프로젝트/세트 집합(Project Aggregate)

후보 3종 심사 결과(가중 5기준: 케이스 대응·현코드 점진성·고객 직관성·어드민 운영성·인쇄 정합):

| 후보 | 점수 | 요지 |
|---|---|---|
| **프로젝트/세트 집합** ✅ | 8.8 | `cart_items`에 nullable `projectId`만 얹어 평면 라인을 자식으로 재사용. 변형 4축 무변경. |
| 구성형 번들(슬롯/규칙) | 8.0 | 어드민 운영성 최고이나 `variantKey`/`OptionMatrix` 재작성 고위험. |
| 갤러리월 캔버스 우선 | 7.6 | 직관성 1등이나 멀티슬롯 캔버스·세션 영속화 프런트 난이도 최고. |

**채택: 프로젝트/세트 집합.** 핵심 원리:

- **변형 4축(size×color×matte×paper)·`variantKey`·인쇄 파이프라인(photo-only 베이크 크롭) 무변경.**
- `projectId`가 **null이면 현행 단품 코드 경로 100% 유지**(회귀 표면 최소).
- CTO 1~4 케이스 = **"같은 photoId를 참조하는 복수 라인 + 라인별 variantId/orientation"** 으로 흡수.
- 주문은 `order_items`를 `project_group_id`로 **평면 전개** → 015의 "행당 단일 렌더메타·bleedMm 동결"
  인쇄 불변식 그대로 보존(재작성 불필요).
- 승자 토대 위에 준우승안의 강점을 레이어로 흡수: 번들안의 **선언적 규칙 엔진**(`bundle_rules`) +
  어드민 **한 페이지=규칙 폼**, 갤러리월안의 **풀↔슬롯 분리 + slotPos 좌표 → 벽/그리드 2모드**.

---

## 3. ★ 상품 taxonomy & 분리 결정 (CTO 검토 포인트)

질문: **"일반 액자를 여러 조합으로 주문하는 UI/UX"** 와 **"갤러리월"** 을 별개 상품으로 분리할 것인가?

### 권고: 데이터는 하나, 경험/카탈로그는 둘, 출시는 단계

| 구분 | 일반 다조합 (그리드 모드) | 갤러리월 (세트/벽 모드) |
|---|---|---|
| 성격 | 자유 구성: 사진·사이즈·방향 자유 조합 | 검증된 레이아웃: 슬롯 사양 고정, 사진만 채움 |
| 대응 케이스 | CTO 1~4 전부 | 1·2·4 + 벽 배치 |
| 데이터 | `product_type='extended'`, `set_template_id=NULL` | `product_type='extended'`, `set_template_id` 보유 |
| 시각화 | **그리드**(라인 카드 나열) | **벽 미니맵**(slotPos 좌표 배치 미리보기) |
| 진입 UX | "여러 장 만들기" → 빈 빌더 | 카탈로그의 이름붙은 세트 SKU 선택 |
| 추가 구현 | 라인 빌더(그리드) | + 슬롯 좌표 에디터 · 벽 프리뷰 · hanging guide |
| 출시 | **먼저(P1)** | **나중(P2+)** |

**결론**:
- **하부 데이터 모델은 하나**(Project Aggregate). 둘 다 "프로젝트 = 공유 사진풀 + N라인". 갤러리월은
  거기에 `set_template`(슬롯 좌표)만 더한 특수형이다 → 코드/주문/인쇄 경로를 두 번 만들지 않는다.
- **고객 카탈로그·진입 경험은 분리**한다. 갤러리월은 "거실 갤러리월" 같은 **이름붙은 상품(SKU)** 으로
  진열(set_template 보유), 일반 다조합은 일반 상품에서 "여러 장/조합으로 만들기" CTA로 진입.
- **출시 단계 분리**: 일반 다조합(그리드)을 먼저(P1) — CTO 케이스 1~4를 즉시 충족. 갤러리월(벽 미니맵)은
  시각적 기획을 디벨롭한 뒤(P2+) 슬롯 좌표 에디터/벽 프리뷰와 함께. (CTO 요청 순서와 일치)
- 즉 **"분리하되 같은 토대 위에서"**. 별도 product_type을 새로 파지 않고, `set_template_id` 유무로
  같은 `extended` 안에서 두 경험을 가른다(슬롯 좌표 있으면 벽, 없으면 그리드 — 스키마 1개·렌더 2모드).

> 후속 기획(별도): 갤러리월 만들기 UI/UX를 "내 벽에 어떻게 보일지"가 더 직관적으로 인지되도록
> 디벨롭(벽 미니맵·실측 hanging guide·치수 입력 프리뷰·룸 합성). 본 스펙 확정 후 진행.

---

## 4. 데이터 모델 (전부 비파괴 — 옵셔널/신규만)

| 엔티티 | 변경 | 내용 | 마이그레이션 |
|---|---|---|---|
| `products.product_type` | 신규 | `text NOT NULL DEFAULT 'single' CHECK IN('single','extended')`. 기존행 `single` 백필. 카탈로그/에디터/검증 1차 분기축. `Product` 타입·`mapProduct` 갱신 | 034 |
| `cart_projects` | 신규 | 묶음 헤더: `id, project_local_id, user_id, kind('basic'\|'extended'), product_id, title, set_template_id, photo_pool jsonb, pricing jsonb`. `UNIQUE(user_id, project_local_id)` | 034 |
| `cart_items` | 수정 | `project_id uuid NULL → cart_projects`, `project_seq int NULL`, `orientation text NULL CHECK('landscape','portrait')`. 기존 NOT NULL FK/UNIQUE 유지 → null=레거시 단품 무변경 | 035 |
| `order_items` | 수정 | `project_group_id uuid NULL`, `project_seq int NULL`, `orientation text NULL`(015 nullable+legacy-fallback 패턴 재사용). 프로젝트=같은 group_id N행 평면 전개 | 035 |
| `set_templates` | 신규 | 어드민 프리셋: `id, product_id, name, slots jsonb([{slotIndex,sizeCode,orientation,slotPos{xMm,yMm,wMm,hMm}}]), wall_w/h_mm, set_price/discount, is_active`. 좌표 유무로 벽/그리드 분기 | 036 |
| `bundle_rules` | 신규 | 구성 검증/가격 규칙(1:1 product): `min/max_slots, allowed_size_codes[], allowed_orientations[], allow_size_mix/orientation_mix/photo_reuse, pricing_strategy('sum'\|'sum_with_discount'\|'flat'), discount_bps/flat_price` | 037 |
| **변형 4축·`variantKey`·`OptionMatrix`·`frame_assets`·인쇄 파이프라인** | **무변경** | 사이즈×색×매트×용지, photo-only 베이크 크롭 그대로 | 없음 |

신규 타입: `src/types/project.ts` — `CartProject{projectId,kind,productId,title,setTemplateId,photoPool,items:CartItem[],pricing}`,
`ProjectPhotoRef{photoId,originalUrl,previewUrl,sourcePhotoId,cropTransform}`, `ProjectPricing{subtotal,setDiscount,total}`.

타입 계약 변경(옵셔널만, FROZEN → **ADR 선승인 필요**):
- `CartItem`(`src/types/cart.ts`): `projectId?`, `projectSeq?`, `orientation?` + zod 동기화 +
  `CART_LOCAL_STORAGE_KEY` v1→v2 **무손실 마이그레이터**(평면→`kind:'basic'` 1라인 승격).
- `OrderItemSnapshot`(`src/types/order.ts`): `sourcePhotoId`, `cropTransform`, `orientation`, `groupLabel`,
  `setUnitPrice` + **누락된 `bleedMm`를 `orderItemSnapshotSchema`에 이참에 보강**(현 검증 갭).

---

## 5. 어드민 — 한 페이지 상품 워크스페이스

`/admin/products/[id]` 단일 페이지로 흩어진 5섹션(products/frames/options/categories/settings) 통합.
좌측 스텝-탭 + 우측 라이브 미리보기. **0번째 유형 게이트**(single|extended)가 탭 구성을 분기.
NAV/TILES/BOTTOM_NAV 3중복 하드코딩을 `src/lib/admin/adminNav.ts` 단일 SSOT로 통합.

| 탭 | 적용 | 역할 |
|---|---|---|
| 0 · 유형 게이트 | 신규 생성 | `product_type` 선택 → 탭/검증/미리보기 모드 결정. 등록 후 single→extended 승격 가능(비파괴) |
| 1 · 속성 | 전 유형 | categories 흡수 + 갤러리 이미지 멀티 업로드(미구현 `ProductFormImages` 실체화) |
| 2 · 프레임/편집기 | 전 유형 | 기존 `FramesClient` 임베드 + studio FrameCanvas 재사용 비주얼 `inner_rect` 드래그 에디터 |
| 3 · 옵션매트릭스 | 전 유형 | 기존 `OptionsClient`(4축 CSV/단건) 임베드. 변형 모델 무변경 |
| 4 · 구성규칙 | extended | `bundle_rules` 1행=폼. 클라+서버 공통 검증 SSOT |
| 5 · 세트템플릿 | extended | `set_templates` 슬롯 빌더(벽 미니맵/그리드 2모드) + hanging guide 벽 치수 |
| 6 · 주문연결/보관함 | 전 유형 | 상품별 주문 리스트 임베드 + 주문옵션 노출순서 프리뷰 |

---

## 6. 편집기 UX

하나의 store/캔버스에서 두 모드 분기. 핵심 리팩터 = **옵션을 세션 전역 스칼라 → 라인 단위로 내림**.

- **베이직(single)**: 현행 studio 흐름 100% 보존. 내부적으로만 `kind:'basic'` 1라인 프로젝트로 래핑.
  `PhotoPoolPanel`/`LineList` 미렌더. (FROZEN editor.ts 공유 store 변경이라 **베이직 회귀 테스트 필수**.)
- **확장형(extended)**: "사진 풀 ↔ 라인 리스트" 분리.
  - N장 일괄 업로드 → `photoPool` 적재 → best-fit 자동 방향 판별로 라인 기본 orientation 제안.
  - 풀의 사진을 끌어 라인 생성: 같은 photoId 복수 라인(케이스1·4, **+추가/교체** 시맨틱),
    사진마다 1라인(케이스2), qty 스테퍼/복제/일괄적용(케이스3).
  - 사이즈/방향 변경은 활성 컨텍스트만(**트레이 초기화 제거**: `setSize`/`setOrientation`의 `entries:[]` 삭제).
  - 라인별 독립 크롭(aspect 다르므로 필수). 담기 시 라인 variant 기하로 photo-only 크롭 베이크
    (`crop.ts` 재사용, 재작성 없음) **+ 원본 sourcePhotoId·cropTransform 보존**(§9 선결과제 1).
  - 변환점: `handleCheckoutAll`의 "entries→N개 무관계 평면 폭발"을 "공유 projectId 묶음 addToCart"로.
    `useEditorTotals`를 `sum(price_i × qty_i)` 항목별 합산으로.

---

## 7. 장바구니·주문 시각화

`projectId`(묶음 키) null=단품(레거시 1줄), 값=프로젝트 카드(헤더+구성 펼침). 동일 데이터 위 표시 2계층.
6화면(cart→checkout→success→lookup→MyOrders→admin)이 `groupCartByProject()`/`groupOrderByGroupId()`
**단일 뷰모델 헬퍼**를 공유.

- 프로젝트 카드 헤더: 세트명/구성 칩("가로 2·세로 2·4종") + 썸네일 미니그리드 + 세트 합계 + 펼치기.
- 구성품 행: 라인 썸네일 + 사이즈/방향 칩 + 수량 + 라인 소계. 같은 photoId는 **"같은 사진" 배지**(케이스1·4 의도 명시).
- 세트 가격 블록: 구성 합산 → 세트 할인 → 세트 합계(ProjectPricing). 단품은 할인 라인 숨김.
- 선택 2계층: 카드 헤더=묶음 원자토글(indeterminate), 구성품=개별. `Set<localId>` + `Set<projectId>`.
- 묶음 출고 영향 배지("가장 늦은 제작 건 기준").
- 주문생성: `createOrder`가 묶음을 `project_group_id` 공유 `order_items` N행 평면 전개(서버 group_id 부여).
- 어드민 주문상세: group_id로 세트 헤더+구성 트리. 행마다 인쇄파일 다운로드 유지(015 불변식) + 세트 ZIP.
- 재주문: `project_group_id` 단위 세트 전체 복원("세트 그대로 다시 담기"). 비활성 variant는 가능분만 + 고지.

---

## 8. 롤아웃 단계

| Phase | 범위 | 핵심 산출물 | 마이그레이션 | 위험 |
|---|---|---|---|---|
| **P0 · 기반(비파괴)** ✅완료 | product_type 분기 + 평면 라인 호환. 회귀 0 | 034/035, `project.ts`, CartItem 옵셔널+카트 v2 마이그레이터, OrderItemSnapshot 보강(ADR-020 선반영), adminNav SSOT, **스냅샷/계약 ADR-023**, 회귀 테스트 | 034·035 | 낮음 |
| **P1 · 확장형 편집기 MVP** ✅완료 | 한 세션에서 CTO 1~4(그리드 모드) | 옵션 라인 단위화, `PhotoPoolPanel`/`LineList`, +추가/교체·일괄적용·복제, 묶음 담기 변환점, 해상도 가드, '여러 장 만들기' CTA | 없음 | 중 |
| **P2 · 세트·어드민** ✅완료* | set_templates 프리셋 + 워크스페이스 + 규칙 검증 | 036/037, `/admin/products/[id]` 6탭, 슬롯 빌더(벽/그리드), bundle_rules 폼, cart_projects 헤더+그룹 배치 API, ProjectPricing | 036·037 | 중 |
| **P3 · 주문 시각화** ✅완료 | 단품/묶음 구분을 6화면 일관 | 그룹핑 뷰모델 헬퍼, CartProjectCard/OrderProjectCard/LineItemRow, createOrder 평면 전개, getOrder 매퍼, reorder 세트 복원, 세트 ZIP | 없음 | 낮음~중 |

> **P1 완료(2026-07-06, ADR-025 · `feat/extended-p1-editor`)**: `mode=multi` 편집기(사진풀 → 라인별
> 사이즈/방향/수량 → 묶음 담기)로 CTO 케이스 1~4 커버, 베이직 회귀 0(vitest 510 passed | 14 todo) —
> 034/035 미적용에서도 graceful(익명 완전 동작, 로그인 동기화만 probe 폴백, 적용 시 자동 활성화).
>
> **P2/P3 완료(2026-07-16, ADR-026 · `feat/p2-p3-commerce`, FS-X 웨이브)**:
> P2 = 마이그 036/037 작성(머지·배포 후 적용 — probe 게이트로 미적용 무해) · `/admin/products/[id]`
> 워크스페이스 6탭(유형 게이트 승격 포함) · set_templates 슬롯 빌더(mm 폼 + WallCanvas 읽기전용 미니맵
> 프리뷰) · bundle_rules 폼(폼·저장·타입까지).
> **\*P2 범위 주석**: 세트할인 createOrder 적용은 ADR-026 보류(세트 SKU 출시 시 활성화 — 현행 라인별 가격
> 검증 유지), 갤러리월(벽 슬롯 에디터 드래그·세트 SKU 주문 플로우)은 후속(P2 후기).
> P3 = 그룹핑 뷰모델(`groupCartByProject`/`groupOrderByGroupId`, 깨진 키 단품 폴백) + 6화면
> (cart/checkout/success/lookup/MyOrders/admin) 묶음 시각화 + 세트 원자 선택(ADR-021) + reorder 세트 복원
> 버그 수정. 검증: tsc 0 · eslint 0 · build 0 · vitest 773 passed | 14 todo(베이스라인 535 → +238).
>
> 갤러리월(벽 미니맵·슬롯 좌표 에디터·벽 프리뷰)은 P2의 set_templates 위에 얹되, 시각 기획 디벨롭 후 별도 진행.

---

## 9. ★ 선결 과제 3건 (P1 착수 전 해결 — 현 코드 검증으로 확인)

적대적 비평이 현 코드로 확인한 **설계안의 실패점**. 안 풀면 차별 기능이 출시 시점에 작동하지 않는다.

### 9-1. 원본 photoId·cropTransform 보존 (가장 치명적)
- **현실**: `handleAddToTray`(StudioClient)는 "담기" 시점에 크롭을 구워 `/api/photos/upload`로 **재업로드** →
  `entry.photo.id`는 **베이크된 크롭의 새 photoId**이지 원본이 아니다. `cart_items.photo_id`는 NOT NULL FK.
- **귀결**: "같은 사진 다른 사이즈"는 라인마다 다른 크롭→다른 photoId가 생긴다. 설계안이 의존하는
  "한 photoId를 N라인이 공유, 중복 업로드 없음" 전제가 **현 베이크-온-담기 모델에서 성립 안 함**.
- **해결**: 라인/스냅샷에 **`sourcePhotoId`(원본) + `cropTransform`을 별도 보존**. 표시·재크롭·재주문은
  원본 기준, 인쇄는 베이크 크롭 기준으로 분리. (재주문 무동작 BL의 근본 원인과 동일 — 함께 해소)

### 9-2. 세트 가격·취소 정책 ADR (035 적용 전 동결)
- **충돌**: `order_items`는 행당 price 동결(015 불변식), `createOrder`는 서버 권위 재계산(클라 price 거부).
  세트 할인은 세트 단위인데 N행에 어떻게 분배 저장할지, 서버가 `bundle_rules`로 세트가를 재검증하는 경로가 없음.
- **위험**: 클라 `setUnitPrice`를 그대로 신뢰하면 가격 변조 표면(보안 감사 맥락 충돌). 행별 price 합 ≠ 세트가면
  부분취소/환불 금액 산정 불가.
- **해결(ADR로 동결)**: (a) 세트 할인의 행 귀속 규칙(비례배분 vs 대표행), (b) `createOrder`의 세트가 서버
  재계산·검증 경로, (c) 세트 취소/환불 단위(원자 vs 라인) — 기존 B-1 고객취소와 정합.

### 9-3. 확장형 세션 서버 영속화
- **현실**: studio `[orderId]`는 draft order가 아니라 클라 `crypto.randomUUID()` sessionId. 확장형 세션
  (photoPool·다라인)이 전부 Zustand 인메모리 → **새로고침/공유 시 소실**.
- **위험**: 다라인 확장형은 단품보다 이탈률이 훨씬 높아 인메모리 MVP는 전환 손실. (경쟁사 표준은 프로젝트 저장)
- **해결**: draft 편집 세션을 서버 저장(항목 배열 영속)으로 **MVP와 동시 상향**. 새로고침 복원·링크 공유.

---

## 10. 리스크 (요약)

- FROZEN 계약(cart/order/editor.ts) 옵셔널 변경 → **ADR 선승인 게이트**(P0가 여기 직렬 의존).
- 미적용 029~033 위에 034~037이 쌓임 → 번호는 029~033 다음으로 부여(충돌 회피), 적용 순서 CTO 명시
  (가이드 `docs/MIGRATIONS-APPLY.md`). ~~`product_type` 부재 시 `mapProduct`가 깨지므로 034 적용이 P0
  게이트~~ → **해소(ADR-023)**: `mapProduct`가 부재/NULL→'single' 폴백, catalog 명시 SELECT 미변경,
  카트 DB 경로 미변경 → **034/035 는 비게이트(적용해도/안 해도 앱 무변화)**. 035 진짜 게이트는 P1(라인 저장).
- 2계층 식별(projectId+localId)로 동기화 복잡 → 그룹 단위 배치 upsert/DELETE API + `syncCartOnLogin` 그룹 전송.
- photoPool jsonb는 photos FK 밖 → 고아 사진 앱 레벨 정리(주문 확정 시 참조 photoId만 FK 동결).
- 베이직 회귀 → photoPool/lines 미사용 시 현행 경로 유지 + 라인 담을 때 옵션 스냅샷 동결 + 회귀 테스트.
- 표현 6곳 누락 시 세트가 N개 개별주문처럼 보임 → 단일 뷰모델 헬퍼 + 깨진 projectId는 단품 폴백 렌더.

## 11. 경쟁사 핵심 차용

- **Mixtiles**: 한 주문 내 사진별 독립 사이즈/스타일(케이스1·4 모델). 멀티포토 일괄 업로드. AR/벽 프리뷰.
- **Framebridge**: 이름붙은 레이아웃 SKU(set_templates) + 슬롯 드래그 할당 + 실측 hanging guide + 세트 단일가.
- **Snapfish/Shutterfly/Nations**: best-fit 자동 방향, +ADD/UPDATE 버튼 시맨틱, Apply-to-All→라인 오버라이드 2단.
- **Boxi/Shopify Bundle**: 장바구니 카드 그룹핑(세트=1카드 펼치면 N구성), 세트 단위 가격 경로.
- **레드프린팅**: 묶음 출고 정책 노출("가장 늦은 건 기준").

## 12. CTO 결정 필요 (open decisions)

1. 세트 부분선택: 구성품 일부만 결제 허용(할인 재계산) vs 세트 통째만.
2. 세트 취소/환불 단위: 세트 원자 vs 라인 단위(B-1 고객취소와 정합).
3. 세트가 분배 규칙: 비례배분 vs 대표행 귀속(부분환불 근거).
4. 자유구성 vs 세트 프리셋 우선순위: P2에서 set_templates 먼저 vs bundle_rules 동시.
5. 마이그레이션 적용 주체/시점: 029/031/032/033 미적용분 + 034~037을 누가 언제 yohan73 DB에 수동 적용.
6. 갤러리월/일반 다조합 카탈로그 분리 노출 방식(§3 권고 확정).

---

## 13. 현행 구현 대비 갭 (2026-06-23 코드 직접 검증)

CTO 요구 3건을 실제 코드로 끝까지 검증한 결과(파일:라인 인용). **선결과제 3건 진행 확정.**

### 요구 1 — 다건 편집 + 사진 보관함(좌측 사이드바)
- **있음**: 다건 편집본 트레이 + 항목별 수량. `store/editor.ts` `entries`/`setEntryQuantity`,
  `StudioClient.tsx:369-422`(트레이 렌더, 수량 ± `:388-405`, 항목별 금액 `:408`, 삭제).
- **없음**: 업로드 소스 사진을 모아두는 **좌측 "사진 보관함"(멀티 업로드 라이브러리)**. 현재는 1장씩 업로드
  (`handleFile:90`)해 활성 사진 1장만 두고, 트레이는 하단 세로 리스트(스샷1의 좌측 라이브러리 부재).
- → **보완(P1)**: `PhotoPoolPanel`(멀티 업로드 + 좌측 라이브러리). 스토어에 `photoPool[]` 추가.

### 요구 2 — 보관함→편집영역 투입 + 조정 후 크롭 하단 추가(수량변경) + 주문화면 금액/수량 증감
- **있음**: "이 사진 담기"→크롭 베이크+재업로드→하단 편집본 추가(`handleAddToTray:198`), 편집본별 수량 ±,
  주문화면 합계 = 총수량×단가(`useEditorTotals`, `StudioClient.tsx:472-478, 505-511`).
- **부분/없음**:
  - 보관함에서 **선택/드래그로 편집영역 투입** — 없음(라이브러리 부재).
  - **라인별 다른 사이즈/단가(혼합)** — 없음. 모든 편집본이 단일 variant 공유, **사이즈/방향 변경 시 트레이 초기화**
    (`store/editor.ts:195`(setSize)·`:172`(setOrientation)). 합계도 단일 단가 기준.
  - **원본 photoId 미보존** — `handleCheckoutAll:255`가 카트 `photoId`를 베이크 크롭 id로 설정 → **선결과제 1**.
- → **보완(P1)**: 드래그 투입 + 라인별 variant/가격(혼합 사이즈) + 합계 `sum(price_i×qty_i)` + sourcePhotoId 보존.

### 요구 3 — 어드민 주문단위 스펙+수량 + 각 파일 크롭 출력파일 다운로드
- **있음(충족)**: 어드민 주문상세에 상품별 상품명·사이즈/색상·수량·단가 + **"인쇄 파일 다운로드"(300dpi 베이크
  크롭)** 링크. `AdminOrderDetailClient.tsx:244-273`. 렌더 파이프라인이 PAID 시 `order_items.print_file_url`을
  채움(`render/pipeline.ts:258`, enqueue on PAID; `createOrder`는 null로 삽입 후 잡이 채움).
- **부분 보완**: 어드민 스펙 표시에 **매트·인화지·방향 누락**(데이터는 `snapshot.options`에 있으나 **orientation은
  스냅샷에 미동결** — `orderItemSnapshotSchema`에 `bleedMm`·`orientation` 누락도 함께 확인). **주문 단위 ZIP 일괄
  다운로드 없음**(항목별 링크만). 세트/묶음 그룹 표시는 확장형 P3.
- → **보완(소)**: 어드민 표시에 매트·인화지·방향 추가 + 스냅샷에 orientation/bleedMm 동결(P0) + (선택) 주문 ZIP.

### 결론
요구 3은 **이미 충족**(표시 소보완). 요구 1·2는 **핵심 골격(트레이·항목별 수량·합계·크롭 출력)은 존재**하나
**"사진 보관함 사이드바·드래그 투입·혼합 사이즈 라인별 가격·원본 photoId 보존"** 이 미비 → P0(선결과제)+P1 편집기
작업으로 보완. 현행 트레이는 CTO 케이스 3(같은 사이즈 N장)을 이미 커버하므로 **재작성이 아닌 확장**이 맞다.
