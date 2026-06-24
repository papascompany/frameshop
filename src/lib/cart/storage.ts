/**
 * LocalStorage-backed cart for anonymous users.
 *
 * Falls back to an in-memory shim when LocalStorage is unavailable (private
 * mode, SSR). All reads/writes go through this so the rest of the codebase
 * doesn't worry about the difference.
 */

import {
  CART_LOCAL_STORAGE_KEY,
  CART_LOCAL_STORAGE_KEY_V1,
  cartItemSchema,
} from '@/types/cart';
import type { CartItem } from '@/types/cart';
import { z } from 'zod';

const memoryStore = new Map<string, string>();

function getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // probe quota
      const probe = '__frameshop.probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // fall through
  }
  return {
    getItem: (k) => memoryStore.get(k) ?? null,
    setItem: (k, v) => {
      memoryStore.set(k, v);
    },
    removeItem: (k) => {
      memoryStore.delete(k);
    },
  };
}

const cartArraySchema = z.array(cartItemSchema);

function parseCart(raw: string | null): CartItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const verified = cartArraySchema.safeParse(parsed);
    return verified.success ? (verified.data as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function readLocalCart(): CartItem[] {
  const store = getStorage();
  const rawV2 = store.getItem(CART_LOCAL_STORAGE_KEY);
  if (rawV2 !== null) return parseCart(rawV2);

  // No v2 cart yet — migrate a legacy v1 cart once (lossless: v2 schema is a
  // superset of v1, so v1 items validate as-is). After promoting to v2 we drop
  // the v1 key so this runs at most once.
  const rawV1 = store.getItem(CART_LOCAL_STORAGE_KEY_V1);
  if (rawV1 === null) return [];
  const migrated = parseCart(rawV1);
  if (migrated.length > 0) writeLocalCart(migrated);
  store.removeItem(CART_LOCAL_STORAGE_KEY_V1);
  return migrated;
}

export function writeLocalCart(items: CartItem[]): void {
  try {
    getStorage().setItem(CART_LOCAL_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota / private mode — silent. UI surfaces a warning at higher level.
  }
}

export function clearLocalCart(): void {
  const store = getStorage();
  store.removeItem(CART_LOCAL_STORAGE_KEY);
  // Drop any lingering legacy cart too, so it can't resurrect on the next read.
  store.removeItem(CART_LOCAL_STORAGE_KEY_V1);
}
