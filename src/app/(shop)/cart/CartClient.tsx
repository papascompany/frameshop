'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PriceTag } from '@/components/PriceTag';
import {
  getCart,
  removeFromCart,
  updateQuantity,
  getCartSummary,
} from '@/lib/cart/client';
import type { CartItem } from '@/types/cart';
import type { LocalId } from '@/types/common';

export function CartClient() {
  const t = useTranslations('cart');
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getCart().then((rows) => {
      setItems(rows);
      setLoading(false);
    });
  }, []);

  async function changeQty(localId: LocalId, qty: number) {
    await updateQuantity(localId, qty);
    setItems((curr) =>
      curr.map((i) => (i.localId === localId ? { ...i, quantity: qty } : i)),
    );
  }

  async function remove(localId: LocalId) {
    await removeFromCart(localId);
    setItems((curr) => curr.filter((i) => i.localId !== localId));
  }

  const summary = getCartSummary(items);

  return (
    <Container size="md" className="py-6 md:py-10">
      <h1 className="text-xl md:text-2xl font-bold mb-4">{t('title')}</h1>

      {loading ? (
        <p className="text-sm text-muted-fg">{t('loading')}</p>
      ) : items.length === 0 ? (
        <Card padding="lg" className="text-center">
          <p className="text-sm text-muted-fg mb-4">{t('emptyAlt')}</p>
          <Link href="/" className="text-sm font-semibold underline">
            {t('goToCatalog')}
          </Link>
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.localId}>
                <Card padding="sm" className="flex gap-3 items-start">
                  <div
                    className="w-20 h-20 shrink-0 bg-surface-muted bg-cover bg-center"
                    style={{ backgroundImage: `url(${item.previewUrl})` }}
                    aria-label="미리보기"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {item.options.sizeCode} / {item.options.colorCode} /{' '}
                      {item.options.matteCode === 'with' ? '매트 있음' : '매트 없음'}
                    </p>
                    <p className="text-xs text-muted-fg">{item.options.paperCode}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="수량 감소"
                        className="h-8 w-8 border border-border text-base"
                        onClick={() =>
                          changeQty(item.localId, Math.max(1, item.quantity - 1))
                        }
                      >
                        −
                      </button>
                      <span
                        aria-label={`수량 ${item.quantity}`}
                        className="min-w-[2ch] text-center tabular-nums"
                      >
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="수량 증가"
                        className="h-8 w-8 border border-border text-base"
                        onClick={() =>
                          changeQty(item.localId, Math.min(99, item.quantity + 1))
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <PriceTag amount={item.price * item.quantity} />
                    <button
                      type="button"
                      onClick={() => remove(item.localId)}
                      className="text-xs text-muted-fg underline"
                    >
                      {t('remove')}
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <Card padding="md" className="mt-6 flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span>{t('subtotal')}</span>
              <span className="tabular-nums">{summary.subtotal.toLocaleString('ko-KR')}원</span>
            </div>
            <div className="flex justify-between text-sm text-muted-fg">
              <span>{t('shippingFee')}</span>
              <span>{t('shippingNextStep')}</span>
            </div>
            <hr className="my-2 border-border" />
            <div className="flex items-center justify-between">
              <span className="font-semibold">{t('totalAmount')}</span>
              <PriceTag amount={summary.subtotal} variant="large" />
            </div>
          </Card>

          <div className="mt-4">
            <Link href="/checkout">
              <Button variant="primary" size="lg" fullWidth>
                {t('checkout')}
              </Button>
            </Link>
          </div>
        </>
      )}
    </Container>
  );
}
