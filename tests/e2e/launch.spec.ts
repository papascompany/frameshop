/**
 * 런칭 스모크 E2E — 정식 오픈 당일·배포 후 반복 실행.
 *
 * 실행 조건: `E2E_BASE_URL` 이 있을 때만(없으면 전체 skip).
 *   E2E_BASE_URL=https://frameshop-snowy.vercel.app \
 *   PLAYWRIGHT_BASE_URL=https://frameshop-snowy.vercel.app \
 *   npx playwright test tests/e2e/launch.spec.ts
 * `PLAYWRIGHT_BASE_URL` 도 같은 값으로 주면 playwright.config.ts 가 외부 대상으로
 * 인식해 로컬 `npm run dev` webServer 를 띄우지 않는다.
 *
 * 기본 시나리오는 읽기 전용: 홈 → 카탈로그 → 상품 상세 → 빈 장바구니.
 * config 의 두 프로젝트를 그대로 쓴다 — mobile-chromium 은 375px 로 좁혀서,
 * desktop-chromium 은 config 뷰포트(1280px) 그대로.
 *
 * `E2E_ALLOW_WRITES=1` 일 때만 쓰기 시나리오(사진 업로드 → 장바구니 담기 →
 * 체크아웃 폼 입력)를 실행하고, 결제 버튼은 누르지 않는다(주문 생성·Toss 결제창
 * 진입 금지). 프로덕션 대상으로는 켜지 않는다.
 */
import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? '';
const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === '1';
const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;

if (BASE_URL) {
  // Accept-Language 로 locale 이 결정되므로(기본 en-US → 영어 UI) 한국어로 고정한다.
  test.use({ baseURL: BASE_URL, locale: 'ko-KR' });
}

interface PageHealth {
  consoleErrors: string[];
  pageErrors: string[];
  serverErrors: string[];
  /** 동일 origin 4xx — "Failed to load resource" 콘솔 에러의 원인 URL 진단용. */
  clientErrors: string[];
}

/** 콘솔 에러·미처리 예외·동일 origin 4xx/5xx 응답을 수집한다. */
function watchHealth(page: Page): PageHealth {
  const health: PageHealth = {
    consoleErrors: [],
    pageErrors: [],
    serverErrors: [],
    clientErrors: [],
  };
  const origin = new URL(BASE_URL).origin;
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      health.consoleErrors.push(`${page.url()} :: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    health.pageErrors.push(`${page.url()} :: ${err.message}`);
  });
  page.on('response', (res) => {
    if (!res.url().startsWith(origin)) return;
    if (res.status() >= 500) {
      health.serverErrors.push(`${res.status()} ${res.url()}`);
    } else if (res.status() >= 400) {
      health.clientErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return health;
}

function expectHealthy(health: PageHealth): void {
  expect(health.pageErrors, 'uncaught page errors').toEqual([]);
  expect(
    health.consoleErrors,
    `console errors (same-origin 4xx: ${health.clientErrors.join(', ') || 'none'})`,
  ).toEqual([]);
  expect(health.serverErrors, 'same-origin 5xx responses').toEqual([]);
}

async function useLaunchViewport(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name.startsWith('mobile')) {
    await page.setViewportSize(MOBILE_VIEWPORT);
  }
}

/** 현재 뷰포트에서 보이는 첫 링크(데스크톱 헤더 / 모바일 하단 내비 차이 흡수). */
function visibleLink(page: Page, href: string) {
  return page.locator(`a[href="${href}"]:visible`).first();
}

async function openFirstProduct(page: Page): Promise<void> {
  const cards = page.locator('main a[href^="/product/"]:visible');
  await expect(cards.first(), 'catalog has at least one product card').toBeVisible();
  await cards.first().click();
  await expect(page).toHaveURL(/\/product\/[^/?#]+/);
  await expect(page.locator('h1').first()).toBeVisible();
}

test.describe('Launch smoke — 읽기 전용', () => {
  test.skip(!BASE_URL, 'E2E_BASE_URL 미설정 — 런칭 스모크 건너뜀');

  test('홈 → 카탈로그 → 상품 상세 → 빈 장바구니', async ({ page }, testInfo) => {
    await useLaunchViewport(page, testInfo);
    const health = watchHealth(page);

    // 홈
    const home = await page.goto('/');
    expect(home?.status(), 'GET / status').toBe(200);
    await expect(page).toHaveTitle(/FrameShop/);
    await expect(page.locator('header').first()).toBeVisible();
    await expect(page.locator('main').first()).toBeVisible();

    // 카탈로그
    await visibleLink(page, '/catalog/basic-frame').click();
    await expect(page).toHaveURL(/\/catalog\/basic-frame/);
    await expect(page.locator('h1, h2').first()).toBeVisible();

    // 상품 상세
    await openFirstProduct(page);
    await expect(
      page.getByRole('button', { name: '내 사진으로 만들기' }),
      'editor CTA visible on product detail',
    ).toBeVisible();

    // 장바구니(새 컨텍스트 → 빈 상태)
    await visibleLink(page, '/cart').click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { level: 1, name: '장바구니' })).toBeVisible();
    await expect(page.getByText('장바구니가 비어있습니다.')).toBeVisible();

    expectHealthy(health);
  });
});

test.describe('Launch smoke — 쓰기(옵트인)', () => {
  test.skip(!BASE_URL, 'E2E_BASE_URL 미설정 — 런칭 스모크 건너뜀');
  test.skip(!ALLOW_WRITES, 'E2E_ALLOW_WRITES=1 일 때만 실행');

  test('사진 업로드 → 장바구니 담기 → 체크아웃 입력(결제 직전 정지)', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await useLaunchViewport(page, testInfo);
    const health = watchHealth(page);

    // 결제 경계 감시: 주문 생성 POST·Toss 호출이 한 번이라도 나가면 실패.
    const forbidden: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('tosspayments.com') || (req.method() === 'POST' && url.includes('/api/orders'))) {
        forbidden.push(`${req.method()} ${url}`);
      }
    });

    await page.goto('/catalog/basic-frame');
    await openFirstProduct(page);
    await page.getByRole('button', { name: '내 사진으로 만들기' }).click();
    await expect(page).toHaveURL(/\/studio\//);

    // 업로드할 테스트 이미지(2400x1800 PNG)를 브라우저 캔버스로 만든다.
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 2400;
      canvas.height = 1800;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#d9c6a5');
      grad.addColorStop(1, '#3b5b7a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    });
    const buffer = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'launch-smoke.png',
      mimeType: 'image/png',
      buffer,
    });

    const addToCart = page.getByRole('button', { name: /^장바구니 담기/ }).locator('visible=true').first();
    await expect(addToCart).toBeEnabled({ timeout: 60_000 });
    await addToCart.click();
    await expect(page).toHaveURL(/\/cart$/, { timeout: 60_000 });
    await expect(page.locator('[data-testid="cart-group"]').first()).toBeVisible();

    // 체크아웃
    await page.getByRole('button', { name: /^결제하기/ }).locator('visible=true').first().click();
    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByLabel('이름', { exact: true }).fill('런칭스모크');
    await page.getByLabel('전화번호', { exact: true }).first().fill('01000000000');
    await page.getByLabel('이메일', { exact: true }).fill('launch-smoke@example.com');
    const sameAsOrderer = page.getByLabel('주문인과 동일');
    if (await sameAsOrderer.isVisible()) {
      await sameAsOrderer.check();
      await page.getByLabel('상세 주소', { exact: true }).fill('스모크 테스트');
    }
    // 우편번호·주소는 카카오 우편번호 팝업(외부) 전용 readOnly 입력이라 채우지 않는다.
    await page.getByTestId('agree-privacy').check();
    await page.getByTestId('agree-purchase').check();

    // 결제 버튼 직전에서 정지 — 보이고 활성화됐는지만 확인하고 누르지 않는다.
    const pay = page.getByRole('button', { name: '결제하기', exact: true }).locator('visible=true').first();
    await expect(pay).toBeVisible();
    await expect(pay).toBeEnabled();

    expect(forbidden, 'no order creation / Toss requests').toEqual([]);
    expectHealthy(health);
  });
});
