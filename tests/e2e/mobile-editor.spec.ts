import { test, expect } from '@playwright/test';

test.describe('Mobile Editor (375px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('스튜디오 경로가 productId 없이 접근 시 페이지 렌더링', async ({ page }) => {
    // productId 없이 /studio/test 접근 → 안내 메시지 또는 정상 렌더링
    await page.goto('/studio/test-session');
    await expect(page.locator('body')).toBeVisible();
  });

  test.skip('모바일: 사진 업로드 → 편집기 진입 → 프레임 색상 변경', async ({ page }) => {
    // Requires: seeded product with frame assets
    // 1. /product/[id] → 주문하기
    // 2. 사진 업로드 (파일 선택)
    // 3. 편집기 색상 탭 클릭 → 프레임 변경 확인
  });

  test.skip('모바일: 핀치 줌 cropTransform.scale 업데이트', async ({ page }) => {
    // Requires: Konva canvas + touch event simulation
    // Playwright touch API로 구현 필요
  });
});
