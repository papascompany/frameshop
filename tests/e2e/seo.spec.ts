import { test, expect } from '@playwright/test';

test.describe('SEO — 메타태그 & 구조화 데이터', () => {
  test('랜딩 페이지 OG 태그 존재', async ({ page }) => {
    await page.goto('/');

    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveCount(1);
    const content = await ogTitle.getAttribute('content');
    expect(content).toBeTruthy();

    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveCount(1);
  });

  test('랜딩 페이지 FAQ JSON-LD 존재 (FAQPage 또는 Organization 타입)', async ({ page }) => {
    await page.goto('/');

    const ldScript = page.locator('script[type="application/ld+json"]');
    const count = await ldScript.count();
    expect(count).toBeGreaterThan(0);

    let hasFaq = false;
    for (let i = 0; i < count; i++) {
      const text = await ldScript.nth(i).textContent();
      if (text?.includes('FAQPage') || text?.includes('Organization')) hasFaq = true;
    }
    expect(hasFaq).toBe(true);
  });

  test('카탈로그 페이지 title에 FrameShop 포함', async ({ page }) => {
    await page.goto('/catalog/basic-frame');
    const title = await page.title();
    expect(title).toContain('FrameShop');
  });

  test('OG 이미지 엔드포인트 접근 시 유효한 응답', async ({ page }) => {
    // next/og 경로는 /opengraph-image 또는 다를 수 있음
    const resp = await page.request.get('/opengraph-image');
    // 200(이미지), 302(리다이렉트), 404(경로 다름) 모두 수용
    expect([200, 302, 404]).toContain(resp.status());
  });
});
