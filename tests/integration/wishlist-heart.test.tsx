/**
 * <WishlistHeart> + <WishlistHydrator> — FS-X-06 (ADR-026, 위시는 로그인 전용).
 *
 * 고정하는 계약:
 *  1. 클릭 = 낙관 토글 — 서버 응답 전 aria-pressed 즉시 반영, POST {productId}.
 *  2. 쓰기 실패(500) 시 롤백.
 *  3. 미로그인(401) 클릭 → /login?redirect=<현재경로> 이동 + 롤백.
 *  4. 컨텍스트/initial 없이 단독 렌더(상세 페이지)면 마운트 후 개별
 *     GET ?productIds=<id> 하이드레이션.
 *  5. WishlistHydrator 안의 하트 N개는 배치 GET **1회**로 하이드레이션된다.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WishlistHeart } from '@/components/wishlist/WishlistHeart';
import { WishlistHydrator } from '@/components/wishlist/WishlistHydrator';
import koMessages from '@/messages/ko.json';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/product/11111111-1111-4111-8111-111111111111',
}));

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_C = '33333333-3333-4333-8333-333333333333';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockReset();
});

describe('<WishlistHeart> 낙관 토글', () => {
  it('클릭 즉시 aria-pressed 가 반영되고 POST {productId} 를 보낸다', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithIntl(
      <WishlistHeart productId={PRODUCT_A} initialWishlisted={false} />,
    );

    const heart = screen.getByTestId('wishlist-heart');
    expect(heart).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(heart);
    // 서버 응답 전 낙관 반영.
    expect(heart).toHaveAttribute('aria-pressed', 'true');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/account/wishlist');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ productId: PRODUCT_A });

    resolveFetch(jsonResponse({ ok: true }, 201));
    await waitFor(() =>
      expect(heart).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('쓰기 실패(500) 시 롤백된다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, code: 'DB_ERROR' }, 500),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithIntl(
      <WishlistHeart productId={PRODUCT_A} initialWishlisted={false} />,
    );
    const heart = screen.getByTestId('wishlist-heart');
    fireEvent.click(heart);
    expect(heart).toHaveAttribute('aria-pressed', 'true'); // 낙관

    await waitFor(() =>
      expect(heart).toHaveAttribute('aria-pressed', 'false'),
    ); // 롤백
  });

  it('위시 기능 미적용(503) 클릭 → 롤백 + 안내 노출, 리다이렉트 없음 (P2)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, code: 'UNAVAILABLE' }, 503),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithIntl(
      <WishlistHeart productId={PRODUCT_A} initialWishlisted={false} />,
    );
    const heart = screen.getByTestId('wishlist-heart');
    fireEvent.click(heart);
    expect(heart).toHaveAttribute('aria-pressed', 'true'); // 낙관

    await waitFor(() =>
      expect(heart).toHaveAttribute('aria-pressed', 'false'),
    ); // 롤백
    // 조용한 롤백이 아니라 짧은 안내를 띄운다.
    expect(screen.getByTestId('wishlist-unavailable')).toBeInTheDocument();
    // 503 은 미로그인이 아니므로 /login 으로 보내지 않는다.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('미로그인(401) 클릭 → /login?redirect=<현재경로> 이동 + 롤백', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, code: 'UNAUTHENTICATED' }, 401),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithIntl(
      <WishlistHeart productId={PRODUCT_A} initialWishlisted={false} />,
    );
    const heart = screen.getByTestId('wishlist-heart');
    fireEvent.click(heart);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/login?redirect=${encodeURIComponent(`/product/${PRODUCT_A}`)}`,
      ),
    );
    expect(heart).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('<WishlistHeart> 하이드레이션', () => {
  it('단독 렌더(상세 페이지)면 마운트 후 개별 GET ?productIds= 로 상태를 채운다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, wishlisted: [PRODUCT_A] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithIntl(<WishlistHeart productId={PRODUCT_A} />);

    const heart = screen.getByTestId('wishlist-heart');
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'true'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      `/api/account/wishlist?productIds=${encodeURIComponent(PRODUCT_A)}`,
    );
  });

  it('WishlistHydrator 안의 하트 3개는 배치 GET 1회로 하이드레이션된다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, wishlisted: [PRODUCT_B] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithIntl(
      <WishlistHydrator productIds={[PRODUCT_A, PRODUCT_B, PRODUCT_C]}>
        <WishlistHeart productId={PRODUCT_A} />
        <WishlistHeart productId={PRODUCT_B} />
        <WishlistHeart productId={PRODUCT_C} />
      </WishlistHydrator>,
    );

    const hearts = screen.getAllByTestId('wishlist-heart');
    await waitFor(() =>
      expect(hearts[1]).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(hearts[0]).toHaveAttribute('aria-pressed', 'false');
    expect(hearts[2]).toHaveAttribute('aria-pressed', 'false');

    // 요청 수 계약 — 하트 3개여도 배치 fetch 는 정확히 1회.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(decodeURIComponent(url)).toBe(
      `/api/account/wishlist?productIds=${PRODUCT_A},${PRODUCT_B},${PRODUCT_C}`,
    );
  });

  it('배치 GET 이 401(미로그인)이어도 하트는 조용히 비활성 상태로 정착한다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, code: 'UNAUTHENTICATED' }, 401),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithIntl(
      <WishlistHydrator productIds={[PRODUCT_A]}>
        <WishlistHeart productId={PRODUCT_A} />
      </WishlistHydrator>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('wishlist-heart')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(pushMock).not.toHaveBeenCalled(); // GET 401 은 리다이렉트하지 않는다
  });
});
