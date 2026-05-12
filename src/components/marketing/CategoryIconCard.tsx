import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  /** A 24–48px icon node (svg, lucide icon, emoji). Sized to ~96px slot. */
  icon: ReactNode;
  label: string;
  href: string;
  className?: string;
};

/**
 * CategoryIconCard — Nike "Latest in Clothing"-style icon strip card.
 *
 *  Composition (DESIGN-nike.md `category-icon-card`):
 *   - bg-canvas, rounded.none (no card chrome at all)
 *   - ~80–96px centered illustration slot on `bg-soft-cloud`
 *   - caption-md (14px medium) label directly below
 *
 *  Used as a 4–8-up grid for category quick-jumps on the landing page —
 *  e.g. "베이직 액자", "프리미엄 액자", "포토 프린트", "포스터".
 */
export function CategoryIconCard({ icon, label, href, className }: Props) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col items-center gap-3 rounded-none',
        'tap-collapse',
        className,
      )}
      aria-label={label}
    >
      <div
        className={cn(
          'flex items-center justify-center',
          'h-24 w-24 md:h-28 md:w-28',
          'bg-soft-cloud rounded-none',
          'text-ink transition-colors group-hover:bg-hairline-soft',
        )}
        aria-hidden
      >
        <span className="text-3xl md:text-4xl">{icon}</span>
      </div>
      <span className="caption-md text-ink text-center">{label}</span>
    </Link>
  );
}
