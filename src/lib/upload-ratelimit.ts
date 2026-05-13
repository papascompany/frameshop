/**
 * In-memory sliding-window rate limiter for photo uploads.
 *
 * Scope: a single Next.js server process. Sufficient for Phase 1 single-region
 * deployment; not distributed-safe. Phase 2 should swap to Upstash / Vercel KV
 * with the same `checkRate(key)` signature.
 *
 * Threat: an attacker spamming `/api/photos/upload` to inflate Storage egress
 * or DoS the service-role connection pool. We cap each session/user at
 * `UPLOAD_RATE_PER_MIN` requests per 60s.
 *
 * P2-02 fix: periodic TTL eviction prevents unbounded Map growth when an
 * attacker rotates sessionIds.
 */

import 'server-only';

export const UPLOAD_RATE_PER_MIN = 10;
const WINDOW_MS = 60_000;
const PRUNE_INTERVAL_MS = 5 * 60_000; // prune stale entries every 5 min

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

let lastPrune = Date.now();

/** Remove expired buckets. Called lazily from checkUploadRate. */
function maybePrune(): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, b] of buckets) {
    if (now - b.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/**
 * Increments the bucket for `key` and returns whether the request is allowed.
 * Uses fixed-window per minute (simple + bounded memory).
 */
export function checkUploadRate(key: string): RateLimitResult {
  maybePrune();
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: UPLOAD_RATE_PER_MIN - 1 };
  }

  if (bucket.count >= UPLOAD_RATE_PER_MIN) {
    const retryAfterMs = WINDOW_MS - (now - bucket.windowStart);
    return { ok: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  bucket.count += 1;
  return { ok: true, remaining: UPLOAD_RATE_PER_MIN - bucket.count };
}

/** Test-only helper to reset state between tests. */
export function _resetUploadRateState(): void {
  buckets.clear();
}
