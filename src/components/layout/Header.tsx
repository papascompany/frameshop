import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Container } from './Container';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { cn } from '@/lib/cn';
import type { Locale } from '@/i18n/routing';

/**
 * Primary nav — Nike-aligned, gallery-grade.
 *
 *  Surface:
 *   - Sticky bg-canvas / text-ink. 1px inset hairline-soft bottom edge.
 *   - Logo at left (Bebas Neue uppercase, no icon — the wordmark IS the
 *     mark on Phase 1).
 *   - Centered nav row with magnetic underline (.nav-link).
 *   - Right cluster: search pill + 주문조회 + cart (with badge slot).
 *
 *  Mobile: the center row collapses, but `<MobileNav />` (bottom tab bar)
 *  carries the navigation. The right cluster collapses to cart-only.
 *
 *  Active-state underline uses `aria-current="page"`. Phase 2 wires this
 *  via `usePathname()` in a thin client wrapper — Phase 1 keeps the file
 *  RSC-only to avoid an extra client-bundle hop on every render.
 */
export async function Header() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations('header');

  return (
    <header className="sticky top-0 z-40 bg-canvas text-ink inset-hairline-bottom">
      <Container size="xl" className="flex items-center justify-between h-14 md:h-16 gap-4">
        {/* ── Brand ───────────────────────────────────────────────────── */}
        <Link
          href="/"
          className="display-campaign text-ink shrink-0"
          style={{ fontSize: '22px', letterSpacing: '0.02em', lineHeight: 1 }}
          aria-label={t('logo')}
        >
          FRAMESHOP
        </Link>

        {/* ── Center nav (desktop) ───────────────────────────────────── */}
        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-6 body-strong"
        >
          <Link href="/catalog/basic-frame" className="nav-link">
            {t('frames')}
          </Link>
          <Link
            href="/catalog/basic-frame?theme=masterpiece"
            className="nav-link"
          >
            {t('masterpiece')}
          </Link>
          <Link
            href="/catalog/basic-frame?theme=landscape"
            className="nav-link"
          >
            {t('landscape')}
          </Link>
          <Link href="/#how-it-works" className="nav-link">
            {t('howItWorks')}
          </Link>
          <Link href="/order/lookup" className="nav-link">
            {t('orderLookup')}
          </Link>
          <Link href="/account/orders" className="nav-link">
            {t('myPage')}
          </Link>
        </nav>

        {/* ── Right cluster ──────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          {/* Language switcher */}
          <LocaleSwitcher currentLocale={locale} />
          {/* Search pill — visual placeholder on Phase 1 (search route lands
           * in Phase 2). The disabled cursor + title attr signals the
           * "coming soon" state to power users without clutter. */}
          <span
            className={cn(
              'hidden md:inline-flex items-center gap-2',
              'h-10 px-4 rounded-[24px] bg-soft-cloud caption-md text-mute',
              'cursor-not-allowed select-none',
            )}
            aria-disabled="true"
            title={t('searchComingSoon')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
            >
              <circle
                cx="7"
                cy="7"
                r="5"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M14 14L11 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span>{t('search')}</span>
          </span>

          <Link
            href="/cart"
            className={cn(
              'inline-flex items-center gap-2 px-3 h-10 rounded-[24px]',
              'caption-md text-ink hover:bg-soft-cloud transition-colors',
            )}
            aria-label={t('cart')}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden
            >
              <path
                d="M3 4h2l1.5 9.5a2 2 0 0 0 2 1.5h6.4a2 2 0 0 0 2-1.6L18 6H6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8.5" cy="17.5" r="1.2" fill="currentColor" />
              <circle cx="15.5" cy="17.5" r="1.2" fill="currentColor" />
            </svg>
            <span className="hidden sm:inline">{t('cart')}</span>
          </Link>
        </div>
      </Container>
    </header>
  );
}
