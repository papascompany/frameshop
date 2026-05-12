'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
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
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover focus-visible:bg-accent-hover',
  secondary:
    'bg-header text-header-fg hover:bg-black focus-visible:bg-black',
  ghost:
    'bg-transparent text-foreground border border-border hover:bg-surface-muted',
  danger:
    'bg-danger text-white hover:opacity-90',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-base',
  lg: 'h-14 px-6 text-lg',
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
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap',
        'transition-colors duration-150',
        'rounded-button',
        // sharp by default; rounded variant via override
        'rounded-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
        sizeClass[size],
        variantClass[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {startIcon ? <span aria-hidden>{startIcon}</span> : null}
      <span>{children}</span>
      {endIcon ? <span aria-hidden>{endIcon}</span> : null}
    </button>
  );
});
