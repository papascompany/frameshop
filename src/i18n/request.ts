/**
 * next-intl server-side request configuration.
 *
 * Called once per request on the server. Reads the locale from:
 *   1. NEXT_LOCALE cookie (user preference)
 *   2. Accept-Language header
 *   3. defaultLocale fallback ('ko')
 *
 * Messages are loaded dynamically per locale.
 */

import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { defaultLocale, LOCALE_COOKIE, locales, type Locale } from './routing';

function parseAcceptLanguage(header: string): Locale | null {
  // Parse the first matching locale from Accept-Language header.
  const parts = header.split(',').map((p) => p.split(';')[0]?.trim() ?? '');
  for (const part of parts) {
    const lang = part.split('-')[0]?.toLowerCase();
    if (lang && locales.includes(lang as Locale)) {
      return lang as Locale;
    }
  }
  return null;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  // 1. Cookie takes priority (user explicitly set a preference)
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  let locale: Locale = defaultLocale;

  if (cookieLocale && locales.includes(cookieLocale as Locale)) {
    locale = cookieLocale as Locale;
  } else {
    // 2. Fall back to Accept-Language header
    const acceptLang = headerStore.get('accept-language') ?? '';
    const detected = parseAcceptLanguage(acceptLang);
    if (detected) locale = detected;
  }

  const messages = (await import(`../messages/${locale}.json`)) as {
    default: Record<string, unknown>;
  };

  return {
    locale,
    messages: messages.default,
  };
});
