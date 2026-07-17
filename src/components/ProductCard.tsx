import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PriceTag } from './PriceTag';
import type { ProductListItem } from '@/types';
import { cn } from '@/lib/cn';

type Props = {
  product: ProductListItem;
  /** Optional badge — e.g. "NEW", "BEST", "SALE". */
  badge?: string;
  /** When false, defers below-the-fold image loading. Default true. */
  lazyImage?: boolean;
  /** Optional eyebrow text shown above the name (e.g. category). */
  eyebrow?: string;
  /**
   * FS-X-06: 위시리스트 하트 오버레이 슬롯(클라 아일랜드, e.g. WishlistHeart).
   * 카드가 단일 <Link> 라 내부에 버튼을 중첩할 수 없어(HTML 불허) relative
   * 래퍼 + Link "형제" absolute 오버레이(top-right)로 렌더한다.
   * 미지정이면 기존 렌더와 완전히 동일(래퍼 없음).
   */
  wishlistSlot?: ReactNode;
};

/**
 * Catalog card — Nike-aligned, gallery-polished product card.
 *
 *  Geometry (DESIGN-nike.md `product-card`, 2026-05-13 refresh):
 *   - rounded.none, no border, no shadow on the container itself.
 *   - Image area: full-bleed 1:1 on bg-soft-cloud ("studio backdrop").
 *   - Hover zoom (~4%) + reveal of a "지금 만들기" pill in the corner.
 *   - Optional promo badge as a pill in the top-left of the image area.
 *   - Metadata stack below image with 8px gap:
 *       1. Eyebrow caption (optional, e.g. "BASIC FRAME")
 *       2. Product name — body-strong, ink
 *       3. Tagline — caption-md, mute
 *       4. Price row (PriceTag with "FROM" label)
 *
 *  The whole card is a single Link, so screen readers announce it as one
 *  navigation target — the inner "지금 만들기" hover indicator is hidden
 *  from AT via aria-hidden.
 */
export function ProductCard({
  product,
  badge,
  lazyImage = true,
  eyebrow,
  wishlistSlot,
}: Props) {
  const card = (
    <Link
      href={`/product/${product.id}`}
      className="group block rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-4"
      aria-label={`${product.name} — 상세 보기 및 시작`}
    >
      <div className="relative aspect-square bg-soft-cloud overflow-hidden">
        {/* Promo badge — kept above the image so it stays visible on hover. */}
        {badge ? (
          <span
            className={cn(
              'absolute top-3 left-3 z-10',
              'inline-flex items-center caption-sm uppercase tracking-wider',
              'bg-canvas text-ink border border-hairline',
              'rounded-[30px] px-3 py-1',
            )}
          >
            {badge}
          </span>
        ) : null}

        {/* Hover CTA pill — bottom right, hidden by default. */}
        <span
          aria-hidden
          className={cn(
            'absolute bottom-3 right-3 z-10',
            'inline-flex items-center gap-1.5 h-9 px-4 rounded-[30px]',
            'bg-ink text-on-primary caption-md',
            'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0',
            'transition-all duration-300',
          )}
        >
          지금 만들기
          <svg
            width="12"
            height="12"
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

        {product.thumbnail ? (
          <Image
            src={product.thumbnail}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-cover zoom-on-hover"
            loading={lazyImage ? 'lazy' : 'eager'}
          />
        ) : (
          <ProductCardPlaceholder name={product.name} />
        )}
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {eyebrow ? (
          <p className="caption-sm uppercase tracking-wider text-mute">
            {eyebrow}
          </p>
        ) : null}
        <p className="body-strong text-ink truncate">{product.name}</p>
        {product.tagline ? (
          <p className="caption-md text-mute truncate">{product.tagline}</p>
        ) : null}
        <div className="mt-1">
          <PriceTag amount={product.basePrice} showFrom />
        </div>
      </div>
    </Link>
  );

  if (!wishlistSlot) return card;

  return (
    <div className="relative">
      {card}
      {/* 하트 오버레이 — 이미지 영역 top-right(배지는 top-left라 충돌 없음). */}
      <div className="absolute top-3 right-3 z-20">{wishlistSlot}</div>
    </div>
  );
}

/**
 * Pure-CSS placeholder used when a product hasn't shipped its thumbnail yet.
 *  - Diagonal-line pattern hints at "asset upload pending" without falling
 *    back to a flat gray square.
 *  - Caption keeps it legible for editors browsing /admin/products.
 */
function ProductCardPlaceholder({ name }: { name: string }) {
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-soft-cloud"
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, transparent 0 11px, rgba(0,0,0,0.04) 11px 12px)',
      }}
    >
      <div className="text-center px-4">
        <p className="caption-sm uppercase tracking-wider text-stone mb-1">
          Image Coming
        </p>
        <p className="body-strong text-mute truncate max-w-[16ch] mx-auto">
          {name}
        </p>
      </div>
    </div>
  );
}
