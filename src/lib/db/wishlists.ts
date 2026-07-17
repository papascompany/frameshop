/**
 * wishlists — 위시리스트 데이터 접근 (FS-X-02, migration 041 / ADR-026).
 *
 * Server-only. Uses the service-role client, which BYPASSES RLS — therefore
 * ownership is enforced *in code*: every query is scoped by `user_id`. RLS
 * (owner FOR ALL on the table) remains defence-in-depth.
 *
 * 로그인 전용(CTO 확정) — 익명 위시는 없다. (user_id, product_id) UNIQUE 라
 * 추가/제거는 멱등: 중복 추가(23505)는 성공으로, 부재 행 제거도 성공으로
 * 취급한다(하트 토글 더블클릭/재시도 안전).
 *
 * Probe-graceful: reads degrade to empty results, writes return an explicit
 * `WISHLIST_UNAVAILABLE` error value (42P01 never leaks).
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { IsoTimestamp, ProductId, UserId, WishlistItemId } from '@/types/common';
import { isWishlistAvailable } from './feature-probe';
import { getServiceRoleSupabase } from '../supabase/service';

// ---------- result tuple ----------

type DbResult<T> = { data: T; error: null } | { data: null; error: string };

/** 미적용 창의 쓰기 거부 코드 — 라우트가 503 으로 매핑한다. */
export const WISHLIST_UNAVAILABLE = 'WISHLIST_UNAVAILABLE';

// ---------- domain view (목록 = 위시 행 + 상품 요약 조인) ----------

/** account/wishlist 목록 1행 — 카드 렌더에 필요한 상품 요약을 함께 담는다. */
export type WishlistEntry = {
  id: WishlistItemId;
  productId: ProductId;
  createdAt: IsoTimestamp;
  /** FK CASCADE 라 원칙상 항상 존재하지만, 조인 누락 시 null 로 방어한다. */
  product: {
    name: string;
    basePrice: number;
    isActive: boolean;
    thumbnail: string | null;
  } | null;
};

// ---------- row shapes ----------

type ProductJoinRow = {
  name: string;
  base_price: number;
  is_active: boolean;
  product_images?: Array<{ image_url: string; type: string; sort_order: number }>;
};

type WishlistRow = {
  id: string;
  product_id: string;
  created_at: string;
  /** PostgREST to-one 조인은 객체이지만, 관계 추론 편차에 대비해 배열도 흡수. */
  products?: ProductJoinRow | ProductJoinRow[] | null;
};

function mapEntry(row: WishlistRow): WishlistEntry {
  const joined = Array.isArray(row.products) ? row.products[0] : row.products;
  const thumb = (joined?.product_images ?? [])
    .filter((img) => img.type === 'thumbnail')
    .sort((a, b) => a.sort_order - b.sort_order)[0];
  return {
    id: asBrand<WishlistItemId>(row.id),
    productId: asBrand<ProductId>(row.product_id),
    createdAt: row.created_at,
    product: joined
      ? {
          name: joined.name,
          basePrice: joined.base_price,
          isActive: joined.is_active,
          thumbnail: thumb?.image_url ?? null,
        }
      : null,
  };
}

// ---------- queries (always scoped by userId) ----------

/** 내 위시 목록, 최신순 + 상품 요약(name/basePrice/isActive/thumbnail) 조인. */
export async function listWishlist(
  userId: UserId,
): Promise<DbResult<WishlistEntry[]>> {
  if (!(await isWishlistAvailable())) return { data: [], error: null };

  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('wishlists')
    .select(
      'id, product_id, created_at, products!left(name, base_price, is_active, product_images!left(image_url, type, sort_order))',
    )
    .eq('user_id', userId as string)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return { data: null, error: error.message };
  return { data: ((data ?? []) as WishlistRow[]).map(mapEntry), error: null };
}

/** 하트 추가 — UNIQUE(user_id, product_id) 충돌(23505)은 성공으로 멱등 처리. */
export async function addToWishlist(
  userId: UserId,
  productId: ProductId,
): Promise<DbResult<true>> {
  if (!(await isWishlistAvailable())) {
    return { data: null, error: WISHLIST_UNAVAILABLE };
  }

  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from('wishlists').insert({
    user_id: userId as string,
    product_id: productId as string,
  });

  if (error && error.code !== '23505') {
    // 존재하지 않는 상품(FK 위반)은 입력 오류로 구분 → 라우트가 422 매핑.
    if (error.code === '23503') return { data: null, error: 'REF_NOT_FOUND' };
    return { data: null, error: error.message };
  }
  return { data: true, error: null };
}

/** 하트 제거 — 부재 행 삭제도 성공(멱등, 토글 재시도 안전). */
export async function removeFromWishlist(
  userId: UserId,
  productId: ProductId,
): Promise<DbResult<true>> {
  if (!(await isWishlistAvailable())) {
    return { data: null, error: WISHLIST_UNAVAILABLE };
  }

  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('wishlists')
    .delete()
    .eq('user_id', userId as string)
    .eq('product_id', productId as string);

  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
}

/**
 * 배치 위시 상태 조회(카탈로그 하트 하이드레이션용) — 입력 productIds 중
 * 위시된 부분집합을 반환한다. 빈 입력/미적용이면 쿼리 없이 빈 배열.
 */
export async function isWishlisted(
  userId: UserId,
  productIds: ProductId[],
): Promise<DbResult<ProductId[]>> {
  if (productIds.length === 0) return { data: [], error: null };
  if (!(await isWishlistAvailable())) return { data: [], error: null };

  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('wishlists')
    .select('product_id')
    .eq('user_id', userId as string)
    .in('product_id', productIds as string[]);

  if (error) return { data: null, error: error.message };
  return {
    data: ((data ?? []) as Array<{ product_id: string }>).map((row) =>
      asBrand<ProductId>(row.product_id),
    ),
    error: null,
  };
}
