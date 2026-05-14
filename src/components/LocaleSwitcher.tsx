'use client';

/**
 * Locale switcher button — KO / EN toggle in the header.
 *
 * Sets the NEXT_LOCALE cookie and reloads the page so next-intl
 * picks up the new locale on the next server render.
 * No URL change; cookie is read in src/i18n/request.ts.
 */

import { useTransition } from 'react';
import { LOCALE_COOKIE, locales, type Locale } from '@/i18n/routing';
import { cn } from '@/lib/cn';

type Props = {
  currentLocale: Locale;
};

export function LocaleSwitcher({ currentLocale }: Props) {
  const [isPending, startTransition] = useTransition();

  function switchLocale(next: Locale) {
    if (next === currentLocale) return;
    startTransition(() => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      window.location.reload();
    });
  }

  return (
    <div
      className="hidden md:flex items-center gap-0.5 text-xs font-medium"
      aria-label="언어 선택"
    >
      {locales.map((locale, i) => (
        <span key={locale} className="flex items-center">
          {i > 0 && <span className="text-muted-fg mx-0.5">/</span>}
          <button
            type="button"
            onClick={() => switchLocale(locale)}
            disabled={isPending || locale === currentLocale}
            className={cn(
              'px-1 py-0.5 rounded transition-colors',
              locale === currentLocale
                ? 'text-ink font-semibold cursor-default'
                : 'text-muted-fg hover:text-ink cursor-pointer',
            )}
            aria-pressed={locale === currentLocale}
            aria-label={locale === 'ko' ? '한국어' : 'English'}
          >
            {locale.toUpperCase()}
          </button>
        </span>
      ))}
    </div>
  );
}
