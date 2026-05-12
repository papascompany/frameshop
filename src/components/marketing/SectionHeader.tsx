import Link from 'next/link';
import { cn } from '@/lib/cn';

type Props = {
  /** Optional small kicker line above the title (caption-sm uppercase). */
  eyebrow?: string;
  title: string;
  /** Inline link rendered on the right edge ("View All", "전체 보기"). */
  linkLabel?: string;
  linkHref?: string;
  className?: string;
};

/**
 * SectionHeader — Nike section header bar.
 *
 *  Composition (DESIGN-nike.md `heading-xl`):
 *   - 32px medium title text-ink, left-aligned
 *   - Optional eyebrow above in `caption-sm` uppercase
 *   - Optional right-aligned underlined link (`link-md`)
 *
 *  Used to introduce "FEATURED FRAMES" / "추천 액자" / "신상품" sections.
 *  This is the system's middle tier — never use `.display-campaign` (96px)
 *  for these; that lockup is reserved for the editorial campaign hero only.
 */
export function SectionHeader({
  eyebrow,
  title,
  linkLabel,
  linkHref,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'flex items-end justify-between gap-4 mb-6',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        {eyebrow ? (
          <p className="caption-sm uppercase text-mute tracking-wider">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="heading-xl text-ink">{title}</h2>
      </div>
      {linkLabel && linkHref ? (
        <Link
          href={linkHref}
          className="body-strong text-ink underline underline-offset-4 hover:text-charcoal transition-colors shrink-0"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
