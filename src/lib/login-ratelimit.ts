/**
 * In-memory rate limiter for admin login attempts.
 *
 * 5 attempts per 15 minutes per email address. Locks the bucket on the 5th
 * failure; subsequent calls within the window return RATE_LIMITED immediately
 * without forwarding the credential to Supabase.
 *
 * Phase 1: single-process, single-region. Phase 2: replace with Upstash KV.
 */
import 'server-only';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000; // 15 minutes
const PRUNE_INTERVAL_MS = 5 * 60_000; // prune stale entries every 5 min

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

export type LoginRateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/** Call BEFORE forwarding credentials to Supabase. */
export function checkLoginRate(email: string): LoginRateLimitResult {
  maybePrune();
  const now = Date.now();
  const key = email.toLowerCase().trim();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: MAX_ATTEMPTS - 1 };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    const retryAfterMs = WINDOW_MS - (now - bucket.windowStart);
    return { ok: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  bucket.count += 1;
  return { ok: true, remaining: MAX_ATTEMPTS - bucket.count };
}

/** Reset bucket on successful login (don't penalise legit users). */
export function resetLoginRate(email: string): void {
  buckets.delete(email.toLowerCase().trim());
}

/** Test-only. */
export function _resetLoginRateState(): void {
  buckets.clear();
}
