/**
 * Cart → Checkout selection handoff.
 *
 * The cart lets the user check a subset of items and order only those. We pass
 * the chosen localIds to the checkout page via sessionStorage (a one-shot
 * handoff) so a direct `/checkout` link still works (no key → order full cart).
 */

export const CHECKOUT_SELECTION_KEY = 'fs-checkout-selection';

/** Read + clear the one-shot selection. Returns null when none was set. */
export function takeCheckoutSelection(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CHECKOUT_SELECTION_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CHECKOUT_SELECTION_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}
