# Module: Cart

## Purpose
M-Cart는 편집기에서 완료된 액자 아이템을 임시 보관하고 체크아웃으로 이어주는 모듈이다. 비로그인 사용자는 **LocalStorage**, 로그인 사용자는 Supabase `cart_items` 테이블과 동기화한다. 각 CartItem은 상품/옵션/사진 URL/CropTransform/미리보기 PNG URL/가격/수량의 완전한 직렬화 가능 스냅샷이며, 결제 시점에 `order_items.variant_snapshot`으로 동결된다(가격 변경 시점 격리). 미리보기 PNG는 편집기에서 `Stage.toDataURL()` → Supabase Storage `previews/` 업로드 → URL을 cart에 저장한다. UC-05 비회원/회원 분기와 로그인 시 LocalStorage→DB sync 동작이 핵심 시나리오다.

## User Stories
- B2C 구매자(비회원)로서, 사진을 편집한 후 "장바구니 담기"를 누르면 즉시 장바구니에 저장되고 나중에 같은 디바이스에서 돌아왔을 때 그대로 남아있길 원한다.
- B2C 구매자(회원)로서, 모바일에서 장바구니에 담은 아이템을 PC 브라우저에서도 동일하게 보고 결제할 수 있길 원한다.
- B2C 구매자로서, 장바구니에서 미리보기 썸네일과 옵션 요약(사이즈/색상/매트/인화지/수량/가격)을 한눈에 보고 싶다.
- B2C 구매자로서, 장바구니에서 수량을 +/- 버튼으로 조정하고, 가격이 자동 갱신되길 원한다.
- B2C 구매자로서, 장바구니 아이템을 삭제할 수 있길 원한다.
- B2C 구매자(비회원)로서, 결제 직전 로그인하면 LocalStorage의 cart 아이템이 자동으로 내 계정과 합쳐지길 원한다.
- B2C 구매자로서, 장바구니 총액(아이템 합계 + 배송비 placeholder)을 보고 체크아웃으로 진입하고 싶다.
- 운영자로서, 결제 후에는 cart_items가 비워지고 order_items에 스냅샷이 보관되길 원한다.

## Acceptance Criteria
1. **GIVEN** 사용자가 편집기에서 "장바구니 담기"를 누른다 **WHEN** `addToCart(cartItem)`이 호출된다 **THEN** 비로그인 시 LocalStorage 키 `frameshop.cart.v1`에 직렬화 저장되고, 로그인 시 `cart_items` 테이블에 insert + LocalStorage도 mirror 저장한다.
2. **GIVEN** `cartItem`은 `{ productId, variantId, options, photoUrl, cropTransform, previewUrl, price, quantity }`를 모두 포함한다 **WHEN** 직렬화/역직렬화한다 **THEN** 라운드트립 후 모든 필드가 보존되어야 한다 (PLAN.md UT-07).
3. **GIVEN** LocalStorage에 3개 아이템이 저장되어 있고 사용자가 로그인한다 **WHEN** `syncCartOnLogin(userId)`가 호출된다 **THEN** 3개 아이템이 `cart_items` 테이블에 insert되고, LocalStorage는 비워지지 않고 그대로 유지(다중 디바이스 대비) — 단, 중복 방지 키(`local_id`)로 동일 아이템 중복 insert 방지.
4. **GIVEN** 회원 사용자의 `cart_items`에 5개 아이템이 있다 **WHEN** `getCart()`를 호출한다 **THEN** DB에서 5개를 가져와 `CartItem[]`로 반환하며, 각 아이템에 변형 스냅샷과 미리보기 URL이 포함된다.
5. **GIVEN** 비회원 사용자 **WHEN** `getCart()`를 호출한다 **THEN** LocalStorage에서 읽어 동일 형식으로 반환한다. LocalStorage 비어있으면 빈 배열.
6. **GIVEN** 사용자가 cart UI에서 수량을 1→3으로 변경한다 **WHEN** `updateQuantity(cartItemId, 3)`을 호출한다 **THEN** 해당 아이템 quantity 갱신, 총 가격(`price * quantity`)이 재계산되어 UI에 표시된다.
7. **GIVEN** 사용자가 삭제 버튼을 클릭한다 **WHEN** `removeFromCart(cartItemId)`가 호출된다 **THEN** LocalStorage 또는 DB에서 해당 항목 제거. 미리보기 Storage 파일은 즉시 삭제하지 않음(주문 실패 복구 대비).
8. **GIVEN** 결제 완료 직후 (M-Order로부터 콜백) **WHEN** `clearCart(itemIds)`가 호출된다 **THEN** 해당 아이템들이 LocalStorage/DB 양쪽에서 제거된다.
9. **GIVEN** 미리보기 PNG가 Supabase Storage `previews/<sessionId>/<uuid>.png`에 업로드된 상태 **WHEN** cart insert 한다 **THEN** `previewUrl`은 public URL 또는 signed URL로 저장된다. 자율 결정: Phase 1은 public bucket (M-Photo와 동일 정책).
10. **GIVEN** 동일 variant + 동일 photo + 동일 cropTransform 조합의 아이템이 이미 cart에 있다 **WHEN** `addToCart`를 다시 호출한다 **THEN** 새 아이템으로 추가(자동 병합 안 함) — 사용자가 의도적으로 한 번 더 담은 경우를 존중. 단, UI에서는 동일 아이템 그룹화 표시 가능(컴포넌트 책임).
11. **GIVEN** LocalStorage 용량 초과(5MB) **WHEN** addToCart가 시도된다 **THEN** quota error를 catch하여 "장바구니가 가득 찼습니다" 안내 후 가장 오래된 아이템 자동 제거 옵션 제공 (자율 결정).
12. **GIVEN** cart에 5개 아이템이 있다 **WHEN** `getCartSummary()`를 호출한다 **THEN** `{ itemCount, subtotal, totalQuantity }` 객체가 반환된다. 배송비는 M-Checkout에서 계산(여기선 제외).

## Edge Cases
- **LocalStorage 차단 브라우저(시크릿 모드 일부):** try/catch로 감싸고 메모리 fallback (Zustand cartStore 자체에만 저장, 새로고침 시 손실 안내).
- **LocalStorage 스키마 변경:** 키에 버전(`v1`) 포함. 다른 버전은 무시/마이그레이션.
- **변형 가격 변경:** 사용자가 장바구니에 담은 후 어드민이 가격을 바꿔도 cartItem.price는 담은 시점 기준. 단, 체크아웃 진입 시 한 번 변형 재조회하여 가격 불일치를 경고 표시(Phase 2). Phase 1은 담은 시점 가격으로 결제.
- **변형 단종/비활성:** `is_active=false`된 variant가 cart에 있는 채로 체크아웃 → 결제 차단 + "판매가 종료된 상품입니다" 안내. M-Order가 검증.
- **미리보기 URL 만료/삭제:** `previews` bucket의 파일이 삭제된 경우 cart 카드 썸네일 onError → 플레이스홀더 표시. cart 아이템은 유지(주문은 가능, 인쇄용 재렌더링은 cropTransform + photoUrl 기반).
- **multi-tab sync:** LocalStorage `storage` 이벤트 리스닝으로 다른 탭에서 cart 변경 시 현재 탭도 갱신. Phase 2.
- **로그아웃 시:** DB cart는 그대로 유지(다음 로그인 시 복원). LocalStorage cart는 보존(다른 비회원 세션과 합쳐질 수 있음 — 의도적 동작).
- **동기화 충돌:** LocalStorage와 DB cart가 모두 비어있지 않은 채로 로그인 → 합집합으로 병합(중복은 `local_id` 키로 제거).
- **사진 원본 만료:** `photos.original_url`은 영구. M-Photo가 보장. cart는 photoUrl만 보관.
- **자율 결정:** `local_id`는 클라이언트 UUID로 생성하여 LocalStorage와 DB 양쪽에서 dedup key로 사용 (Architect가 cart_items 테이블에 컬럼 추가 필요 검토).

## Out of Scope
- **다중 디바이스 실시간 sync (websocket)** — Phase 3.
- **위시리스트(찜)** — Phase 3.
- **저장 후 편집 재진입** — Phase 2.
- **수량별 할인 / 쿠폰** — Phase 3.
- **재고 실시간 확인** — Phase 2.
- **장바구니 공유 URL** — Out of Scope.
- **자동 가격 갱신 알림** — Phase 2.
- **장바구니 분석/추천** — Phase 3.

## Dependencies
- **Depends on:**
  - LocalStorage API (브라우저 표준)
  - Supabase 테이블: `cart_items` (PLAN.md §6, RLS: 본인만)
  - Supabase Storage: `previews` bucket (편집기에서 업로드된 PNG)
  - `src/types/cart.ts` — `CartItem`, `CartSummary` (Architect 신규)
  - `src/types/product.ts` — `ProductVariant`, `SelectedOptions`
  - `src/types/editor.ts` — `CropTransform`
  - M-Editor (CartItem payload 생성)
  - Supabase Auth (로그인 상태 감지)
- **Used by:**
  - M-Checkout (cart 아이템을 주문서로 변환)
  - M-Order (`order_items.variant_snapshot`에 스냅샷 복사)
  - 페이지: `app/(shop)/cart/page.tsx`

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다.

- **CartItem 구조 (직렬화 가능):**
  ```
  {
    localId: string;            // 클라이언트 UUID (dedup key)
    productId: string;
    variantId: string;
    options: SelectedOptions;    // { size, color, matte, paper }
    photoUrl: string;            // Supabase Storage path
    cropTransform: CropTransform;
    previewUrl: string;          // 미리보기 PNG URL
    price: number;               // 담은 시점 변형 가격
    quantity: number;            // 1~99
    createdAt: string;           // ISO timestamp
  }
  ```

- `addToCart(item: Omit<CartItem, 'localId' | 'createdAt'>): Promise<CartItem>`
  - **동작:** localId/createdAt 자동 부여 → 비회원: LocalStorage 추가, 회원: DB insert + LocalStorage mirror.
  - **반환:** 부여된 ID 포함한 CartItem.

- `getCart(): Promise<CartItem[]>`
  - **동작:** 로그인 상태에 따라 LocalStorage 또는 DB 조회. 정렬: `createdAt DESC`.

- `updateQuantity(localId: string, quantity: number): Promise<void>`
  - **검증:** `1 <= quantity <= 99`. 초과 시 클램프 + 경고.

- `removeFromCart(localId: string): Promise<void>`
  - **동작:** 양쪽 저장소에서 제거. Storage 미리보기 파일은 즉시 삭제 X.

- `clearCart(localIds?: string[]): Promise<void>`
  - **동작:** localIds 지정 시 해당만, 미지정 시 전체 삭제. M-Order의 결제 완료 콜백에서 호출.

- `syncCartOnLogin(userId: string): Promise<{ added: number; skipped: number }>`
  - **동작:** LocalStorage 아이템을 DB로 upsert(localId 충돌 시 skip). 결과 통계 반환.

- `serializeCartItem(item: CartItem): string` / `deserializeCartItem(json: string): CartItem`
  - **TDD 2순위 (PLAN.md UT-07):** 라운드트립 무결성 보장. Zod 스키마로 검증.

- `getCartSummary(items: CartItem[]): CartSummary`
  - **CartSummary:** `{ itemCount: number; totalQuantity: number; subtotal: number }`
  - **순수 함수.**

- `cartStore` (Zustand, 선택적):
  - 동기화된 캐시 + `addToCart`/`removeFromCart` 액션 wrap.
  - 페이지 컴포넌트는 store만 구독.

## Test Scenarios

### Unit (Vitest)
- `serializeCartItem` → `deserializeCartItem` 라운드트립 무결.
- `getCartSummary`: 3개 아이템 (각각 qty 1,2,3, 가격 5000원) → subtotal 30000, itemCount 3, totalQuantity 6.
- `updateQuantity`: 100 입력 → 99로 클램프.
- `updateQuantity`: 0 또는 음수 → throw 또는 1로 클램프(자율, 둘 중 선택 후 문서화).
- LocalStorage 비어있을 때 `getCart` → 빈 배열.
- 동일 localId가 두 번 insert되지 않음(dedup 검증).
- 직렬화 시 cropTransform 객체가 평면 JSON으로 보존.

### Integration (Testing Library + Supabase mock)
- 비회원 → addToCart → LocalStorage에 저장 → 새로고침 후 `getCart` 동일 결과.
- 회원 로그인 시 `syncCartOnLogin` 자동 트리거 → DB와 LocalStorage 양쪽에 아이템 존재.
- cart 페이지 렌더 → 썸네일/옵션/가격/수량 컨트롤 가시.
- 수량 +/- 클릭 → 가격 즉시 갱신.
- 삭제 버튼 클릭 → 아이템 사라짐.

### E2E (Playwright)
- **E2E-Cart-01 (비회원):** 편집기 → 장바구니 담기 → /cart 진입 → 아이템 1건 표시.
- **E2E-Cart-02:** 비회원이 cart에 2건 담은 후 회원가입/로그인 → 자동 sync → DB에 2건 존재.
- **E2E-Cart-03:** 수량 변경 시 subtotal 갱신.
- **E2E-Cart-04:** 새 탭에서 같은 비회원 세션으로 진입 시 동일 cart 표시 (LocalStorage 공유).
- **E2E-Cart-05:** 결제 완료 후 자동으로 cart 비워짐.
- **E2E-Cart-06:** LocalStorage 차단 환경(시크릿 모드)에서도 메모리 fallback으로 동일 세션 내 cart 동작.
