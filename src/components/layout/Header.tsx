import Link from 'next/link';
import { Container } from './Container';

/**
 * Site header — sticky, dark, with brand + cart link.
 * Mobile shows only brand + cart; categories live in <MobileNav> bottom bar.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 bg-header text-header-fg">
      <Container size="xl" className="flex items-center justify-between h-14">
        <Link href="/" className="text-base font-semibold tracking-tight">
          FrameShop
        </Link>
        <nav aria-label="Primary" className="hidden md:flex items-center gap-6 text-sm">
          <Link href="/" className="hover:text-accent">홈</Link>
          <Link href="/catalog/basic-frame" className="hover:text-accent">카탈로그</Link>
          <Link href="/order/lookup" className="hover:text-accent">주문조회</Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/cart"
            className="text-sm hover:text-accent"
            aria-label="장바구니"
          >
            장바구니
          </Link>
        </div>
      </Container>
    </header>
  );
}
