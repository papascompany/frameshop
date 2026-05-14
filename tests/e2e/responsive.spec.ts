import { test, expect } from '@playwright/test';

test.describe('Responsive — PC 레이아웃', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('랜딩 페이지 PC에서 정상 렌더링', async ({ page }) => {
    await page.goto('/');
    const width = await page.evaluate(() => window.innerWidth);
    expect(width).toBeGreaterThanOrEqual(1024);
    await expect(page.locator('header')).toBeVisible();
  });

  test('체크아웃 페이지 PC 렌더링', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Responsive — 모바일 레이아웃 (iPhone 12)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('랜딩 페이지 모바일에서 정상 렌더링', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
  });

  test('카탈로그 모바일에서 정상 렌더링', async ({ page }) => {
    await page.goto('/catalog/basic-frame');
    await expect(page.locator('body')).toBeVisible();
  });
});
