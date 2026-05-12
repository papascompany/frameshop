import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'accent' | 'dark' | 'success' | 'warning';

type Props = HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

const variantClass: Record<Variant, string> = {
  default: 'bg-surface-muted text-foreground border border-border',
  accent: 'bg-accent text-accent-fg',
  dark: 'bg-header text-header-fg',
  success: 'bg-success text-white',
  warning: 'bg-warning text-white',
};

export function Badge({
  variant = 'default',
  className,
  children,
  ...rest
}: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium',
        'rounded-full',
        variantClass[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
