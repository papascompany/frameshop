import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

/**
 * Mobile-only bottom tab bar.
 *
 *  Five tabs (홈 / 액자 / 명화 / 풍경 / 장바구니) keep the primary
 *  navigation reachable with a single thumb while the desktop header is
 *  collapsed. Each tab is 44 × 44 (Apple HIG minimum) and the labels use
 *  caption-sm so the row fits a 360 px viewport without wrapping.
 *
 *  Active-state underline is left to a future client-side wrapper; Phase
 *  1 ships this as a pure RSC to avoid an extra client bundle hop.
 */
export function MobileNav() {
  return (
    <nav
      aria-label="Mobile"
      className={cn(
        'fixed bottom-0 left-0 right-0 z-30 md:hidden',
        'bg-canvas border-t border-hairline',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="grid grid-cols-5 caption-sm">
        <NavItem href="/" label="홈" icon={<IconHome />} />
        <NavItem href="/catalog/basic-frame" label="액자" icon={<IconFrame />} />
        <NavItem href="/catalog/masterpiece" label="명화" icon={<IconArt />} />
        <NavItem href="/catalog/landscape" label="풍경" icon={<IconMountain />} />
        <NavItem href="/cart" label="장바구니" icon={<IconBag />} />
      </ul>
    </nav>
  );
}

function NavItem({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          'flex flex-col items-center justify-center gap-0.5 py-2',
          'text-ink hover:text-charcoal transition-colors',
          'min-h-[52px]',
        )}
      >
        <span aria-hidden className="text-ink">
          {icon}
        </span>
        <span>{label}</span>
      </Link>
    </li>
  );
}

const stroke = { stroke: 'currentColor', strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path d="M3 9l7-6 7 6v7a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V9z" {...stroke} />
    </svg>
  );
}
function IconFrame() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <rect x="3" y="3" width="14" height="14" {...stroke} />
      <rect x="6" y="6" width="8" height="8" {...stroke} />
    </svg>
  );
}
function IconArt() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <rect x="3" y="3" width="14" height="14" rx="1" {...stroke} />
      <circle cx="7" cy="8" r="1.2" {...stroke} />
      <path d="M3 14l4-4 5 5 5-6" {...stroke} />
    </svg>
  );
}
function IconMountain() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path d="M2 16l5-8 3 4 2-2 6 6H2z" {...stroke} />
      <circle cx="14" cy="5" r="1.5" {...stroke} />
    </svg>
  );
}
function IconBag() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path d="M5 6h10l-1 11H6L5 6z" {...stroke} />
      <path d="M7 6V4a3 3 0 0 1 6 0v2" {...stroke} />
    </svg>
  );
}
