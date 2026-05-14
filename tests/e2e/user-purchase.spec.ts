/**
 * E2E-01/02: 구매 플로우
 * - 스모크 레벨: DB 없이 페이지 로드만 확인
 * - 풀 플로우: DB + Toss test 환경 필요 → test.skip
 */
import { test, expect } from '@playwright/test';

test.describe('User Purchase — 구매 흐름', () => {
  test('상품 카탈로그 → 상품 상세 이동', async ({ page }) => {
    await page.goto('/catalog/basic-frame');
    // 상품 카드가 1개 이상 존재하면 클릭, 없으면 페이지 로드만 확인
    const productCards = page.locator('a[href^="/product/"]');
    const count = await productCards.count();
    if (count > 0) {
      await productCards.first().click();
      await expect(page).toHaveURL(/\/product\//);
    } else {
      // 상품 미등록 상태 — 페이지 자체는 정상 렌더링
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('카트 페이지 접근 가능', async ({ page }) => {
    await page.goto('/cart');
    await expect(page).not.toHaveURL(/error/);
  });

  test.skip('전체 구매 플로우 (guest): 랜딩 → 편집기 → 카트 → 결제 → 완료', async ({ page }) => {
    // Requires: seeded product, Toss test mode keys in env
    // 1. 랜딩 진입
    await page.goto('/');
    // 2. 상품 카드 클릭
    // 3. 상품 상세 → 주문하기
    // 4. 편집기: 사진 업로드 → 옵션 선택 → 장바구니
    // 5. 체크아웃: 배송지 입력 (카카오 우편번호 API)
    // 6. 결제 (Toss test card: 4242-4242-4242-4242)
    // 7. 결제 완료 → /order/success
  });

  test.skip('회원 가입 → 로그인 → 주문 내역 확인', async ({ page }) => {
    // Requires: Supabase auth, seeded order
  });
});
