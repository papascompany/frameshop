/**
 * Generic rate limiter + trusted client-IP extraction (security Phase 0).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { checkRate, _resetRateLimit } from '@/lib/ratelimit';
import { getClientIp } from '@/lib/security/client-ip';

afterEach(() => _resetRateLimit());

describe('checkRate', () => {
  it('allows up to `max` then blocks within the window', () => {
    const opts = { max: 3, windowMs: 60_000 };
    expect(checkRate('ns', 'k', opts).ok).toBe(true);
    expect(checkRate('ns', 'k', opts).ok).toBe(true);
    expect(checkRate('ns', 'k', opts).ok).toBe(true);
    const blocked = checkRate('ns', 'k', opts);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('isolates counters by namespace and by key', () => {
    const opts = { max: 1, windowMs: 60_000 };
    expect(checkRate('a', 'k', opts).ok).toBe(true);
    expect(checkRate('a', 'k', opts).ok).toBe(false); // same ns+key blocked
    expect(checkRate('b', 'k', opts).ok).toBe(true); // different ns
    expect(checkRate('a', 'k2', opts).ok).toBe(true); // different key
  });

  it('reports decreasing remaining', () => {
    const opts = { max: 2, windowMs: 60_000 };
    const r1 = checkRate('ns', 'x', opts);
    const r2 = checkRate('ns', 'x', opts);
    expect(r1.ok && r1.remaining).toBe(1);
    expect(r2.ok && r2.remaining).toBe(0);
  });
});

describe('getClientIp', () => {
  const h = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

  it('prefers x-real-ip (Vercel-managed, not client-spoofable)', () => {
    expect(getClientIp(h({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.9');
  });

  it('uses the RIGHT-most x-forwarded-for hop (spoofed left-most is ignored)', () => {
    // Attacker sends "X-Forwarded-For: 1.1.1.1"; the proxy appends the real IP.
    expect(getClientIp(h({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('falls back to "unknown" when no headers present', () => {
    expect(getClientIp(h({}))).toBe('unknown');
  });
});
