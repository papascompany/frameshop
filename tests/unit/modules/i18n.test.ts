/**
 * i18n (next-intl) — locale routing + message completeness tests.
 *
 * Validates that:
 * 1. Locale detection from cookie/Accept-Language is correct.
 * 2. en.json has no keys missing that ko.json has (key completeness).
 * 3. ko.json has no keys missing that en.json has (bidirectional).
 * 4. LOCALE_COOKIE name matches the next-intl convention.
 */

import { describe, expect, it } from 'vitest';
import { locales, defaultLocale, LOCALE_COOKIE, type Locale } from '@/i18n/routing';
import koMessages from '@/messages/ko.json';
import enMessages from '@/messages/en.json';

// ─── Locale config ────────────────────────────────────────────────────────────

describe('locale configuration', () => {
  it('supports ko and en', () => {
    expect(locales).toContain('ko');
    expect(locales).toContain('en');
  });

  it('defaults to ko', () => {
    expect(defaultLocale).toBe('ko');
  });

  it('uses NEXT_LOCALE as the cookie name', () => {
    expect(LOCALE_COOKIE).toBe('NEXT_LOCALE');
  });

  it('has exactly 2 locales', () => {
    expect(locales).toHaveLength(2);
  });
});

// ─── Accept-Language parsing helper (mirrors i18n/request.ts logic) ──────────

function parseAcceptLanguage(header: string): Locale | null {
  const parts = header.split(',').map((p) => p.split(';')[0]?.trim() ?? '');
  for (const part of parts) {
    const lang = part.split('-')[0]?.toLowerCase();
    if (lang && locales.includes(lang as Locale)) {
      return lang as Locale;
    }
  }
  return null;
}

describe('parseAcceptLanguage', () => {
  it('detects ko from ko-KR', () => {
    expect(parseAcceptLanguage('ko-KR,ko;q=0.9')).toBe('ko');
  });

  it('detects en from en-US', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });

  it('returns null for unsupported locale', () => {
    expect(parseAcceptLanguage('fr-FR,fr;q=0.9')).toBeNull();
  });

  it('returns first supported locale', () => {
    expect(parseAcceptLanguage('fr-FR,ko;q=0.8')).toBe('ko');
  });

  it('handles empty header', () => {
    expect(parseAcceptLanguage('')).toBeNull();
  });

  it('is case-insensitive for lang tag', () => {
    expect(parseAcceptLanguage('EN-US')).toBe('en');
  });
});

// ─── Locale resolution (cookie > Accept-Language > default) ──────────────────

function resolveLocale(cookie: string | null, acceptLanguage: string): Locale {
  if (cookie && locales.includes(cookie as Locale)) {
    return cookie as Locale;
  }
  const detected = parseAcceptLanguage(acceptLanguage);
  return detected ?? defaultLocale;
}

describe('resolveLocale', () => {
  it('returns cookie locale when valid', () => {
    expect(resolveLocale('en', '')).toBe('en');
  });

  it('ignores invalid cookie and falls back to header', () => {
    expect(resolveLocale('fr', 'en-US')).toBe('en');
  });

  it('falls back to defaultLocale when both are missing', () => {
    expect(resolveLocale(null, '')).toBe('ko');
  });

  it('cookie takes priority over accept-language', () => {
    expect(resolveLocale('en', 'ko-KR')).toBe('en');
  });
});

// ─── Message key completeness ─────────────────────────────────────────────────

/** Flatten a nested object to dotted keys: { a: { b: 1 } } → ['a.b'] */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe('message completeness', () => {
  const koKeys = new Set(flattenKeys(koMessages as Record<string, unknown>));
  const enKeys = new Set(flattenKeys(enMessages as Record<string, unknown>));

  it('en.json has all keys that ko.json has', () => {
    const missing = [...koKeys].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('ko.json has all keys that en.json has', () => {
    const missing = [...enKeys].filter((k) => !koKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('both locales have the common.loading key', () => {
    expect(koKeys.has('common.loading')).toBe(true);
    expect(enKeys.has('common.loading')).toBe(true);
  });

  it('both locales have the header.cart key', () => {
    expect(koKeys.has('header.cart')).toBe(true);
    expect(enKeys.has('header.cart')).toBe(true);
  });

  it('both locales have all order status keys', () => {
    const statuses = ['CREATED', 'PAID', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
    for (const status of statuses) {
      expect(koKeys.has(`order.status.${status}`), `ko: order.status.${status}`).toBe(true);
      expect(enKeys.has(`order.status.${status}`), `en: order.status.${status}`).toBe(true);
    }
  });

  it('both locales have the extended editor keys (studio.multi* / product.multiCta — FS-P1-03)', () => {
    const required = [
      'product.multiCta',
      'studio.multiUpload',
      'studio.multiUploading',
      'studio.multiPool',
      'studio.multiPoolEmpty',
      'studio.multiPoolSelectHint',
      'studio.multiPoolRemove',
      'studio.multiPoolRemoveNote',
      'studio.multiLines',
      'studio.multiApplyAll',
      'studio.multiDuplicate',
      'studio.multiDelete',
      'studio.multiSize',
      'studio.multiOrientation',
      'studio.multiPortrait',
      'studio.multiLandscape',
      'studio.multiQtyDecrease',
      'studio.multiQtyIncrease',
      'studio.multiUnavailable',
      'studio.multiRecropBadge',
      'studio.multiRecrop',
      'studio.multiCheckout',
      'studio.multiOptionsHint',
      'studio.multiTotalQuantity',
      'studio.multiUnitPrice',
    ];
    for (const key of required) {
      expect(koKeys.has(key), `ko: ${key}`).toBe(true);
      expect(enKeys.has(key), `en: ${key}`).toBe(true);
    }
  });
});
