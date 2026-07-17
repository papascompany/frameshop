'use client';

/**
 * 위시리스트 목록 (FS-X-06) — WishlistEntry 카드 그리드.
 *  - 썸네일/이름/시작가/판매종료 배지(isActive=false)/제거 버튼/상품 링크.
 *  - 제거는 낙관 업데이트: 즉시 목록에서 빼고, 실패 시 원상 복구 + 에러 안내.
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PriceTag } from '@/components/PriceTag';
// 타입 전용 import — 컴파일 시 소거되므로 server-only 모듈이 번들되지 않는다
// (선례: ArtworkPicker ← @/lib/db/stock-photos).
import type { WishlistEntry } from '@/lib/db/wishlists';

type Props = {
  available: boolean;
  initialItems: WishlistEntry[];
};

export function WishlistClient({ available, initialItems }: Props) {
  const t = useTranslations('account.wishlist');
  const [items, setItems] = useState<WishlistEntry[]>(initialItems);
  const [error, setError] = useState<string | null>(null);

  if (!available) {
    return (
      <Card padding="md">
        <p className="text-sm text-muted-fg">{t('unavailable')}</p>
      </Card>
    );
  }

  async function handleRemove(entry: WishlistEntry): Promise<void> {
    const prev = items;
    setError(null);
    // 낙관 제거 — 실패 시 이전 목록으로 롤백.
    setItems(prev.filter((i) => i.id !== entry.id));
    try {
      const res = await fetch('/api/account/wishlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: entry.productId as string }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (!res.ok || !data.ok) throw new Error('wishlist remove failed');
    } catch {
      setItems(prev);
      setError(t('removeFailed'));
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-muted-fg">
        <p className="text-sm">{t('empty')}</p>
        <p className="mt-2 text-xs">{t('emptyHint')}</p>
        <Link
          href="/"
          className="inline-block mt-6 text-sm text-ink underline underline-offset-4"
        >
          {t('browse')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="text-sm text-danger border border-danger rounded-md px-3 py-2"
        >
          {error}
        </p>
      ) : null}

      <ul
        className="grid grid-cols-2 md:grid-cols-3 gap-4"
        data-testid="wishlist-grid"
      >
        {items.map((entry) => {
          const product = entry.product;
          // 조인 누락(product null)은 사실상 판매 종료와 동일하게 취급.
          const soldOut = !product || !product.isActive;
          const thumb = (
            <div className="relative aspect-square bg-soft-cloud overflow-hidden">
              {soldOut ? (
                <Badge variant="dark" className="absolute top-2 left-2 z-10">
                  {t('soldOut')}
                </Badge>
              ) : null}
              {product?.thumbnail ? (
                <Image
                  src={product.thumbnail}
                  alt={product.name}
                  fill
                  sizes="(max-width: 768px) 50vw, 33vw"
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-xs text-muted-fg">
                  {product?.name ?? t('deletedProduct')}
                </div>
              )}
            </div>
          );

          return (
            <li key={entry.id as string} data-testid="wishlist-item">
              <div className="flex flex-col gap-2">
                {soldOut ? (
                  thumb
                ) : (
                  <Link
                    href={`/product/${entry.productId as string}`}
                    aria-label={t('viewProduct')}
                  >
                    {thumb}
                  </Link>
                )}
                <p className="body-strong text-ink truncate">
                  {product?.name ?? t('deletedProduct')}
                </p>
                {product ? (
                  <PriceTag amount={product.basePrice} showFrom />
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  {soldOut ? (
                    <span className="text-xs text-muted-fg">{t('soldOut')}</span>
                  ) : (
                    <Link
                      href={`/product/${entry.productId as string}`}
                      className="text-sm text-muted-fg underline underline-offset-4 hover:text-ink"
                    >
                      {t('viewProduct')}
                    </Link>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRemove(entry)}
                  >
                    {t('remove')}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
