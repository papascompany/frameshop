import Image from 'next/image';
import Link from 'next/link';
import type { MasterpieceTile } from '@/data/landing-curation';
import { cn } from '@/lib/cn';

type Props = {
  tiles: MasterpieceTile[];
};

/**
 * MasterpieceGallery — editorial 6-up of framed art prints.
 *
 *  Composition:
 *   - 4:5 portrait tiles on bg-soft-cloud (the "studio backdrop")
 *   - Image zooms ~4% on hover (with reduced-motion respect)
 *   - Metadata stack below image:
 *       artist (caption-sm uppercase) → title (heading-md, ink)
 *       size + swatch dot + frame label (caption-md, mute)
 *
 *  Grid:
 *   - mobile: 2 cols (so the eye sees an A/B comparison instantly)
 *   - tablet+: 3 cols
 *
 *  Each tile is a Link to the catalog filtered by size — the lowest-friction
 *  bridge from "I want THIS look" to "configure your photo".
 */
export function MasterpieceGallery({ tiles }: Props) {
  return (
    <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
      {tiles.map((tile) => (
        <li key={tile.imageUrl}>
          <Link
            href={tile.href}
            className="group block rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
            aria-label={`${tile.artist} ${tile.title} — ${tile.frameLabel} 액자로 시작`}
          >
            <div className="relative aspect-[4/5] bg-soft-cloud overflow-hidden">
              <Image
                src={tile.imageUrl}
                alt={tile.imageAlt}
                fill
                sizes="(max-width: 768px) 50vw, 33vw"
                className="object-cover zoom-on-hover"
                loading="lazy"
              />
              {/* Hover-revealed CTA overlay — subtle, never crowding the art. */}
              <div
                aria-hidden
                className={cn(
                  'absolute inset-x-0 bottom-0 p-4 scrim-bottom',
                  'opacity-0 group-hover:opacity-100 transition-opacity duration-300',
                  'flex items-center justify-between',
                )}
              >
                <span className="caption-sm text-canvas uppercase tracking-wider">
                  지금 만들기
                </span>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-canvas text-ink">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
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
            </div>

            <div className="mt-3 flex flex-col gap-1">
              <p className="caption-sm uppercase tracking-wider text-mute">
                {tile.artist}
              </p>
              <p className="heading-md text-ink truncate">{tile.title}</p>
              <div className="mt-1 flex items-center gap-2 caption-md text-mute">
                {tile.swatch ? (
                  <span
                    aria-hidden
                    className="swatch-dot"
                    style={{ background: tile.swatch }}
                  />
                ) : null}
                <span>{tile.frameLabel}</span>
                <span aria-hidden>·</span>
                <span>{tile.size}</span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
