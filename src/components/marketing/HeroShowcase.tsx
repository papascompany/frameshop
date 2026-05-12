'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { HeroSlide } from '@/data/landing-curation';
import { cn } from '@/lib/cn';

type Props = {
  slides: HeroSlide[];
  /** Auto-advance interval in ms. Set to 0 to disable. */
  autoAdvanceMs?: number;
};

/**
 * HeroShowcase — full-bleed campaign showcase with a thumbnail rail.
 *
 *  Pattern:
 *   - Single full-bleed photograph (16/9 desktop, 4/5 mobile)
 *   - Bottom-left burn-in headline (Bebas Neue 96 px) + subhead + CTA pill
 *   - Bottom-right thumbnail rail to swap slides (Nike-style)
 *   - Auto-advances every `autoAdvanceMs` (default 6000), pauses on hover
 *
 *  Performance: only the *first* slide is `priority`, the rest use lazy
 *  loading but Next pre-emits AVIF/WebP into the manifest, so swap is
 *  effectively instant after first paint.
 */
export function HeroShowcase({ slides, autoAdvanceMs = 6000 }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!autoAdvanceMs || paused || slides.length <= 1) return;
    const t = setInterval(() => {
      setActiveIdx((i) => (i + 1) % slides.length);
    }, autoAdvanceMs);
    return () => clearInterval(t);
  }, [autoAdvanceMs, paused, slides.length]);

  const active = slides[activeIdx] ?? slides[0];
  if (!active) return null;

  const tone = active.tone === 'light' ? 'text-canvas' : 'text-ink';

  return (
    <section
      className={cn(
        'relative w-full overflow-hidden rounded-none',
        'aspect-[4/5] md:aspect-[16/9]',
        'edge-bleed bg-ink',
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="히어로 캠페인"
    >
      {/* Crossfade stack — all slides mounted, only one opaque. */}
      {slides.map((s, i) => (
        <div
          key={s.imageUrl}
          aria-hidden={i !== activeIdx}
          className={cn(
            'absolute inset-0 transition-opacity duration-700 ease-out',
            i === activeIdx ? 'opacity-100' : 'opacity-0',
          )}
        >
          <Image
            src={s.imageUrl}
            alt={s.imageAlt}
            fill
            sizes="100vw"
            className="object-cover"
            priority={i === 0}
            placeholder="empty"
          />
          <div aria-hidden className="absolute inset-0 scrim-bottom" />
        </div>
      ))}

      {/* Copy slot — anchored bottom-left, fades on slide change. */}
      <div
        key={activeIdx /* re-mount to retrigger fade */}
        className={cn(
          'absolute inset-0 flex flex-col justify-end p-6 md:p-12',
          tone,
        )}
      >
        <p className="eyebrow mb-3 fade-up text-current opacity-90">
          {active.eyebrow}
        </p>
        <h1 className="display-campaign max-w-[14ch] fade-up fade-up-delay-1">
          {active.headlineTop}
          <br />
          {active.headlineBottom}
        </h1>
        <p className="mt-4 body-md max-w-[40ch] fade-up fade-up-delay-2 opacity-95">
          {active.subhead}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3 fade-up fade-up-delay-3">
          <Link
            href={active.cta.href}
            className={cn(
              'inline-flex items-center justify-center',
              'h-12 px-8 rounded-[30px] body-strong tap-collapse',
              'bg-canvas text-ink hover:bg-soft-cloud transition-colors',
            )}
          >
            {active.cta.label}
          </Link>
          <Link
            href="#how-it-works"
            className={cn(
              'inline-flex items-center justify-center',
              'h-12 px-6 rounded-[30px] body-strong tap-collapse',
              'border transition-colors',
              active.tone === 'light'
                ? 'border-canvas/60 text-canvas hover:bg-canvas/10'
                : 'border-ink/60 text-ink hover:bg-ink/5',
            )}
          >
            제작 과정 보기
          </Link>
        </div>
      </div>

      {/* Thumbnail rail — bottom right on desktop, hidden on mobile to keep
       * the headline lockup uncluttered. The dots below carry mobile state. */}
      {slides.length > 1 ? (
        <>
          <div className="absolute right-6 bottom-6 hidden md:flex items-center gap-2">
            {slides.map((s, i) => (
              <button
                key={s.imageUrl}
                type="button"
                aria-label={`슬라이드 ${i + 1}`}
                aria-current={i === activeIdx}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  'relative h-14 w-20 overflow-hidden rounded-none',
                  'transition-opacity',
                  i === activeIdx
                    ? 'opacity-100 outline outline-2 outline-canvas outline-offset-2'
                    : 'opacity-60 hover:opacity-90',
                )}
              >
                <Image
                  src={s.thumbnailUrl}
                  alt=""
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
          <div className="absolute left-6 right-6 bottom-4 md:hidden flex items-center justify-center gap-2">
            {slides.map((s, i) => (
              <button
                key={s.imageUrl}
                type="button"
                aria-label={`슬라이드 ${i + 1}`}
                aria-current={i === activeIdx}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  'h-1.5 transition-all rounded-full',
                  i === activeIdx
                    ? 'w-8 bg-canvas'
                    : 'w-1.5 bg-canvas/50 hover:bg-canvas/80',
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
