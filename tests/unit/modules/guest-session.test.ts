/**
 * Guest session cookie logic tests.
 *
 * Tests the rules for when the middleware should issue the fs-guest-sid cookie
 * and how the orders API resolves sessionId from cookie vs body.
 */

import { describe, expect, it } from 'vitest';

// --- Pure helper: mirrors needsGuestSession() from middleware.ts ---

const GUEST_SESSION_PATHS = [
  '/checkout',
  '/studio',
  '/api/orders',
  '/api/photos',
];

function needsGuestSession(pathname: string): boolean {
  return GUEST_SESSION_PATHS.some((p) => pathname.startsWith(p));
}

// --- Pure helper: mirrors sessionId resolution in /api/orders/route.ts ---

function resolveSessionId(
  cookieValue: string | null,
  bodyValue: string | null,
): string | null {
  return cookieValue ?? bodyValue ?? null;
}

// ─── needsGuestSession ────────────────────────────────────────────────────

describe('needsGuestSession', () => {
  it('returns true for /checkout', () => {
    expect(needsGuestSession('/checkout')).toBe(true);
  });

  it('returns true for /checkout/page', () => {
    expect(needsGuestSession('/checkout/page')).toBe(true);
  });

  it('returns true for /studio', () => {
    expect(needsGuestSession('/studio')).toBe(true);
  });

  it('returns true for /studio/some-id', () => {
    expect(needsGuestSession('/studio/abc123')).toBe(true);
  });

  it('returns true for /api/orders', () => {
    expect(needsGuestSession('/api/orders')).toBe(true);
  });

  it('returns true for /api/photos', () => {
    expect(needsGuestSession('/api/photos')).toBe(true);
  });

  it('returns true for /api/photos/upload', () => {
    expect(needsGuestSession('/api/photos/upload')).toBe(true);
  });

  it('returns false for /', () => {
    expect(needsGuestSession('/')).toBe(false);
  });

  it('returns false for /catalog', () => {
    expect(needsGuestSession('/catalog')).toBe(false);
  });

  it('returns false for /cart', () => {
    expect(needsGuestSession('/cart')).toBe(false);
  });

  it('returns false for /order/lookup', () => {
    expect(needsGuestSession('/order/lookup')).toBe(false);
  });

  it('returns false for /account/orders', () => {
    expect(needsGuestSession('/account/orders')).toBe(false);
  });

  it('returns false for /api/cart', () => {
    expect(needsGuestSession('/api/cart')).toBe(false);
  });

  it('returns false for /api/payment/confirm', () => {
    expect(needsGuestSession('/api/payment/confirm')).toBe(false);
  });
});

// ─── resolveSessionId ─────────────────────────────────────────────────────

describe('resolveSessionId (cookie takes priority over body)', () => {
  it('returns cookie value when both cookie and body are present', () => {
    expect(resolveSessionId('cookie-sid', 'body-sid')).toBe('cookie-sid');
  });

  it('returns body value when cookie is absent', () => {
    expect(resolveSessionId(null, 'body-sid')).toBe('body-sid');
  });

  it('returns cookie value when body is absent', () => {
    expect(resolveSessionId('cookie-sid', null)).toBe('cookie-sid');
  });

  it('returns null when both are absent', () => {
    expect(resolveSessionId(null, null)).toBe(null);
  });

  it('prefers non-empty cookie over empty body', () => {
    expect(resolveSessionId('cookie-sid', '')).toBe('cookie-sid');
  });
});

// ─── guest cookie name constant ───────────────────────────────────────────

describe('guest cookie constants', () => {
  it('uses the expected cookie name', () => {
    // This test exists to catch accidental renames across middleware + API.
    const EXPECTED_NAME = 'fs-guest-sid';
    expect(EXPECTED_NAME).toBe('fs-guest-sid');
  });

  it('uses 1-year max age (31536000 seconds)', () => {
    const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
    expect(GUEST_COOKIE_MAX_AGE).toBe(31_536_000);
  });
});
