import Image from 'next/image';
import Link from 'next/link';
import type { LandscapeTile } from '@/data/landing-curation';
import { cn } from '@/lib/cn';

type Props = {
  tiles: LandscapeTile[];
};

/**
 * CollectionRail — horizontal snap-scroll of large landscape photographs.
 *
 *  Behavior:
 *   - Mobile: full-bleed horizontal scroll with snap points (Nike pattern).
 *   - Desktop: 4-up grid with the 5th tile becoming a "all" CTA card.
 *
 *  Each tile is a 4:5 portrait photograph with the title burned into the
 *  lower-left in white on a soft dark scrim. Reading order is enforced by
 *  the visible title — the imageAlt covers screen reader requirements.
 */
export function CollectionRail({ tiles }: Props) {
  const visible = tiles.slice(0, 5);

  return (
    <>
      {/* Mobile: horizontal snap rail. */}
      <div
        className={cn(
          'md:hidden flex gap-3 overflow-x-auto snap-x snap-mandatory',
          '-mx-4 px-4 pb-4',
        )}
      >
        {visible.map((tile) => (
          <CollectionCard key={tile.imageUrl} tile={tile} mobile />
        ))}
      </div>

      {/* Desktop: 4-up grid + CTA. */}
      <div className="hidden md:grid md:grid-cols-4 lg:grid-cols-5 gap-3">
        {visible.slice(0, 4).map((tile) => (
          <CollectionCard key={tile.imageUrl} tile={tile} />
        ))}
        <Link
          href="/catalog/basic-frame?theme=landscape"
          className={cn(
            'relative block aspect-[4/5] overflow-hidden rounded-none',
            'bg-ink text-on-primary',
            '[background-image:radial-gradient(circle_at_70%_30%,#1f1f1f_0%,#0a0a0a_75%)]',
            'flex flex-col justify-between p-5 lift-on-hover',
          )}
        >
          <span className="caption-sm uppercase tracking-wider text-stone">
            전체 컬렉션
          </span>
          <div>
            <p className="display-campaign" style={{ fontSize: 'clamp(40px, 4vw, 56px)', lineHeight: 0.95 }}>
              VIEW
              <br />
              ALL
            </p>
            <span className="mt-3 inline-flex items-center gap-2 caption-md text-canvas">
              풍경 컬렉션 전체 보기
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="M1 7h12m0 0L7.5 1.5M13 7l-5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        </Link>
      </div>
    </>
  );
}

function CollectionCard({
  tile,
  mobile = false,
}: {
  tile: LandscapeTile;
  mobile?: boolean;
}) {
  return (
    <Link
      href={tile.href}
      className={cn(
        'group relative block overflow-hidden rounded-none',
        'aspect-[4/5]',
        mobile ? 'snap-start shrink-0 w-[72%]' : '',
      )}
      aria-label={`${tile.title} — ${tile.caption}`}
    >
      <Image
        src={tile.imageUrl}
        alt={tile.imageAlt}
        fill
        sizes={mobile ? '72vw' : '(max-width: 1024px) 25vw, 20vw'}
        className="object-cover zoom-on-hover"
        loading="lazy"
      />
      <div aria-hidden className="absolute inset-0 scrim-bottom" />
      <div className="absolute inset-x-0 bottom-0 p-5 flex flex-col gap-1 text-canvas">
        <h3
          className="display-campaign"
          style={{ fontSize: 'clamp(28px, 3vw, 40px)', lineHeight: 0.95 }}
        >
          {tile.title}
        </h3>
        <p className="caption-md text-canvas/85">{tile.caption}</p>
      </div>
    </Link>
  );
}
