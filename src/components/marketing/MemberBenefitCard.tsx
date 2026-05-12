import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/cn';

type Props = {
  imageUrl: string;
  imageAlt: string;
  headline: string;
  /** Optional eyebrow/kicker above the headline (caption-sm uppercase). */
  eyebrow?: string;
  cta: { label: string; href: string };
  className?: string;
};

/**
 * MemberBenefitCard — full-bleed photographic card for membership benefits.
 *
 *  Composition (DESIGN-nike.md `member-benefit-card`):
 *   - Dark full-bleed photography (rounded.none)
 *   - Bottom-left copy slot: `heading-lg` headline in `text-on-primary`
 *   - A single `outline-on-image` CTA pill ("자세히 보기" / "Explore")
 *
 *  Used as a 3-up grid on the membership / about page — e.g. "회원 전용
 *  무료배송", "포인트 적립", "신상 우선 액세스".
 */
export function MemberBenefitCard({
  imageUrl,
  imageAlt,
  headline,
  eyebrow,
  cta,
  className,
}: Props) {
  return (
    <article
      className={cn(
        'relative w-full overflow-hidden rounded-none bg-ink',
        'aspect-[4/5]',
        className,
      )}
    >
      <Image
        src={imageUrl}
        alt={imageAlt}
        fill
        sizes="(max-width: 768px) 100vw, 33vw"
        className="object-cover opacity-90"
      />
      <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-8">
        {eyebrow ? (
          <p className="caption-sm uppercase text-stone mb-3 tracking-wider">
            {eyebrow}
          </p>
        ) : null}
        <h3 className="heading-lg text-on-primary max-w-[14ch]">{headline}</h3>
        <div className="mt-5">
          <Link
            href={cta.href}
            className={cn(
              'inline-flex items-center justify-center',
              'h-11 px-6 rounded-[30px] body-strong tap-collapse',
              'bg-canvas text-ink hover:bg-soft-cloud transition-colors',
              'focus-visible:outline-2 focus-visible:outline-canvas focus-visible:outline-offset-2 focus-visible:outline',
            )}
          >
            {cta.label}
          </Link>
        </div>
      </div>
    </article>
  );
}
