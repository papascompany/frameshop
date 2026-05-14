import { test, expect } from '@playwright/test';

test.describe('Admin Management', () => {
  test('/admin 미인증 → /login 리다이렉트', async ({ page }) => {
    await page.goto('/admin');
    // 리다이렉트 후 최종 URL이 /login 포함
    await expect(page).toHaveURL(/login/);
  });

  test('/admin/products 미인증 → /login 리다이렉트', async ({ page }) => {
    await page.goto('/admin/products');
    await expect(page).toHaveURL(/login/);
  });

  test('/admin/orders 미인증 → /login 리다이렉트', async ({ page }) => {
    await page.goto('/admin/orders');
    await expect(page).toHaveURL(/login/);
  });

  test.skip('관리자 로그인 후 상품 등록 → 카탈로그 노출', async ({ page }) => {
    // Requires: admin account credentials in env (E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD)
    // 1. /login → 관리자 계정 로그인
    // 2. /admin/products → "상품 등록" 클릭
    // 3. 상품명/카테고리/가격 입력 → 저장
    // 4. /catalog/basic-frame → 등록한 상품 카드 노출 확인
  });

  test.skip('관리자 배송비 변경', async ({ page }) => {
    // Requires: admin account
    // /admin/shipping → 요금 수정 → 저장 → 반영 확인
  });

  test.skip('관리자 주문 상태 전환 (PAID → IN_PRODUCTION)', async ({ page }) => {
    // Requires: admin account + seeded PAID order
  });
});
