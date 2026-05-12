import Link from 'next/link';
import { Container } from './Container';

/**
 * Primary nav — Nike-aligned.
 *
 *  Surface (DESIGN-nike.md `primary-nav`):
 *   - bg-canvas, text-ink, 56–64px height
 *   - 1px inset hairline-soft bottom edge (the system's only "shadow")
 *   - logo at left, centered nav row, right cluster (cart/account)
 *   - active section gets a 2px underline in ink (no fill)
 *
 *  Mobile: center nav row collapses; brand + cart link remain. The bottom
 *  tab bar (`<MobileNav />`) carries the category navigation on small
 *  viewports.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 bg-canvas text-ink inset-hairline-bottom">
      <Container size="xl" className="flex items-center justify-between h-14">
        <Link
          href="/"
          className="body-strong tracking-tight uppercase text-ink"
        >
          FrameShop
        </Link>
        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-8 body-strong"
        >
          <Link
            href="/"
            className="text-ink hover:text-charcoal transition-colors"
          >
            홈
          </Link>
          <Link
            href="/catalog/basic-frame"
            className="text-ink hover:text-charcoal transition-colors"
          >
            카탈로그
          </Link>
          <Link
            href="/order/lookup"
            className="text-ink hover:text-charcoal transition-colors"
          >
            주문조회
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          <Link
            href="/cart"
            className="caption-md text-ink hover:text-charcoal transition-colors"
            aria-label="장바구니"
          >
            장바구니
          </Link>
        </div>
      </Container>
    </header>
  );
}
