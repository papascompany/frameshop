import { cn } from '@/lib/cn';

type Props = {
  amount: number;
  /** Show "원~" suffix indicating "starting from". */
  showFrom?: boolean;
  /** Mute the styling (used in summary rows). */
  variant?: 'default' | 'large' | 'muted';
  className?: string;
};

/**
 * KRW price tag. Renders 4,800원 or 4,800원~ depending on `showFrom`.
 */
export function PriceTag({
  amount,
  showFrom,
  variant = 'default',
  className,
}: Props) {
  const formatted = new Intl.NumberFormat('ko-KR').format(amount);
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        variant === 'default' && 'text-accent text-base',
        variant === 'large' && 'text-accent text-2xl',
        variant === 'muted' && 'text-foreground text-base',
        className,
      )}
    >
      {formatted}
      <span className="ml-0.5 text-[0.85em] font-medium">원</span>
      {showFrom ? <span className="ml-0.5 text-[0.85em] font-medium">~</span> : null}
    </span>
  );
}
