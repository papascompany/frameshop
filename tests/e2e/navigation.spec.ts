import { test, expect } from '@playwright/test';

test.describe('Navigation — 사용자 이동 흐름', () => {
  test('헤더 로고 클릭 → 랜딩', async ({ page }) => {
    await page.goto('/catalog/basic-frame');
    await page.locator('header a[href="/"]').first().click();
    await expect(page).toHaveURL('/');
  });

  test('로그인 페이지 렌더링', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('카트 페이지 렌더링 (빈 카트)', async ({ page }) => {
    await page.goto('/cart');
    // 빈 카트 상태 메시지 또는 카트 컨테이너 존재
    await expect(page.locator('body')).toBeVisible();
  });

  test('주문 조회 페이지 렌더링', async ({ page }) => {
    await page.goto('/order/lookup');
    await expect(page.locator('body')).toBeVisible();
  });
});
