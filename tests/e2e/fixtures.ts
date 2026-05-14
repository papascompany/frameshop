import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

// 환경변수에서 관리자 계정 정보 (skip 조건용)
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
export const hasAdminCreds = !!ADMIN_EMAIL && !!ADMIN_PASSWORD;

// 로그인 헬퍼 (skip된 테스트에서 사용 예정)
export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/admin|\/$/, { timeout: 15_000 });
}

export { base as test };
