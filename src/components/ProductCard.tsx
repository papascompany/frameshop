import Image from 'next/image';
import Link from 'next/link';
import { Card } from './ui/Card';
import { PriceTag } from './PriceTag';
import type { ProductListItem } from '@/types';

type Props = {
  product: ProductListItem;
};

/**
 * Catalog card matching ZZIXX layout — square photo, name in dark, price in red.
 */
export function ProductCard({ product }: Props) {
  return (
    <Link
      href={`/product/${product.id}`}
      className="block group"
      aria-label={`${product.name} 상세 보기`}
    >
      <Card padding="none" className="overflow-hidden">
        <div className="aspect-square bg-surface-muted relative">
          {product.thumbnail ? (
            <Image
              src={product.thumbnail}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 50vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-fg">
              이미지 준비 중
            </div>
          )}
        </div>
        <div className="p-3 flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground truncate">
            {product.name}
          </p>
          {product.tagline ? (
            <p className="text-xs text-muted-fg truncate">{product.tagline}</p>
          ) : null}
          <div className="mt-1">
            <PriceTag amount={product.basePrice} showFrom />
          </div>
        </div>
      </Card>
    </Link>
  );
}
