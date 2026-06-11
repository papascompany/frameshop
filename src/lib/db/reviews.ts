/**
 * reviews — 상품 리뷰 CRUD
 *
 * SELECT: anon (is_public=true), 전체 목록은 anon
 * INSERT/UPDATE: 인증 사용자 (서버 클라이언트)
 * 어드민 관리: 서비스롤
 */

import 'server-only';
import { revalidateTag, unstable_cache } from 'next/cache';
import { getAnonSupabase } from '@/lib/supabase/anon';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceRoleSupabase } from '@/lib/supabase/service';

export type Review = {
  id: string;
  orderId: string | null;
  userId: string | null;
  productId: string | null;
  rating: number;
  body: string | null;
  photoUrl: string | null;
  isPublic: boolean;
  createdAt: string;
};

export type CreateReviewInput = {
  orderId: string;
  userId: string;
  productId?: string | null;
  rating: number;
  body?: string | null;
  photoUrl?: string | null;
};

// ─── 맵퍼 ────────────────────────────────────────────────────────────────────

function mapRow(row: Record<string, unknown>): Review {
  return {
    id: row['id'] as string,
    orderId: row['order_id'] as string | null,
    userId: row['user_id'] as string | null,
    productId: row['product_id'] as string | null,
    rating: row['rating'] as number,
    body: row['body'] as string | null,
    photoUrl: row['photo_url'] as string | null,
    isPublic: row['is_public'] as boolean,
    createdAt: row['created_at'] as string,
  };
}

// ─── 공개 조회 ───────────────────────────────────────────────────────────────

// Public review reads are cached (300s, tag 'reviews'). They render on the
// landing page (getRecentPublicReviews) and product detail (getProductReviews),
// both hot paths — without caching each render hit a live Supabase RTT.
// createReview / toggleReviewPublic call revalidateTag('reviews', 'max') to flush.
export const getProductReviews = unstable_cache(
  async (productId: string, limit = 20): Promise<Review[]> => {
    const supabase = getAnonSupabase();
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('product_id', productId)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[reviews] getProductReviews error:', error.message);
      return [];
    }
    return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
  },
  ['product-reviews'],
  { revalidate: 300, tags: ['reviews'] },
);

export const getRecentPublicReviews = unstable_cache(
  async (limit = 5): Promise<Review[]> => {
    const supabase = getAnonSupabase();
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[reviews] getRecentPublicReviews error:', error.message);
      return [];
    }
    return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
  },
  ['recent-public-reviews'],
  { revalidate: 300, tags: ['reviews'] },
);

export async function getOrderReview(orderId: string): Promise<Review | null> {
  // LOW-004 FIX: use service-role client so private (is_public=false) reviews
  // belonging to the caller are also found during the duplicate-review check.
  // Previously, the anon client only saw public reviews via RLS, so a user
  // could bypass the duplicate check by flipping their review to is_public=false
  // and then submitting a second review for the same order.
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) {
    console.error('[reviews] getOrderReview error:', error.message);
    return null;
  }
  return data ? mapRow(data as Record<string, unknown>) : null;
}

// ─── 인증 사용자 ─────────────────────────────────────────────────────────────

export async function createReview(input: CreateReviewInput): Promise<Review> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('reviews')
    .insert({
      order_id: input.orderId,
      user_id: input.userId,
      product_id: input.productId ?? null,
      rating: input.rating,
      body: input.body ?? null,
      photo_url: input.photoUrl ?? null,
      is_public: true,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`[reviews] createReview failed: ${error?.message ?? 'no data'}`);
  }
  revalidateTag('reviews', 'max');
  return mapRow(data as Record<string, unknown>);
}

// ─── 어드민 ──────────────────────────────────────────────────────────────────

export async function getAllReviews(limit = 50): Promise<Review[]> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[reviews] getAllReviews error:', error.message);
    return [];
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function toggleReviewPublic(
  id: string,
  isPublic: boolean,
): Promise<void> {
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('reviews')
    .update({ is_public: isPublic })
    .eq('id', id);
  if (error) {
    throw new Error(`[reviews] toggleReviewPublic failed: ${error.message}`);
  }
  revalidateTag('reviews', 'max');
}
