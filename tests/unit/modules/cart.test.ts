/**
 * Cart pure helpers (UT-07 round-trip, summary, clamp).
 *
 * Spec: docs/specs/cart.md.
 */

import { describe, expect, it } from 'vitest';
import {
  clampQuantity,
  deserializeCartItem,
  getCartSummary,
  serializeCartItem,
} from '@/lib/cart/summary';
import { asBrand } from '@/types/common';
import type {
  CartItemId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from '@/types/common';
import type { CartItem } from '@/types/cart';

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: asBrand<CartItemId>('ci-' + Math.random().toString(36).slice(2)),
    // RFC 4122 v4 UUIDs for Zod's strict checker (productId hardened — P1-001).
    localId: asBrand<LocalId>('a1b2c3d4-5e6f-4a89-9bca-1234567890ab'),
    userId: asBrand<UserId>('u-1'),
    productId: asBrand<ProductId>('22222222-2222-4222-8222-222222222222'),
    variantId: asBrand<ProductVariantId>('v-1'),
    photoId: asBrand<PhotoId>('ph-1'),
    options: {
      sizeCode: '4x6',
      colorCode: 'black',
      matteCode: 'none',
      paperCode: 'glossy',
    },
    photoUrl: 'https://example.com/photo.jpg',
    cropTransform: { x: 100, y: 100, scale: 1, rotation: 0 },
    previewUrl: 'https://example.com/preview.png',
    price: 5000,
    quantity: 1,
    createdAt: '2026-05-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('getCartSummary', () => {
  it('sums price * quantity across items', () => {
    const items = [
      makeItem({ price: 5000, quantity: 1 }),
      makeItem({ price: 5000, quantity: 2 }),
      makeItem({ price: 5000, quantity: 3 }),
    ];
    const summary = getCartSummary(items);
    expect(summary).toEqual({
      itemCount: 3,
      totalQuantity: 6,
      subtotal: 30000,
    });
  });

  it('returns zeros for empty cart', () => {
    expect(getCartSummary([])).toEqual({
      itemCount: 0,
      totalQuantity: 0,
      subtotal: 0,
    });
  });
});

describe('clampQuantity', () => {
  it('clamps to the 1..99 range', () => {
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(-5)).toBe(1);
    expect(clampQuantity(99)).toBe(99);
    expect(clampQuantity(100)).toBe(99);
    expect(clampQuantity(50)).toBe(50);
  });

  it('handles NaN and floats', () => {
    expect(clampQuantity(Number.NaN)).toBe(1);
    expect(clampQuantity(3.7)).toBe(3);
  });
});

describe('serializeCartItem (UT-07)', () => {
  it('round-trips through JSON without losing fields', () => {
    const item = makeItem();
    const json = serializeCartItem(item);
    const out = deserializeCartItem(json);
    expect(out).toEqual(item);
  });

  it('preserves cropTransform shape', () => {
    const item = makeItem({
      cropTransform: { x: 1.5, y: 2.25, scale: 1.4, rotation: -15 },
    });
    const out = deserializeCartItem(serializeCartItem(item));
    expect(out.cropTransform).toEqual(item.cropTransform);
  });

  it('rejects malformed input', () => {
    expect(() => deserializeCartItem('{}')).toThrow();
  });
});
