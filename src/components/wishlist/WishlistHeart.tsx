'use client';

/**
 * 위시리스트 하트 토글 — 'use client' 아일랜드 (FS-X-06, ADR-026).
 *
 * 상태 소스 우선순위:
 *  1. 사용자의 낙관 토글(optimistic) — 성공 시 그대로 정착, 실패 시 롤백.
 *  2. 배치 하이드레이션 컨텍스트(WishlistHydrator — 카탈로그 그리드).
 *  3. 개별 fetch(마운트 후 `?productIds=<id>` 1건 — ISR 상세 페이지).
 *  4. `initialWishlisted` prop(서버가 이미 알 때) → 기본 false.
 *
 * 미로그인: GET 401 은 조용히 무시(하트 비활성), **클릭 시** 401 이면
 * `/login?redirect=<현재경로>` 로 이동한다(위시는 로그인 전용 — CTO 확정).
 *
 * 미적용 창(POST/DELETE 503 — migration 041 배포~적용): 조용한 롤백 대신 짧은
 * 인라인 안내("위시리스트 준비 중")를 띄운다. 일시 오류(그 외 !ok)는 조용 롤백.
 *
 * 카탈로그 카드는 단일 <Link> 라 버튼 중첩이 불가하다 — 이 컴포넌트는 항상
 * Link 의 "형제"(ProductCard.wishlistSlot 오버레이)로 렌더하고, 클릭 이벤트를
 * preventDefault/stopPropagation 으로 격리한다.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useWishlistHydration } from './WishlistHydrator';

type Props = {
  productId: string;
  /** 서버가 위시 여부를 이미 알 때만 전달 — 지정 시 개별 fetch 를 건너뛴다. */
  initialWishlisted?: boolean;
  className?: string;
};

export function WishlistHeart({ productId, initialWishlisted, className }: Props) {
  const t = useTranslations('product');
  const router = useRouter();
  const pathname = usePathname();
  const hydration = useWishlistHydration();

  const [selfFetched, setSelfFetched] = useState<boolean | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const pendingRef = useRef(false);

  // 개별 fetch 는 배치 컨텍스트도 initial 값도 없을 때만 — StrictMode 중복 방지.
  const skipSelfFetch = hydration !== null || initialWishlisted !== undefined;
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (skipSelfFetch || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    fetch(`/api/account/wishlist?productIds=${encodeURIComponent(productId)}`)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ ok: boolean; wishlisted?: string[] }>)
          : null,
      )
      .then((data) => {
        if (!cancelled && data?.ok && Array.isArray(data.wishlisted)) {
          setSelfFetched(data.wishlisted.includes(productId));
        }
      })
      .catch(() => {
        // 익명/네트워크 실패 — 하트는 비활성 상태 유지(클릭 시 401 처리).
      });
    return () => {
      cancelled = true;
    };
  }, [skipSelfFetch, productId]);

  const base = hydration
    ? hydration.ready
      ? hydration.wishlisted.has(productId)
      : (initialWishlisted ?? false)
    : (selfFetched ?? initialWishlisted ?? false);
  const wishlisted = optimistic ?? base;

  async function toggle(): Promise<void> {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setUnavailable(false); // 이전 안내 초기화(재시도 시).
    const next = !wishlisted;
    // 낙관 토글 — 서버 응답 전 즉시 반영, 실패/401 시 롤백.
    setOptimistic(next);
    try {
      const res = await fetch('/api/account/wishlist', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      if (res.status === 401) {
        setOptimistic(null);
        router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
        return;
      }
      if (res.status === 503) {
        // 위시 기능 미적용(041 배포~적용 창) — 롤백 + 짧은 안내.
        setOptimistic(null);
        setUnavailable(true);
        return;
      }
      if (!res.ok) setOptimistic(null);
    } catch {
      setOptimistic(null);
    } finally {
      pendingRef.current = false;
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        data-testid="wishlist-heart"
        aria-pressed={wishlisted}
        aria-label={wishlisted ? t('wishlistRemove') : t('wishlistAdd')}
        onClick={(e) => {
          // 카드 Link 오버레이에서 내비게이션 오염 방지.
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        className={cn(
          'grid place-items-center h-10 w-10 rounded-full',
          'bg-canvas/90 border border-hairline',
          'transition-colors duration-150 hover:bg-soft-cloud',
          'tap-collapse',
          'focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 focus-visible:outline',
          className,
        )}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden
          className={wishlisted ? 'text-sale' : 'text-ink'}
          fill={wishlisted ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
      </button>
      {unavailable ? (
        <span
          role="status"
          data-testid="wishlist-unavailable"
          className={cn(
            'absolute top-full right-0 mt-1 z-30 whitespace-nowrap',
            'rounded-md bg-ink px-2 py-1 text-xs text-canvas shadow-md',
          )}
        >
          {t('wishlistUnavailable')}
        </span>
      ) : null}
    </span>
  );
}
