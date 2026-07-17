/**
 * 카탈로그 그리드 × 위시리스트 하트 — FS-X-06 후속(카탈로그 와이어링).
 *
 * 고정하는 계약:
 *  1. 카탈로그 렌더 시 카드마다 하트(wishlistSlot 오버레이)가 렌더된다.
 *  2. 하트 N개여도 WishlistHydrator 배치 GET ?productIds= 는 **1회** —
 *     그리드 전체 productIds 가 그대로 전달된다.
 *  3. 배치 응답의 wishlisted 부분집합이 각 하트 상태(aria-pressed)에 반영된다.
 *  4. 빈 카탈로그면 Hydrator 미장착 — fetch 0회.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import koMessages from '@/messages/ko.json';
import { asBrand } from '@/types/common';
import type { CategoryId, ProductId } from '@/types/common';
import type { ProductListItem, ProductListResult } from '@/types/product';

const { pushMock, getProductsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getProductsMock: vi.fn<() => Promise<ProductListResult>>(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/catalog/basic-frame',
}));

// 서버 전용 supabase 경로 차단 — 페이지가 조회하는 카탈로그 데이터를 대체.
vi.mock('@/lib/db/catalog', () => ({
  getProductsByCategory: getProductsMock,
  getCategories: vi.fn(async () => []),
}));

import CatalogPage from '@/app/(shop)/catalog/[slug]/page';

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_C = '33333333-3333-4333-8333-333333333333';

function item(id: string, name: string): ProductListItem {
  return {
    id: asBrand<ProductId>(id),
    categoryId: asBrand<CategoryId>('c1'),
    name,
    tagline: '테스트 태그라인',
    description: '설명',
    basePrice: 19000,
    hasFrame: true,
    isActive: true,
    sortOrder: 0,
    bleedMm: 0,
    createdAt: '2026-07-01T00:00:00Z',
    thumbnail: null,
  };
}

function listResult(items: ProductListItem[]): ProductListResult {
  return { items, total: items.length, hasMore: false, page: 1, pageSize: 20 };
}

async function renderCatalog() {
  const jsx = await CatalogPage({
    params: Promise.resolve({ slug: 'basic-frame' }),
    searchParams: Promise.resolve({}),
  });
  return render(
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      {jsx}
    </NextIntlClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockReset();
  getProductsMock.mockReset();
});

describe('catalog grid × wishlist heart', () => {
  it('카드마다 하트가 렌더되고 배치 GET 은 그리드 전체 productIds 로 1회만 나간다', async () => {
    getProductsMock.mockResolvedValue(
      listResult([
        item(PRODUCT_A, '액자 A'),
        item(PRODUCT_B, '액자 B'),
        item(PRODUCT_C, '액자 C'),
      ]),
    );
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, wishlisted: [PRODUCT_B] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await renderCatalog();

    const hearts = screen.getAllByTestId('wishlist-heart');
    expect(hearts).toHaveLength(3);

    // 배치 하이드레이션 반영 — B만 위시 상태.
    await waitFor(() =>
      expect(hearts[1]).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(hearts[0]).toHaveAttribute('aria-pressed', 'false');
    expect(hearts[2]).toHaveAttribute('aria-pressed', 'false');

    // 요청 수 계약 — 하트 3개여도 fetch 1회, productIds 전체 전달.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(decodeURIComponent(url)).toBe(
      `/api/account/wishlist?productIds=${PRODUCT_A},${PRODUCT_B},${PRODUCT_C}`,
    );
  });

  it('카드는 단일 Link 를 유지하고 하트는 Link 형제 오버레이로 렌더된다', async () => {
    getProductsMock.mockResolvedValue(listResult([item(PRODUCT_A, '액자 A')]));
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, wishlisted: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await renderCatalog();

    const heart = screen.getByTestId('wishlist-heart');
    // 버튼 중첩 금지 계약 — 하트가 <a> 조상 안에 있으면 안 된다.
    expect(heart.closest('a')).toBeNull();
    expect(
      screen.getByRole('link', { name: /액자 A/ }),
    ).toHaveAttribute('href', `/product/${PRODUCT_A}`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('빈 카탈로그면 Hydrator 미장착 — fetch 0회 + 빈 상태 렌더', async () => {
    getProductsMock.mockResolvedValue(listResult([]));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await renderCatalog();

    expect(screen.queryAllByTestId('wishlist-heart')).toHaveLength(0);
    expect(
      screen.getByText('곧 새로운 상품이 등록됩니다'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
