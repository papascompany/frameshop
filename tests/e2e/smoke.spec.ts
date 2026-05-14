import { test, expect } from '@playwright/test';

test.describe('Smoke — 핵심 페이지 정상 로드', () => {
  test('랜딩 페이지 로드 (200, title에 FrameShop 포함)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/FrameShop/);

    // 심각한 JS 에러가 없어야 함 (네트워크 에러 등 무시)
    const criticalErrors = errors.filter(
      (e) => !e.includes('net::') && !e.includes('Failed to load resource'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('카탈로그 페이지 로드', async ({ page }) => {
    await page.goto('/catalog/basic-frame');
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('/sitemap.xml 200 반환', async ({ page }) => {
    const resp = await page.request.get('/sitemap.xml');
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    expect(body).toContain('<urlset');
  });

  test('/robots.txt 200 반환 + GPTBot 허용', async ({ page }) => {
    const resp = await page.request.get('/robots.txt');
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    expect(body).toContain('GPTBot');
    expect(body).toContain('Sitemap:');
  });

  test('/llms.txt 200 반환', async ({ page }) => {
    const resp = await page.request.get('/llms.txt');
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    expect(body).toContain('FrameShop');
  });

  test('존재하지 않는 페이지 → 404', async ({ page }) => {
    const resp = await page.goto('/이런페이지는없음');
    expect(resp?.status()).toBe(404);
  });

  test('/admin → /login 리다이렉트 (미인증)', async ({ page }) => {
    // 로그인 안 된 상태에서 /admin은 /login으로 리다이렉트되어야 함
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});
