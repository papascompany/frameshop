/**
 * Unified rate limiter — durable when Upstash is configured, in-memory otherwise.
 *
 * Backend selection (per call, zero-config):
 *   - If `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, counters
 *     live in Upstash Redis via its REST API — atomic `INCR` + `EXPIRE NX` on a
 *     wall-clock fixed window. This is DISTRIBUTED: every Vercel instance shares
 *     the same counter, closing the "rotate instances to reset the limit" bypass.
 *   - Otherwise (or if Upstash errors), it falls back to a process-local
 *     in-memory map. Same behaviour as before — safe default, but per-instance.
 *
 * To activate distributed limits: provision Upstash Redis (Vercel Marketplace)
 * and set the two env vars. No code change needed.
 *
 * Memory safety (fallback path): a hard `MAX_BUCKETS_PER_NS` cap + lazy TTL
 * pruning bound the map so key rotation (emails/IPs/sessions) can't grow the heap.
 */

import 'server-only';

const MAX_BUCKETS_PER_NS = 20_000;
const PRUNE_INTERVAL_MS = 60_000;
const UPSTASH_TIMEOUT_MS = 2_000;

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

export type RateOpts = { max: number; windowMs: number };

// ───────────────────────── in-memory backend ─────────────────────────

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

function maybePrune(now: number): void {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const m of namespaces.values()) {
    for (const [key, b] of m) {
      if (now - b.windowStart >= 3_600_000) m.delete(key);
    }
  }
}

function evictIfFull(m: Map<string, Bucket>): void {
  if (m.size < MAX_BUCKETS_PER_NS) return;
  for (const key of m.keys()) {
    m.delete(key); // Map iterates in insertion order → oldest first.
    if (m.size < MAX_BUCKETS_PER_NS) break;
  }
}

function checkRateMemory(namespace: string, key: string, opts: RateOpts): RateLimitResult {
  const { max, windowMs } = opts;
  const now = Date.now();
  maybePrune(now);
  const m = nsMap(namespace);
  const bucket = m.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    evictIfFull(m);
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

// ───────────────────────── Upstash backend ─────────────────────────

function upstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function upstashPipeline(
  cfg: { url: string; token: string },
  commands: (string | number)[][],
): Promise<Array<{ result?: unknown; error?: string }>> {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upstash HTTP ${res.status}`);
  return (await res.json()) as Array<{ result?: unknown; error?: string }>;
}

async function checkRateUpstash(
  cfg: { url: string; token: string },
  namespace: string,
  key: string,
  opts: RateOpts,
): Promise<RateLimitResult> {
  const { max, windowMs } = opts;
  const now = Date.now();
  const idx = Math.floor(now / windowMs); // wall-clock fixed window
  const redisKey = `rl:${namespace}:${key}:${idx}`;
  const ttlSec = Math.ceil(windowMs / 1000) + 1;

  const out = await upstashPipeline(cfg, [
    ['INCR', redisKey],
    ['EXPIRE', redisKey, ttlSec, 'NX'], // set TTL only on first hit
  ]);
  const count = Number(out?.[0]?.result ?? NaN);
  if (!Number.isFinite(count) || count <= 0) throw new Error('upstash INCR failed');

  if (count > max) {
    const retryAfterSec = Math.max(1, Math.ceil(((idx + 1) * windowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  return { ok: true, remaining: max - count };
}

// ───────────────────────── public API ─────────────────────────

/**
 * Increment the counter for (`namespace`, `key`) and report whether the request
 * is within `max` per `windowMs`. Uses Upstash when configured, else in-memory;
 * an Upstash error fails over to the in-memory limiter (degraded, never open).
 */
export async function checkRate(
  namespace: string,
  key: string,
  opts: RateOpts,
): Promise<RateLimitResult> {
  const cfg = upstashConfig();
  if (cfg) {
    try {
      return await checkRateUpstash(cfg, namespace, key, opts);
    } catch (err) {
      console.warn(
        JSON.stringify({ event: 'ratelimit_upstash_fallback', error: String(err) }),
      );
      // fall through to in-memory
    }
  }
  return checkRateMemory(namespace, key, opts);
}

/**
 * Clear the counter for (`namespace`, `key`) — e.g. after a successful login so
 * a legit user isn't penalised. Pass `windowMs` to also clear the Upstash key.
 */
export async function resetRate(
  namespace: string,
  key: string,
  windowMs?: number,
): Promise<void> {
  namespaces.get(namespace)?.delete(key);
  const cfg = upstashConfig();
  if (cfg && windowMs) {
    try {
      const idx = Math.floor(Date.now() / windowMs);
      await upstashPipeline(cfg, [['DEL', `rl:${namespace}:${key}:${idx}`]]);
    } catch {
      // best-effort
    }
  }
}

/** Test-only: clear all in-memory limiter state. */
export function _resetRateLimit(): void {
  namespaces.clear();
  lastPrune = Date.now();
}
