import Link from 'next/link';

/**
 * Mobile-only bottom tab bar.
 *
 *  Surface (DESIGN-nike.md `primary-nav` mobile drawer pattern, adapted to
 *  a frame-commerce 3-tab footer):
 *   - bg-canvas + 1px hairline top divider
 *   - text-ink labels; active state would be 2px underline (left to page-
 *     level state — Phase 2)
 *
 *  Hidden on `md+` viewports — the desktop primary nav handles those.
 */
export function MobileNav() {
  return (
    <nav
      aria-label="Mobile"
      className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-canvas border-t border-hairline"
    >
      <ul className="grid grid-cols-3 caption-md">
        <li>
          <Link
            href="/"
            className="flex flex-col items-center gap-1 py-3 text-ink hover:text-charcoal transition-colors"
          >
            홈
          </Link>
        </li>
        <li>
          <Link
            href="/catalog/basic-frame"
            className="flex flex-col items-center gap-1 py-3 text-ink hover:text-charcoal transition-colors"
          >
            카탈로그
          </Link>
        </li>
        <li>
          <Link
            href="/cart"
            className="flex flex-col items-center gap-1 py-3 text-ink hover:text-charcoal transition-colors"
          >
            장바구니
          </Link>
        </li>
      </ul>
    </nav>
  );
}
