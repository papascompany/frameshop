import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Props = HTMLAttributes<HTMLDivElement> & {
  padding?: 'none' | 'sm' | 'md' | 'lg';
};

export function Card({
  padding = 'md',
  className,
  children,
  ...rest
}: Props) {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-card',
        padding === 'none' && 'p-0',
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-4',
        padding === 'lg' && 'p-6',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
