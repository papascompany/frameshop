import { cn } from '@/lib/cn';

type Props = {
  amount: number;
  /** Original (pre-discount) price — strikes through and shows sale color. */
  originalAmount?: number;
  /** Show "원~" suffix indicating "starting from". */
  showFrom?: boolean;
  /** Size variant. */
  variant?: 'default' | 'large' | 'muted';
  className?: string;
};

/**
 * KRW price tag — Nike-aligned.
 *
 *  Rule of thumb (DESIGN-nike.md):
 *   - Regular price is `text-ink` (true black), NOT red.
 *   - Sale is signaled by `text-sale` on the discounted figure plus a
 *     strike-through `text-mute` for the original — no badge, no background.
 *   - `variant="muted"` is for cart-summary subtotal rows where the price
 *     should sit quietly next to a heavier label.
 *
 *  Background is always transparent; this component never paints a chip.
 */
export function PriceTag({
  amount,
  originalAmount,
  showFrom,
  variant = 'default',
  className,
}: Props) {
  const fmt = (n: number) => new Intl.NumberFormat('ko-KR').format(n);
  const isSale = typeof originalAmount === 'number' && originalAmount > amount;
  const discountPct = isSale
    ? Math.round(((originalAmount! - amount) / originalAmount!) * 100)
    : 0;

  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-2 font-medium tabular-nums',
        variant === 'default' && 'text-base',
        variant === 'large' && 'text-2xl',
        variant === 'muted' && 'text-base text-mute',
        className,
      )}
    >
      <span className={cn(isSale ? 'text-sale' : 'text-ink')}>
        {fmt(amount)}
        <span className="ml-0.5 text-[0.85em]">원</span>
        {showFrom ? <span className="ml-0.5 text-[0.85em]">~</span> : null}
      </span>
      {isSale ? (
        <>
          <span className="text-mute line-through text-[0.85em] font-normal">
            {fmt(originalAmount!)}원
          </span>
          <span className="text-sale text-[0.85em]">{discountPct}% off</span>
        </>
      ) : null}
    </span>
  );
}
