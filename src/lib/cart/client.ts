/**
 * Client cart API (browser-only).
 *
 * - Anon: reads/writes LocalStorage.
 * - Authed: writes through /api/cart (server upserts row) AND mirrors locally.
 *
 * Auth state is read from the Supabase browser client.
 */

import { asBrand } from '@/types/common';
import type { LocalId } from '@/types/common';
import type {
  AddToCartInput,
  CartItem,
  CartSummary,
  SyncResult,
} from '@/types/cart';
import { clampQuantity, getCartSummary } from './summary';
import { clearLocalCart, readLocalCart, writeLocalCart } from './storage';
import { getBrowserSupabase } from '../supabase/client';

async function isAuthed(): Promise<boolean> {
  try {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

export async function addToCart(input: AddToCartInput): Promise<CartItem> {
  const item: CartItem = {
    ...input,
    localId: asBrand<LocalId>(crypto.randomUUID()),
    quantity: clampQuantity(input.quantity),
    createdAt: new Date().toISOString(),
  };

  const items = readLocalCart();
  writeLocalCart([item, ...items]);

  if (await isAuthed()) {
    await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
  }

  return item;
}

export async function getCart(): Promise<CartItem[]> {
  if (await isAuthed()) {
    const res = await fetch('/api/cart', { cache: 'no-store' });
    if (res.ok) {
      const body = (await res.json()) as { ok: boolean; items: CartItem[] };
      if (body.ok) return body.items;
    }
  }
  return readLocalCart();
}

export async function updateQuantity(
  localId: LocalId,
  quantity: number,
): Promise<void> {
  const clamped = clampQuantity(quantity);
  const items = readLocalCart().map((i) =>
    i.localId === localId ? { ...i, quantity: clamped } : i,
  );
  writeLocalCart(items);
  if (await isAuthed()) {
    await fetch(`/api/cart/${localId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: clamped }),
    });
  }
}

export async function removeFromCart(localId: LocalId): Promise<void> {
  const items = readLocalCart().filter((i) => i.localId !== localId);
  writeLocalCart(items);
  if (await isAuthed()) {
    await fetch(`/api/cart/${localId}`, { method: 'DELETE' });
  }
}

export async function clearCart(localIds?: LocalId[]): Promise<void> {
  if (!localIds) {
    clearLocalCart();
  } else {
    const items = readLocalCart().filter((i) => !localIds.includes(i.localId));
    writeLocalCart(items);
  }
  if (await isAuthed()) {
    if (localIds && localIds.length > 0) {
      await Promise.all(
        localIds.map((id) => fetch(`/api/cart/${id}`, { method: 'DELETE' })),
      );
    }
  }
}

export async function syncCartOnLogin(): Promise<SyncResult> {
  const items = readLocalCart();
  let added = 0;
  let skipped = 0;
  for (const item of items) {
    const res = await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (res.ok) added++;
    else skipped++;
  }
  return { added, skipped };
}

export { getCartSummary };
export type { CartSummary };
