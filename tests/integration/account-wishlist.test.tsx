/**
 * <WishlistClient> — FS-X-06 위시리스트 마이페이지.
 *
 * 고정하는 계약:
 *  1. available=false(마이그 041 미적용)면 안내만 렌더(42703/42P01 비노출).
 *  2. 판매종료(isActive=false) 상품은 배지 + 상품 링크 비활성.
 *  3. 제거는 낙관 업데이트 — 응답 전 목록에서 즉시 사라진다.
 *  4. 제거 실패 시 원상 복구 + 에러 안내.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WishlistClient } from '@/app/(shop)/account/wishlist/WishlistClient';
import koMessages from '@/messages/ko.json';
import { asBrand } from '@/types/common';
import type { ProductId, WishlistItemId } from '@/types/common';
import type { WishlistEntry } from '@/lib/db/wishlists';

function entry(
  id: string,
  productId: string,
  overrides: Partial<NonNullable<WishlistEntry['product']>> = {},
): WishlistEntry {
  return {
    id: asBrand<WishlistItemId>(id),
    productId: asBrand<ProductId>(productId),
    createdAt: '2026-07-17T00:00:00Z',
    product: {
      name: `상품 ${id}`,
      basePrice: 12000,
      isActive: true,
      thumbnail: null,
      ...overrides,
    },
  };
}

function renderClient(items: WishlistEntry[], available = true) {
  return render(
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      <WishlistClient available={available} initialItems={items} />
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
});

describe('<WishlistClient>', () => {
  it('available=false 면 안내만 렌더한다(probe 게이트)', () => {
    renderClient([entry('w1', 'p1')], false);
    expect(
      screen.getByText(/위시리스트 기능이 아직 활성화되지 않았습니다/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('wishlist-grid')).not.toBeInTheDocument();
  });

  it('판매종료 상품은 배지를 달고 상품 링크를 노출하지 않는다', () => {
    renderClient([
      entry('w1', 'p1'),
      entry('w2', 'p2', { isActive: false, name: '단종 액자' }),
    ]);
    const items = screen.getAllByTestId('wishlist-item');
    expect(items).toHaveLength(2);
    expect(screen.getAllByText('판매 종료').length).toBeGreaterThan(0);
    // 활성 상품에만 "상품 보기" 링크가 있다.
    expect(screen.getAllByRole('link', { name: '상품 보기' })).toHaveLength(2); // 썸네일 + 텍스트
  });

  it('제거는 낙관 업데이트 — 응답 전 목록에서 즉시 사라진다', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderClient([entry('w1', 'p1'), entry('w2', 'p2')]);
    expect(screen.getAllByTestId('wishlist-item')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: '제거' })[0]!);
    // 서버 응답 전에 이미 목록에서 제거.
    expect(screen.getAllByTestId('wishlist-item')).toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/account/wishlist');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ productId: 'p1' });

    resolveFetch(jsonResponse({ ok: true }));
    await waitFor(() =>
      expect(screen.getAllByTestId('wishlist-item')).toHaveLength(1),
    );
  });

  it('제거 실패 시 목록이 원상 복구되고 에러가 표시된다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, code: 'DB_ERROR' }, 500),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderClient([entry('w1', 'p1'), entry('w2', 'p2')]);
    fireEvent.click(screen.getAllByRole('button', { name: '제거' })[0]!);

    await waitFor(() =>
      expect(screen.getAllByTestId('wishlist-item')).toHaveLength(2),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      '제거하지 못했습니다',
    );
  });

  it('빈 위시리스트는 빈 상태 + 둘러보기 링크를 렌더한다', () => {
    renderClient([]);
    expect(
      screen.getByText('위시리스트에 담긴 상품이 없습니다.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '상품 둘러보기' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
