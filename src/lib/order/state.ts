/**
 * Order state-machine helpers (PURE — safe to import anywhere).
 *
 * The forward transition table is `ORDER_TRANSITIONS` in `src/types/order.ts`.
 * Same-state transitions are idempotent (treated as a no-op success).
 *
 * The actual DB-mutating `transitionTo` lives in `src/lib/db/order.ts` and
 * is `'server-only'`.
 *
 * UT-05 covers every valid + invalid pair.
 */

import {
  ORDER_TRANSITIONS,
  type OrderStatus,
} from '@/types/order';

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  if (from === to) return true; // idempotent
  const allowed = ORDER_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Allowed targets from a given state (exposed for admin UI / tests).
 */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}

/**
 * KST-aware order number `YYYYMMDD-NNNN`.
 * Formatting only — sequence allocation is a DB UPSERT (see db/order.ts).
 */
export function formatOrderNo(day: Date, seq: number): string {
  // Convert to KST regardless of server TZ.
  const kst = new Date(day.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const n = String(seq).padStart(4, '0');
  return `${y}${m}${d}-${n}`;
}

/** Parse `YYYYMMDD-NNNN` back into its parts (Phase 2 lookups). */
export function parseOrderNo(orderNo: string): { date: string; seq: number } | null {
  const match = /^(\d{8})-(\d{4})$/.exec(orderNo);
  if (!match) return null;
  return {
    date: match[1]!,
    seq: parseInt(match[2]!, 10),
  };
}
