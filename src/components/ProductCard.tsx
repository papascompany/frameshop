import Image from 'next/image';
import Link from 'next/link';
import { PriceTag } from './PriceTag';
import type { ProductListItem } from '@/types';

type Props = {
  product: ProductListItem;
};

/**
 * Catalog card — Nike-aligned product card.
 *
 *  Geometry (DESIGN-nike.md `product-card`):
 *   - Container: rounded.none, padding 0, NO border, NO shadow.
 *   - Image area: full-bleed 1:1 on bg-soft-cloud (the "studio" backdrop).
 *   - Metadata stack sits directly below the image with 8px gap:
 *       1. (optional) promo badge — small white pill above the image
 *       2. product name — body-strong, text-ink
 *       3. subtitle/tagline — caption-md, text-mute
 *       4. price row — PriceTag (black; red only if sale)
 *
 *  The card never lifts. Its only "background" is the soft-cloud square
 *  inside the image area.
 */
export function ProductCard({ product }: Props) {
  return (
    <Link
      href={`/product/${product.id}`}
      className="block group rounded-none"
      aria-label={`${product.name} 상세 보기`}
    >
      <div className="relative aspect-square bg-soft-cloud overflow-hidden">
        {product.thumbnail ? (
          <Image
            src={product.thumbnail}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-mute">
            이미지 준비 중
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <p className="body-strong text-ink truncate">{product.name}</p>
        {product.tagline ? (
          <p className="caption-md text-mute truncate">{product.tagline}</p>
        ) : null}
        <div>
          <PriceTag amount={product.basePrice} showFrom />
        </div>
      </div>
    </Link>
  );
}
