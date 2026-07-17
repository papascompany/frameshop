'use client';

/**
 * 위시리스트 배치 하이드레이션 컨텍스트 (FS-X-06, ADR-026).
 *
 * 카탈로그 그리드처럼 하트가 N개 렌더되는 화면에서 하트마다 GET 을 쏘지 않도록,
 * 이 래퍼가 productIds 를 모아 `/api/account/wishlist?productIds=…` **1회** 조회
 * 후 컨텍스트로 분배한다. `WishlistHeart` 는 이 컨텍스트 안에 있으면 개별
 * fetch 를 건너뛴다(상세 페이지처럼 단독 렌더면 컨텍스트 없이 개별 fetch).
 *
 * 미로그인(401)/probe 미적용/네트워크 실패는 전부 "위시 없음"으로 정착시킨다 —
 * 하트는 조용히 비활성 상태로 남고, 클릭 시점의 401 처리(로그인 리다이렉트)가
 * 안내를 담당한다.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type WishlistHydration = {
  /** 배치 조회가 정착(성공/실패 불문)했는지. false 면 하트는 initial 값 유지. */
  ready: boolean;
  /** 위시된 productId 집합. */
  wishlisted: ReadonlySet<string>;
};

const WishlistHydrationContext = createContext<WishlistHydration | null>(null);

/** 하트가 배치 컨텍스트 안에 있으면 그 상태를, 아니면 null(개별 fetch 모드). */
export function useWishlistHydration(): WishlistHydration | null {
  return useContext(WishlistHydrationContext);
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
const READY_EMPTY: WishlistHydration = { ready: true, wishlisted: EMPTY_SET };

type Props = {
  /** 그리드에 렌더되는 카드들의 productId 목록(API 상한 100 이내). */
  productIds: readonly string[];
  children: ReactNode;
};

export function WishlistHydrator({ productIds, children }: Props) {
  const [state, setState] = useState<WishlistHydration>({
    ready: false,
    wishlisted: EMPTY_SET,
  });
  // StrictMode 이중 이펙트에서 GET 중복 방지(테스트 계약: 배치 fetch 1회).
  const fetchedRef = useRef(false);
  const idsKey = productIds.join(',');

  useEffect(() => {
    if (idsKey.length === 0 || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    fetch(`/api/account/wishlist?productIds=${encodeURIComponent(idsKey)}`)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ ok: boolean; wishlisted?: string[] }>)
          : null,
      )
      .then((data) => {
        if (cancelled) return;
        setState({
          ready: true,
          wishlisted:
            data?.ok && Array.isArray(data.wishlisted)
              ? new Set(data.wishlisted)
              : EMPTY_SET,
        });
      })
      .catch(() => {
        if (!cancelled) setState(READY_EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return (
    <WishlistHydrationContext.Provider
      value={idsKey.length === 0 ? READY_EMPTY : state}
    >
      {children}
    </WishlistHydrationContext.Provider>
  );
}
