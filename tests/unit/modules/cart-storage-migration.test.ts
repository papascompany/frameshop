/**
 * Cart LocalStorage v1 → v2 lossless migration (ADR-023, 확장형 P0).
 *
 * v2 added optional 묶음 필드(projectId/projectSeq/orientation). The v2 schema is a
 * superset of v1, so legacy carts must promote without loss and the legacy key must
 * be retired so the migration runs at most once.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearLocalCart,
  readLocalCart,
  writeLocalCart,
} from '@/lib/cart/storage';
import {
  CART_LOCAL_STORAGE_KEY,
  CART_LOCAL_STORAGE_KEY_V1,
} from '@/types/cart';
import { asBrand } from '@/types/common';
import type {
  CartProjectId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import type { CartItem } from '@/types/cart';

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    localId: asBrand<LocalId>('a1b2c3d4-5e6f-4a89-9bca-1234567890ab'),
    userId: null,
    productId: asBrand<ProductId>('p-1'),
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

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('cart storage v1 → v2 migration', () => {
  it('returns [] when neither v1 nor v2 exist', () => {
    expect(readLocalCart()).toEqual([]);
  });

  it('migrates a legacy v1 cart into v2 and retires the v1 key', () => {
    const legacy = [makeItem({ price: 3000 }), makeItem({ price: 7000, quantity: 2 })];
    window.localStorage.setItem(CART_LOCAL_STORAGE_KEY_V1, JSON.stringify(legacy));

    const out = readLocalCart();

    // Lossless: v1 items (no 묶음 fields) survive intact.
    expect(out).toEqual(legacy);
    // Promoted into the v2 key…
    expect(window.localStorage.getItem(CART_LOCAL_STORAGE_KEY)).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem(CART_LOCAL_STORAGE_KEY)!)).toEqual(
      legacy,
    );
    // …and the legacy key is retired (migration runs at most once).
    expect(window.localStorage.getItem(CART_LOCAL_STORAGE_KEY_V1)).toBeNull();
  });

  it('prefers an existing v2 cart and ignores a stale v1 cart', () => {
    const v2Item = makeItem({ price: 9000 });
    const v1Item = makeItem({ price: 1000 });
    writeLocalCart([v2Item]);
    window.localStorage.setItem(CART_LOCAL_STORAGE_KEY_V1, JSON.stringify([v1Item]));

    const out = readLocalCart();

    expect(out).toEqual([v2Item]);
    // v1 untouched here (only consulted when v2 is absent).
    expect(window.localStorage.getItem(CART_LOCAL_STORAGE_KEY_V1)).not.toBeNull();
  });

  it('round-trips v2 items carrying the new 묶음 fields', () => {
    const projectItem = makeItem({
      projectId: asBrand<CartProjectId>('proj-1'),
      projectSeq: 2,
      orientation: 'landscape',
    });
    writeLocalCart([projectItem]);

    expect(readLocalCart()).toEqual([projectItem]);
  });

  it('drops a corrupt legacy cart instead of throwing', () => {
    window.localStorage.setItem(CART_LOCAL_STORAGE_KEY_V1, '{ not json');
    expect(readLocalCart()).toEqual([]);
  });

  it('clearLocalCart also retires any lingering v1 cart', () => {
    writeLocalCart([makeItem()]);
    window.localStorage.setItem(CART_LOCAL_STORAGE_KEY_V1, JSON.stringify([makeItem()]));

    clearLocalCart();

    expect(window.localStorage.getItem(CART_LOCAL_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(CART_LOCAL_STORAGE_KEY_V1)).toBeNull();
  });
});
