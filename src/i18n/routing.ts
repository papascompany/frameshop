/**
 * next-intl locale configuration.
 *
 * Strategy: cookie-based locale (no URL changes).
 *   - Default locale: ko
 *   - Supported locales: ko, en
 *   - User preference stored in NEXT_LOCALE cookie
 */

export const locales = ['ko', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ko';

/** Cookie name for locale preference (next-intl convention). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';
