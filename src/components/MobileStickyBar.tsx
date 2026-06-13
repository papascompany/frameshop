import type { ReactNode } from 'react';

/**
 * Mobile-only sticky action bar for conversion screens (cart / checkout /
 * studio). Fixed just above the persistent MobileNav (which is fixed at
 * bottom-0, ~64px incl. safe area) so the primary CTA + total are always
 * thumb-reachable. Hidden on md+ where the in-rail button is used instead.
 *
 * Pages that render this MUST add bottom padding (≈ pb-24 on mobile) so the
 * last content clears the bar. Children are submit-aware: a type="submit"
 * button inside still submits an ancestor <form> regardless of position:fixed.
 */
export function MobileStickyBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed left-0 right-0 z-20 md:hidden bg-canvas border-t border-hairline px-4 py-2.5"
      style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      {children}
    </div>
  );
}
