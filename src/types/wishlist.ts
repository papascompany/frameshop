/**
 * 위시리스트(wishlists) 도메인 타입.
 *
 * DB 근거: migration 041. 결정: ADR-026 (FS-X-00 계약 동결).
 *
 * 정책(ADR-026): 위시리스트는 **로그인 전용**(CTO 확정) — user_id NOT NULL,
 * 익명 localStorage 위시 없음. (user_id, product_id) UNIQUE 라 토글은 멱등
 * upsert/delete 로 구현한다.
 *
 * 이 파일은 순수 타입 + zod 스키마만 담는다(클라/서버 공용, server-only 금지).
 *
 * FROZEN(옵셔널/추가 전용): 2026-07-17 by Architect (FS-X-00).
 */

import { z } from 'zod';
import type {
  IsoTimestamp,
  ProductId,
  UserId,
  WishlistItemId,
} from './common';

// ---------- Domain types ----------

/** wishlists 1행 (camelCase 도메인 뷰). */
export type WishlistItem = {
  id: WishlistItemId;
  userId: UserId;
  productId: ProductId;
  createdAt: IsoTimestamp;
};

// ---------- Zod schemas ----------

/**
 * 토글/추가/삭제 입력(/api/account/wishlist). userId 는 입력이 아니라 서버가
 * 세션에서 주입한다(스푸핑 방지).
 */
export const wishlistInputSchema = z.object({
  productId: z.string().uuid(),
});

export type WishlistInput = z.infer<typeof wishlistInputSchema>;
