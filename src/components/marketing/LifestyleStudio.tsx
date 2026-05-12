import Image from 'next/image';
import Link from 'next/link';
import type { LifestyleBlock } from '@/data/landing-curation';
import { cn } from '@/lib/cn';

type Props = {
  block: LifestyleBlock;
  /** Image side — defaults to right so the headline anchors left. */
  imageOn?: 'left' | 'right';
};

/**
 * LifestyleStudio — split editorial block (50% photograph / 50% copy).
 *
 *  Used to give the landing a "magazine spread" beat after the masterpiece
 *  grid — slows the eye, lets the brand voice breathe, and converts users
 *  who skim past product tiles.
 *
 *  Mobile: stacks vertically with the photograph on top. Bullets render
 *  as a dot-divided list so the block doesn't grow taller than the device.
 */
export function LifestyleStudio({ block, imageOn = 'right' }: Props) {
  const imageOrder =
    imageOn === 'right'
      ? 'md:order-2 md:col-start-2'
      : 'md:order-1 md:col-start-1';
  const copyOrder =
    imageOn === 'right'
      ? 'md:order-1 md:col-start-1 md:pr-12'
      : 'md:order-2 md:col-start-2 md:pl-12';

  return (
    <article className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-0 items-center">
      <div className={cn('relative aspect-[4/5] md:aspect-[5/6]', imageOrder)}>
        <Image
          src={block.imageUrl}
          alt={block.imageAlt}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover frame-mount"
          loading="lazy"
        />
      </div>
      <div className={cn('flex flex-col justify-center', copyOrder)}>
        <p className="eyebrow mb-3">{block.eyebrow}</p>
        <h3
          className="heading-xl text-ink whitespace-pre-line max-w-[16ch]"
          style={{ fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.15 }}
        >
          {block.headline}
        </h3>
        <p className="mt-4 body-md text-charcoal max-w-[44ch]">
          {block.body}
        </p>
        <ul className="mt-6 flex flex-col gap-3 border-t border-hairline pt-6">
          {block.bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-3 caption-md text-ink"
            >
              <span
                aria-hidden
                className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-ink shrink-0"
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <Link
            href={block.cta.href}
            className={cn(
              'inline-flex items-center justify-center',
              'h-12 px-8 rounded-[30px] body-strong tap-collapse',
              'bg-ink text-on-primary hover:bg-charcoal transition-colors',
            )}
          >
            {block.cta.label}
          </Link>
        </div>
      </div>
    </article>
  );
}
