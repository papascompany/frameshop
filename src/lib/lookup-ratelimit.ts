/**
 * In-memory rate limiter for guest order lookup (/api/orders/lookup).
 *
 * P2-08: Prevents phone number enumeration against known order numbers.
 * An attacker who knows a valid orderNo (YYYYMMDD-NNNN, sequential) could
 * brute-force the orderer's phone by cycling all 01x-xxxx-xxxx combinations.
 *
 * Rate: 10 attempts per 15 minutes per IP address.
 *
 * Phase 1: single-process, single-region in-memory map.
 * Phase 2: replace with Upstash KV for multi-region consistency.
 */

import 'server-only';

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000; // 15 minutes
const PRUNE_INTERVAL_MS = 5 * 60_000;

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

let lastPrune = Date.now();

function maybePrune(): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, b] of buckets) {
    if (now - b.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

export type LookupRateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/** Call BEFORE running the DB query. Pass the caller's IP address as key. */
export function checkLookupRate(ip: string): LookupRateLimitResult {
  maybePrune();
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return { ok: true, remaining: MAX_ATTEMPTS - 1 };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    const retryAfterMs = WINDOW_MS - (now - bucket.windowStart);
    return { ok: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  bucket.count += 1;
  return { ok: true, remaining: MAX_ATTEMPTS - bucket.count };
}

/** Test-only. */
export function _resetLookupRateState(): void {
  buckets.clear();
}
