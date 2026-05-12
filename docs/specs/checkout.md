# Module: Checkout

## Purpose
M-Checkout은 장바구니 아이템을 주문서로 변환하는 단계의 책임을 진다. 사용자에게 주문인 정보(이름/전화/이메일)와 배송지(우편번호 검색 + 주소1 + 상세주소 + 배송 메모)를 입력받고, "주문인과 동일" 토글과 "이전 배송지" 단축 옵션을 제공한다. 모든 입력은 클라이언트(Zod) + 서버 양쪽에서 검증한다. 폼 제출 시 M-Order의 `createOrder(items, address)`에 위임하고, 성공 시 결제 단계(M-Payment)로 라우팅한다. Phase 1은 카카오 우편번호 API를 mock으로 처리하고, Phase 2에서 정식 연동한다. 비회원/회원 모두 동일 폼을 사용하며 회원은 이전 주문 배송지를 단축으로 제공한다.

## User Stories
- B2C 구매자로서, 장바구니에서 "결제하기"를 누르면 주문서 화면에서 주문인과 배송지를 명확히 구분된 섹션으로 입력하고 싶다.
- B2C 구매자로서, 주문인 이름/전화/이메일을 입력한 후 "주문인과 동일" 체크박스로 배송지 정보를 자동 채우고 싶다.
- B2C 구매자(회원)로서, 이전에 입력한 배송지가 있다면 클릭 한 번으로 불러와 입력 시간을 줄이고 싶다.
- B2C 구매자로서, 우편번호 검색 버튼을 누르면 카카오 우편번호 팝업이 열리고 주소가 자동 채워지길 원한다.
- B2C 구매자로서, 잘못된 전화번호 형식(010-XXXX-XXXX)이나 빈 필수 필드가 있으면 즉시 인라인 에러 메시지로 안내받고 싶다.
- B2C 구매자로서, 배송지 메모(부재 시 경비실 보관 등)를 자유 텍스트로 입력하고 싶다.
- B2C 구매자로서, 폼 작성 도중 새로고침/뒤로가기를 해도 입력값이 보존되길 원한다(자율 결정).
- B2C 구매자로서, "결제하기" 클릭 시 주문이 생성되고 결제 SDK가 열리길 원한다.
- **B2C 구매자로서, checkout 화면에서 배송 방법 3종(기본배송/직접수령/퀵배송) 중 하나를 선택하고 싶다 (ADR-008).**
- **B2C 구매자로서, 주문 금액이 무료배송 임계값 이상이면 "무료배송" 표시가 자동으로 떠서 추가 비용이 없음을 즉시 알고 싶다.**
- **B2C 구매자로서, 직접수령(PICKUP)을 선택하면 픽업 장소 안내가 표시되고 배송지 입력이 비활성화되길 원한다.**
- **B2C 구매자로서, 퀵배송(QUICK)을 선택하면 별도 가격이 명확히 표시되고 총액에 반영되길 원한다.**

## Acceptance Criteria
1. **GIVEN** cart에 1개 이상의 아이템이 있다 **WHEN** 사용자가 `/checkout`에 진입한다 **THEN** 주문인 섹션 / 배송지 섹션 / 결제수단 placeholder / 총액 요약(아이템 + 배송비)이 렌더된다.
2. **GIVEN** cart가 비어있다 **WHEN** `/checkout`에 직접 접근한다 **THEN** "장바구니가 비어있습니다" 안내 후 `/cart`로 리다이렉트.
3. **GIVEN** 주문인 이메일이 "abc@x"(불완전)이다 **WHEN** blur 또는 submit 한다 **THEN** Zod 검증에서 "올바른 이메일 형식이 아닙니다" 에러가 인라인 표시되고 폼 submit이 차단된다.
4. **GIVEN** 전화번호가 "010-1234"(짧음)이다 **WHEN** 검증한다 **THEN** 한국 휴대폰 형식(`^01[0-9]-\d{3,4}-\d{4}$`)에 매칭되지 않아 에러 표시. 자동 하이픈 삽입 옵션 제공(자율 결정).
5. **GIVEN** 사용자가 "주문인과 동일" 체크박스를 활성화한다 **WHEN** 클릭된다 **THEN** 배송지 이름/전화가 주문인 값으로 즉시 복사되고, 체크 해제 시 빈 칸으로 복원(또는 마지막 직접 입력값 복원 — 자율 결정: Phase 1은 빈 칸 복원).
6. **GIVEN** 회원 사용자에게 이전 배송지 1건이 저장되어 있다 **WHEN** "이전 배송지" 드롭다운을 클릭한다 **THEN** 해당 배송지가 폼에 채워진다. 비회원은 이 옵션이 보이지 않는다.
7. **GIVEN** 사용자가 우편번호 검색 버튼을 클릭한다 **WHEN** Phase 1 mock 환경 **THEN** 임시 모달에서 임의 주소 1건 선택 시 zip/addr1이 채워진다. Phase 2에서 카카오 SDK로 교체.
8. **GIVEN** 모든 필드가 유효하다 **WHEN** "결제하기" 버튼을 클릭한다 **THEN** `validateCheckoutForm(data)`이 통과하고 `createOrder(items, address)`(M-Order)가 호출되어 주문이 `CREATED` 상태로 생성된 후 `M-Payment.requestPayment(order)`가 트리거된다.
9. **GIVEN** 폼 제출 중 네트워크 오류가 발생한다 **WHEN** createOrder가 실패한다 **THEN** "주문 생성에 실패했습니다. 다시 시도해주세요" 토스트 + 버튼 활성화 복구. 중복 클릭 방지로 처리 중에는 버튼 disabled.
10. **GIVEN** 사용자가 입력 중에 페이지를 새로고침한다 **WHEN** 페이지가 재마운트된다 **THEN** sessionStorage에 임시 저장된 폼 값을 복원한다(자율 결정: Phase 1 적용. Phase 2에서 React Hook Form persist 라이브러리 검토).
11. **GIVEN** 배송 메모가 200자를 초과한다 **WHEN** 검증한다 **THEN** maxLength로 제한 + 글자 수 카운터 표시.
12. **GIVEN** 비회원 사용자 **WHEN** 결제하기 클릭 후 주문이 생성된다 **THEN** 주문 데이터에 `userId=null`로 저장되고, 주문번호 + 전화번호로 추후 조회 가능(M-Order `findOrderByGuest`).
13. **GIVEN** 배송 방법이 `STANDARD`이고 주문 금액(`subtotal`) < `free_threshold` **WHEN** 배송비가 계산된다 **THEN** `fee = shipping_methods.STANDARD.fee`(관리자 설정값, 기본 3,000원)가 총액에 반영되고 "배송비 X,000원" 표시. (ADR-008)
14. **GIVEN** 배송 방법이 `STANDARD`이고 `subtotal >= free_threshold` **WHEN** 배송비가 계산된다 **THEN** `fee = 0`이며 UI에 "무료배송" 배지 + "X,000원 이상 무료" 안내가 표시된다.
15. **GIVEN** 사용자가 `PICKUP`(직접수령)을 선택한다 **WHEN** 선택된다 **THEN** `fee = 0`, 배송지 입력 필드(zip/addr1/addr2/배송메모)가 disabled(또는 hidden)되고 `shipping_methods.PICKUP.note`(픽업 장소 안내문)가 표시된다. 주문인 정보(이름/전화/이메일)는 여전히 필수.
16. **GIVEN** 사용자가 `QUICK`(퀵배송)을 선택한다 **WHEN** 선택된다 **THEN** `fee = shipping_methods.QUICK.fee`(관리자 설정 퀵배송 가격)가 총액에 반영되고, 임계값 무료 규칙은 적용되지 않는다.
17. **GIVEN** 사용자가 배송 방법 라디오를 변경한다 **WHEN** 클릭 즉시 **THEN** 총액 요약(subtotal + shippingFee = total)이 클라이언트에서 즉시 갱신된다. 새로고침 시에도 sessionStorage에 선택된 method가 복원된다.
18. **GIVEN** checkout 진입 시 활성 배송 방법(`is_active=true`)이 N개다 **WHEN** `getShippingMethods()`가 호출된다 **THEN** 활성 방법만 `sort_order` 오름차순으로 노출된다. 기본 선택은 첫 번째(보통 STANDARD).
19. **GIVEN** 사용자가 결제하기를 클릭한다 **WHEN** `createOrder`가 호출된다 **THEN** 클라이언트에서 계산한 `shippingMethod` + `shippingFee`가 함께 전달되며, 서버는 동일 `calculateShippingFee` 함수로 재검증 후 저장(서버 사이드 검증 필수).

## Edge Cases
- **자동 하이픈:** 전화번호 입력 시 숫자만 입력해도 자동 하이픈 삽입. backspace로 자유롭게 수정 가능.
- **자동완성 충돌:** 브라우저 autocomplete가 잘못된 값을 채울 수 있음 → 주문서 필드에는 `autocomplete="name|tel|email|postal-code|address-line1|address-line2"` 명시적 지정.
- **카카오 API mock 데이터:** Phase 1 mock 배열에 5건 정도 시드. 실제 zip이 5자리(우편번호)임을 보장.
- **국가 코드:** 한국 010만 지원. 국제번호는 Phase 4 다국어 시점에 검토.
- **이름 한글/영문 혼용:** 별도 제약 없음(빈 값만 차단).
- **세션 만료:** 폼 입력 중 인증 토큰 만료 → submit 시 재로그인 모달. 입력값은 sessionStorage 보존.
- **중복 제출:** 빠른 더블 클릭 방지 위해 submit 핸들러에 `isSubmitting` 플래그 + 버튼 disabled.
- **장바구니 변경:** 체크아웃 진입 후 다른 탭에서 cart 변경 → submit 시 cart 재조회하여 차이 감지 시 경고(Phase 2). Phase 1은 진입 시점 cart 스냅샷 사용.
- **배송비 정책:** ADR-008에 따라 STANDARD/PICKUP/QUICK 3종, 관리자 설정 기반(기본 3,000원 / 30,000원 이상 무료).
- **모든 배송 방법 비활성:** 관리자가 실수로 3종 모두 `is_active=false`로 설정한 경우 → checkout이 "현재 이용 가능한 배송 방법이 없습니다. 운영자에게 문의해 주세요" 에러 표시 + 결제 버튼 disabled. 서버 액션에서도 동일 검증.
- **QUICK 지역 제한 (Phase 2 OOS):** Phase 1은 전국 단일 가격. 지역/시간대 제한(예: 서울 강남구만 가능, 14:00 이후 주문은 익일)은 Phase 2 별도 ADR.
- **임계값 = 0:** `free_threshold = 0`이면 STANDARD도 항상 무료(설정상 가능). UI에서 "무료배송" 배지 항상 표시. `null`로 설정 시 임계값 미적용(항상 정액).
- **결제 진입 후 관리자가 가격 변경:** 사용자가 checkout 페이지를 열고 있는 동안 관리자가 `shipping_methods` 가격을 변경해도, 주문 생성(`createOrder`) 시점의 값을 스냅샷으로 동결(`orders.shipping_method`, `orders.shipping_fee` 컬럼)하여 결제 금액 일관성 보장. 사용자가 새 세션으로 진입하면 새 가격 적용.
- **클라이언트/서버 값 불일치:** 클라이언트가 조작된 `shippingFee`를 보내도 서버에서 `calculateShippingFee(method, subtotal, settings)`로 재계산하여 다르면 422 반환. 클라이언트 값은 표시용에 불과.
- **PICKUP 선택 시 배송지 검증 면제:** Zod 스키마는 `shippingMethod === 'PICKUP'`이면 zip/addr1/addr2 필드 검증을 건너뛴다(주문인 이름/전화/이메일은 필수 유지).
- **결제 직전 변형 비활성화:** createOrder에서 variant `is_active=false` 감지 → 에러 반환 + 해당 아이템 강조 안내.
- **개인정보 보존:** sessionStorage에 저장된 폼 값은 결제 완료/취소 시 명시적으로 삭제.

## Out of Scope
- **다중 배송지** (한 주문을 여러 곳으로) — Out of Scope.
- **배송지 주소록 관리 페이지** — Phase 2 마이페이지.
- **결제수단 선택 UI** (카드/계좌이체/간편결제 라디오) — M-Payment 책임. 체크아웃은 결제 진입만 트리거.
- **쿠폰/포인트 적용** — Phase 3.
- **선물포장/메시지 카드** — Phase 3.
- **배송 일정 지정(예약 배송)** — Phase 3.
- **국제 배송** — Phase 4.
- **재고 실시간 확인** — Phase 2.
- **카카오 우편번호 정식 SDK** — Phase 2.
- **QUICK 배송 지역/시간대 제한** — Phase 2 (ADR-008).
- **배송 방법별 예상 도착일 표시** — Phase 2.

## Dependencies
- **Depends on:**
  - M-Cart — `getCart()`로 현재 아이템 조회
  - M-Order — `createOrder(items, address, shippingMethod)` 호출 (시그니처 ADR-008로 갱신)
  - M-Payment — 주문 생성 직후 `requestPayment(order)` 트리거
  - **`shipping_methods` 테이블 (또는 `shipping_settings` 단일 row) — Architect가 스키마 선택 (ADR-008)**
  - **M-Admin (admin/shipping) — 배송 설정의 SoT(Source of Truth). 사용자 측은 read-only**
  - Zod (검증)
  - React Hook Form (폼 상태) — PLAN.md 의존성에 추가 검토(자율 결정으로 사용 채택)
  - 카카오 우편번호 SDK (Phase 2) / mock (Phase 1)
  - Supabase Auth (회원/비회원 판별)
  - `src/types/order.ts` — `Orderer`, `ShippingAddress`, `ShippingMethod`(union), `ShippingMethodConfig`
- **Used by:**
  - 페이지: `app/(shop)/checkout/page.tsx`
  - M-Order (위임 호출)

## Interface (high-level)
> Architect가 아래 시그니처를 TypeScript로 동결한다.

- `<CheckoutForm cartItems={CartItem[]} shippingMethods={ShippingMethodConfig[]} initialData?={Partial<CheckoutFormData>} onSubmit={(data: CheckoutFormData) => Promise<void>} />`
  - **CheckoutFormData:**
    ```
    {
      orderer: { name: string; phone: string; email: string };
      shipping: {
        sameAsOrderer: boolean;
        name: string; phone: string;
        zip: string; addr1: string; addr2: string;
        memo: string;
      };
      shippingMethod: 'STANDARD' | 'PICKUP' | 'QUICK';   // ADR-008
    }
    ```
  - **동작:** 폼 상태 관리, 인라인 검증, "주문인과 동일" 토글, "이전 배송지" 드롭다운, **배송 방법 선택 라디오 + 실시간 총액 갱신**.

- `validateCheckoutForm(data: CheckoutFormData): { ok: true } | { ok: false; errors: Record<string, string> }`
  - **검증 규칙:**
    - 이름: 1~30자
    - 전화: `/^01[0-9]-\d{3,4}-\d{4}$/`
    - 이메일: Zod `.email()`
    - zip: 5자리 숫자
    - addr1: 1자 이상 100자 이내
    - addr2: 0~80자
    - memo: 0~200자
  - **TDD 2순위 (PLAN.md UT-04).**

- `createOrderFromCheckout(cartItems: CartItem[], data: CheckoutFormData): Promise<Order>`
  - **동작:** M-Order의 `createOrder`에 위임. 결과 `Order` 반환.
  - **에러:** variant 비활성, cart 비어있음 등 → 명시적 에러 throw.

- `<PostcodeSearch onSelect={(result: { zip, addr1 }) => void} />` (Phase 1: mock 모달, Phase 2: 카카오)

- `useCheckoutFormPersist(formId: string)` 훅
  - **동작:** sessionStorage에 폼 값 저장/복원. 결제 완료/취소 시 자동 삭제.

- `getPreviousShipping(userId: string): Promise<ShippingAddress | null>`
  - **동작:** 회원의 가장 최근 완료 주문의 shipping을 반환. 없으면 null.

- `getShippingMethods(): Promise<ShippingMethodConfig[]>` **(ADR-008)**
  - **동작:** `shipping_methods` 테이블에서 `is_active=true`인 항목만 `sort_order` 오름차순으로 반환.
  - **반환 타입(제안):** `{ code: 'STANDARD'|'PICKUP'|'QUICK'; label: string; fee: number; freeThreshold: number | null; note: string | null; sortOrder: number }`
  - 활성 항목이 0개면 빈 배열 반환 (UI에서 에러 처리).

- `calculateShippingFee(method: ShippingMethod, subtotal: number, settings: ShippingMethodConfig[]): number` **(ADR-008, 순수 함수, UT 대상)**
  - **동작:**
    - `PICKUP` → 항상 0
    - `STANDARD` → `subtotal >= freeThreshold` 이면 0, 아니면 `fee`. `freeThreshold === null`이면 항상 `fee`.
    - `QUICK` → 항상 `fee` (임계값 미적용)
  - **에러:** `settings`에 해당 method가 없거나 비활성이면 throw `INACTIVE_METHOD`.
  - **TDD 후보:** UT-Checkout-Shipping (PLAN.md UT 라인업에 Architect가 추가 검토).

## Test Scenarios

### Unit (Vitest, TDD 2순위)
- `validateCheckoutForm` 정상 데이터 → `{ ok: true }`.
- 전화번호 형식 오류 → errors.phone 메시지.
- 이메일 형식 오류 → errors.email 메시지.
- zip 5자리 미만 → errors.zip.
- addr1 빈 문자열 → errors.addr1.
- memo 201자 → errors.memo.
- 이름 31자 → errors.name.
- "주문인과 동일" true → shipping.name/phone 자동 복사 (헬퍼 함수 분리 시).
- **`calculateShippingFee('STANDARD', 29000, settings)` → 3000 (기본 fee).**
- **`calculateShippingFee('STANDARD', 30000, settings)` → 0 (임계값 도달).**
- **`calculateShippingFee('STANDARD', 50000, settings)` → 0 (임계값 초과).**
- **`calculateShippingFee('PICKUP', any, settings)` → 0.**
- **`calculateShippingFee('QUICK', 100000, settings)` → settings.QUICK.fee (임계값 무시).**
- **`calculateShippingFee('STANDARD', 50000, { freeThreshold: null })` → settings.STANDARD.fee (임계값 미적용).**
- **`calculateShippingFee('STANDARD', 0, { freeThreshold: 0 })` → 0 (임계값=0 항상 무료).**
- **PICKUP 선택 + 빈 zip/addr1 → validateCheckoutForm `{ ok: true }` (검증 면제).**

### Integration (Testing Library)
- `<CheckoutForm>` 렌더 → 모든 섹션 가시.
- 이메일 invalid 입력 후 blur → 에러 메시지 노출.
- "주문인과 동일" 체크 → 배송지 필드 자동 채움.
- 우편번호 mock 모달에서 주소 선택 → zip/addr1 채워짐.
- submit 클릭 → onSubmit 콜백 호출.
- 빈 cart 상태로 `/checkout` 진입 → `/cart`로 리다이렉트.
- 회원 로그인 상태 → 이전 배송지 드롭다운 노출. (PLAN.md IT-04)

### E2E (Playwright)
- **E2E-Checkout-01 (비회원):** cart 1건 → /checkout → 폼 정상 입력 → submit → 주문 생성 + 결제 SDK 호출.
- **E2E-Checkout-02:** 잘못된 전화번호 입력 → 에러 인라인 표시 → submit 차단.
- **E2E-Checkout-03:** "주문인과 동일" 토글 → 배송지 자동 채움.
- **E2E-Checkout-04 (회원):** 이전 배송지 드롭다운 → 클릭 → 폼 자동 채움.
- **E2E-Checkout-05:** 폼 작성 중 새로고침 → 입력값 복원.
- **E2E-Checkout-06:** 결제 도중 취소 → 주문은 CREATED 상태로 남고 sessionStorage는 유지.
- **E2E-Checkout-07 (ADR-008):** subtotal 25,000원에서 STANDARD 선택 → "배송비 3,000원" 표시 + 총액 28,000원.
- **E2E-Checkout-08 (ADR-008):** subtotal 35,000원에서 STANDARD 선택 → "무료배송" 배지 + 총액 35,000원.
- **E2E-Checkout-09 (ADR-008):** PICKUP 선택 → 배송지 필드 disabled + 픽업 안내 노출 + 총액 = subtotal.
- **E2E-Checkout-10 (ADR-008):** QUICK 선택 → 퀵배송 가격 표시 + 총액에 반영.
