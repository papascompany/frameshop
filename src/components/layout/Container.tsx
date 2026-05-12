import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Props = HTMLAttributes<HTMLDivElement> & {
  /** Max-width: 'sm' (640) / 'md' (768) / 'lg' (1024) / 'xl' (1280). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

const sizeMap = {
  sm: 'max-w-[640px]',
  md: 'max-w-[768px]',
  lg: 'max-w-[1024px]',
  xl: 'max-w-[1280px]',
} as const;

export function Container({ size = 'lg', className, children, ...rest }: Props) {
  return (
    <div
      className={cn('mx-auto w-full px-4 md:px-6', sizeMap[size], className)}
      {...rest}
    >
      {children}
    </div>
  );
}
