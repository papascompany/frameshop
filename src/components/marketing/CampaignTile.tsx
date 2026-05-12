import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  imageUrl: string;
  imageAlt: string;
  headline: ReactNode;
  /** Headline burn-in color — chosen per-asset against the photograph. */
  headlineColor?: 'light' | 'dark';
  /** Optional copy under the headline (16px body, same color as headline). */
  subhead?: ReactNode;
  cta?: { label: string; href: string };
  /** Aspect ratio — mobile defaults to 4:5 (portrait), desktop swaps to 16:9. */
  aspect?: '16/9' | '4/5';
  className?: string;
};

/**
 * CampaignTile — Nike's signature editorial unit.
 *
 *  Composition (DESIGN-nike.md `campaign-tile`):
 *   - Full-bleed photography (rounded.none — never softened).
 *   - `.display-campaign` headline (Bebas Neue 96px uppercase, line-height
 *     0.9) burned directly into the lower-left third of the image.
 *   - Headline color is `light` (canvas) or `dark` (ink) — chosen per-asset
 *     to read against the underlying photograph.
 *   - A single `outline-on-image` CTA pill anchored bottom-left.
 *
 *  Art direction: the mobile crop swaps to 4:5 portrait so the figure stays
 *  centered and the headline still has burn-in space (Nike does this
 *  programmatically with picture/srcset; here we just toggle aspect via
 *  Tailwind utilities).
 *
 *  Use sparingly — at most one campaign tile per page fold. Pair it with
 *  product grids or category rails, never with another campaign tile of
 *  the same scale.
 */
export function CampaignTile({
  imageUrl,
  imageAlt,
  headline,
  headlineColor = 'light',
  subhead,
  cta,
  aspect = '16/9',
  className,
}: Props) {
  const textTone =
    headlineColor === 'light' ? 'text-canvas' : 'text-ink';

  return (
    <section
      className={cn(
        'relative w-full overflow-hidden rounded-none',
        // Mobile is always tall portrait, desktop respects the requested aspect.
        'aspect-[4/5]',
        aspect === '16/9' ? 'md:aspect-[16/9]' : 'md:aspect-[4/5]',
        className,
      )}
    >
      <Image
        src={imageUrl}
        alt={imageAlt}
        fill
        sizes="(max-width: 768px) 100vw, 100vw"
        className="object-cover"
        priority
      />
      <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-12">
        <h2 className={cn('display-campaign max-w-[12ch]', textTone)}>
          {headline}
        </h2>
        {subhead ? (
          <p className={cn('mt-4 body-md max-w-[40ch]', textTone)}>
            {subhead}
          </p>
        ) : null}
        {cta ? (
          <div className="mt-6">
            <Link
              href={cta.href}
              className={cn(
                'inline-flex items-center justify-center',
                'h-12 px-8 rounded-[30px] body-strong tap-collapse',
                'bg-canvas text-ink hover:bg-soft-cloud transition-colors',
                'focus-visible:outline-2 focus-visible:outline-canvas focus-visible:outline-offset-2 focus-visible:outline',
              )}
            >
              {cta.label}
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
