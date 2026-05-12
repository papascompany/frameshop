/**
 * Pure cart helpers.
 *
 * - getCartSummary: subtotal + counts (used by cart page + checkout)
 * - serializeCartItem / deserializeCartItem: LocalStorage round-trip (UT-07)
 * - clampQuantity: 1..99 guard
 */

import {
  CART_QUANTITY_MAX,
  CART_QUANTITY_MIN,
  cartItemSchema,
  type CartItem,
  type CartSummary,
} from '@/types/cart';

export function getCartSummary(items: readonly CartItem[]): CartSummary {
  let subtotal = 0;
  let totalQuantity = 0;
  for (const item of items) {
    subtotal += item.price * item.quantity;
    totalQuantity += item.quantity;
  }
  return {
    itemCount: items.length,
    totalQuantity,
    subtotal,
  };
}

export function clampQuantity(input: number): number {
  if (!Number.isFinite(input)) return CART_QUANTITY_MIN;
  const intVal = Math.trunc(input);
  if (intVal < CART_QUANTITY_MIN) return CART_QUANTITY_MIN;
  if (intVal > CART_QUANTITY_MAX) return CART_QUANTITY_MAX;
  return intVal;
}

export function serializeCartItem(item: CartItem): string {
  return JSON.stringify(item);
}

export function deserializeCartItem(json: string): CartItem {
  const parsed: unknown = JSON.parse(json);
  return cartItemSchema.parse(parsed) as CartItem;
}
