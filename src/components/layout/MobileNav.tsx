import Link from 'next/link';

/**
 * Mobile-only bottom tab bar. Sits below the fold on `md+` viewports
 * (hidden via `md:hidden`).
 */
export function MobileNav() {
  return (
    <nav
      aria-label="Mobile"
      className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-surface border-t border-border"
    >
      <ul className="grid grid-cols-3 text-xs">
        <li>
          <Link
            href="/"
            className="flex flex-col items-center gap-1 py-3 hover:text-accent"
          >
            홈
          </Link>
        </li>
        <li>
          <Link
            href="/catalog/basic-frame"
            className="flex flex-col items-center gap-1 py-3 hover:text-accent"
          >
            카탈로그
          </Link>
        </li>
        <li>
          <Link
            href="/cart"
            className="flex flex-col items-center gap-1 py-3 hover:text-accent"
          >
            장바구니
          </Link>
        </li>
      </ul>
    </nav>
  );
}
