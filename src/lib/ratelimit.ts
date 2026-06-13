/**
 * Generic in-memory fixed-window rate limiter (namespaced).
 *
 * Scope: a single Next.js server process. Sufficient as a Phase-0 control; NOT
 * distributed-safe (each Vercel instance keeps its own counters). Phase 1 should
 * swap the backing store for Upstash / Vercel KV behind the same `checkRate`
 * signature — atomic INCR with TTL — to make limits durable across instances.
 *
 * Memory safety: a hard `MAX_BUCKETS_PER_NS` cap + lazy TTL pruning bound the
 * map size so an attacker rotating keys (emails/IPs/sessions) cannot grow the
 * heap without limit.
 */

import 'server-only';

const MAX_BUCKETS_PER_NS = 20_000;
const PRUNE_INTERVAL_MS = 60_000;

type Bucket = { count: number; windowStart: number };
const namespaces = new Map<string, Map<string, Bucket>>();
let lastPrune = Date.now();

function nsMap(namespace: string): Map<string, Bucket> {
  let m = namespaces.get(namespace);
  if (!m) {
    m = new Map();
    namespaces.set(namespace, m);
  }
  return m;
}

/** Drop expired buckets across all namespaces (lazy, throttled). */
function maybePrune(now: number): void {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const m of namespaces.values()) {
    for (const [key, b] of m) {
      // A bucket older than 1h is certainly expired for any sane window.
      if (now - b.windowStart >= 3_600_000) m.delete(key);
    }
  }
}

/** When a namespace hits the cap, evict the oldest (insertion-order) entries. */
function evictIfFull(m: Map<string, Bucket>, now: number): void {
  if (m.size < MAX_BUCKETS_PER_NS) return;
  for (const [key, b] of m) {
    if (now - b.windowStart >= 0) {
      m.delete(key); // Map iterates in insertion order → oldest first.
      if (m.size < MAX_BUCKETS_PER_NS) break;
    }
  }
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/**
 * Increment the counter for (`namespace`, `key`) and report whether the request
 * is within `max` per `windowMs`. Fixed-window — simple and bounded.
 */
export function checkRate(
  namespace: string,
  key: string,
  opts: { max: number; windowMs: number },
): RateLimitResult {
  const { max, windowMs } = opts;
  const now = Date.now();
  maybePrune(now);
  const m = nsMap(namespace);
  const bucket = m.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    evictIfFull(m, now);
    m.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: max - 1 };
  }

  if (bucket.count >= max) {
    const retryAfterMs = windowMs - (now - bucket.windowStart);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  bucket.count += 1;
  return { ok: true, remaining: max - bucket.count };
}

/** Test-only: clear all limiter state. */
export function _resetRateLimit(): void {
  namespaces.clear();
  lastPrune = Date.now();
}
