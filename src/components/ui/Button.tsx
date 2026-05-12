'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Nike-aligned pill button.
 *
 *  Vocabulary (DESIGN-nike.md):
 *   - primary           — black ink pill on light surfaces
 *   - secondary         — soft-cloud pill, lower-emphasis alternate
 *   - outline-on-image  — crisp white pill anchored on photography
 *   - icon-circular     — 40×40 round soft-cloud icon control
 *   - ghost / danger    — legacy compatibility aliases (rarely used; danger
 *                         renders as a black pill with sale-red text label,
 *                         since Nike never uses red as a background)
 *
 *  Shape vocabulary is strictly pill (rounded-[30px]) or full circle —
 *  NEVER a square. The legacy `rounded-button` token now equals 30px,
 *  so any older call site collapses into the same pill geometry.
 *
 *  "Tap collapse" — active state scales to 0.98 with opacity 0.9 (Nike's
 *  signature feedback, toned down from 0.5 to fit a calmer commerce site).
 */

type Variant =
  | 'primary'
  | 'secondary'
  | 'outline-on-image'
  | 'icon-circular'
  | 'ghost'
  | 'danger';

type Size = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
};

const variantClass: Record<Variant, string> = {
  primary: 'bg-ink text-on-primary hover:bg-charcoal',
  secondary: 'bg-soft-cloud text-ink hover:bg-hairline-soft',
  'outline-on-image': 'bg-canvas text-ink hover:bg-soft-cloud',
  'icon-circular':
    'bg-soft-cloud text-ink hover:bg-hairline-soft p-0 aspect-square',
  // ghost = bordered transparent (used by Cancel-style alternates)
  ghost:
    'bg-transparent text-ink border border-hairline hover:bg-soft-cloud',
  // danger = black pill, no red background (Nike never paints chrome red).
  // Use this sparingly for destructive labels; the label itself can carry
  // text-sale color where appropriate.
  danger: 'bg-ink text-on-primary hover:bg-sale-deep',
};

const sizeClass: Record<Size, string> = {
  // sm/md/lg follow Nike's pill heights (40/48/56) with horizontal padding
  // that respects the 8px base grid.
  sm: 'h-10 px-4 text-sm',
  md: 'h-12 px-8 text-base',
  lg: 'h-14 px-10 text-lg',
};

const iconCircularSize: Record<Size, string> = {
  sm: 'h-9 w-9',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    startIcon,
    endIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isIcon = variant === 'icon-circular';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap',
        'transition-colors duration-150',
        // Pill geometry — universal across the system.
        isIcon ? 'rounded-full' : 'rounded-[30px]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        // Tap-collapse pressed state.
        'tap-collapse',
        // Visible focus — true ink ring, never red on chrome.
        'focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 focus-visible:outline',
        isIcon ? iconCircularSize[size] : sizeClass[size],
        variantClass[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {startIcon ? <span aria-hidden>{startIcon}</span> : null}
      {children !== undefined && children !== null ? (
        <span>{children}</span>
      ) : null}
      {endIcon ? <span aria-hidden>{endIcon}</span> : null}
    </button>
  );
});
