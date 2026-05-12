/**
 * LocalStorage-backed cart for anonymous users.
 *
 * Falls back to an in-memory shim when LocalStorage is unavailable (private
 * mode, SSR). All reads/writes go through this so the rest of the codebase
 * doesn't worry about the difference.
 */

import { CART_LOCAL_STORAGE_KEY, cartItemSchema } from '@/types/cart';
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

export function readLocalCart(): CartItem[] {
  const raw = getStorage().getItem(CART_LOCAL_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const verified = cartArraySchema.safeParse(parsed);
    return verified.success ? (verified.data as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalCart(items: CartItem[]): void {
  try {
    getStorage().setItem(CART_LOCAL_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota / private mode — silent. UI surfaces a warning at higher level.
  }
}

export function clearLocalCart(): void {
  getStorage().removeItem(CART_LOCAL_STORAGE_KEY);
}
