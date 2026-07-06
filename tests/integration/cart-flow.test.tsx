/**
 * Cart store + summary integration (IT-06).
 *
 * Verifies that the public client API (addToCart / getCart / updateQuantity /
 * removeFromCart) round-trips through LocalStorage when the user is anon.
 *
 * Marked `it.todo` for steps that need the rest of the cart UI (Frontend Dev
 * Phase 4). Skeletons here are minimal to keep the suite green-on-implement.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addToCart,
  getCart,
  removeFromCart,
  updateQuantity,
} from '@/lib/cart/client';
import { clearLocalCart } from '@/lib/cart/storage';
import { asBrand } from '@/types/common';
import type {
  PhotoId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import type { AddToCartInput } from '@/types/cart';

function makeAddInput(): AddToCartInput {
  return {
    userId: null,
    // RFC 4122 v4 — readLocalCart 의 productId uuid 강화(P1-001) 파싱 통과용.
    productId: asBrand<ProductId>('22222222-2222-4222-8222-222222222222'),
    variantId: asBrand<ProductVariantId>('v1'),
    photoId: asBrand<PhotoId>('ph1'),
    options: {
      sizeCode: '4x6',
      colorCode: 'black',
      matteCode: 'none',
      paperCode: 'glossy',
    },
    photoUrl: 'https://example.com/p.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    previewUrl: 'https://example.com/preview.png',
    price: 5000,
    quantity: 1,
  };
}

beforeEach(() => clearLocalCart());
afterEach(() => clearLocalCart());

describe('cart client (anonymous)', () => {
  it('addToCart persists into localStorage and returns the saved item', async () => {
    const item = await addToCart(makeAddInput());
    expect(item.localId).toBeTruthy();
    const all = await getCart();
    expect(all).toHaveLength(1);
    expect(all[0]?.localId).toBe(item.localId);
  });

  it('updateQuantity clamps to 1..99', async () => {
    const item = await addToCart(makeAddInput());
    await updateQuantity(item.localId, 999);
    const all = await getCart();
    expect(all[0]?.quantity).toBe(99);
  });

  it('removeFromCart removes the right item', async () => {
    const a = await addToCart(makeAddInput());
    await addToCart(makeAddInput());
    await removeFromCart(a.localId);
    const remaining = await getCart();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.localId).not.toBe(a.localId);
  });

  it.todo('syncCartOnLogin merges LocalStorage entries to DB (Phase 3 hookup)');
});
