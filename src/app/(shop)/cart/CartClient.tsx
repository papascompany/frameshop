'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { CHECKOUT_SELECTION_KEY } from '@/lib/cart/selection';
import type { CartItem } from '@/types/cart';
import type { LocalId } from '@/types/common';

export function CartClient() {
  const t = useTranslations('cart');
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Selected localIds. Default: everything selected once the cart loads.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    void getCart().then((rows) => {
      setItems(rows);
      setSelected(new Set(rows.map((r) => r.localId as string)));
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
    setSelected((curr) => {
      const next = new Set(curr);
      next.delete(localId as string);
      return next;
    });
  }

  function toggle(localId: string) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  }

  const allSelected = items.length > 0 && selected.size === items.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.localId as string)));
  }

  async function removeSelected() {
    const ids = items.filter((i) => selected.has(i.localId as string));
    if (ids.length === 0) return;
    await Promise.all(ids.map((i) => removeFromCart(i.localId)));
    const removeIds = new Set(ids.map((i) => i.localId as string));
    setItems((curr) => curr.filter((i) => !removeIds.has(i.localId as string)));
    setSelected(new Set());
  }

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.localId as string)),
    [items, selected],
  );
  const summary = getCartSummary(selectedItems);

  function checkoutSelected() {
    if (selectedItems.length === 0) return;
    // Hand the selection to the checkout page (it filters the cart to these).
    try {
      sessionStorage.setItem(
        CHECKOUT_SELECTION_KEY,
        JSON.stringify(selectedItems.map((i) => i.localId)),
      );
    } catch {
      /* sessionStorage unavailable — checkout falls back to the full cart */
    }
    router.push('/checkout');
  }

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
          {/* 전체 선택 / 선택 삭제 */}
          <div className="flex items-center justify-between mb-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="전체 선택"
              />
              전체 선택 ({selected.size}/{items.length})
            </label>
            <button
              type="button"
              onClick={() => void removeSelected()}
              disabled={selected.size === 0}
              className="text-sm text-muted-fg underline disabled:opacity-40"
            >
              선택 삭제
            </button>
          </div>

          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const checked = selected.has(item.localId as string);
              return (
                <li key={item.localId}>
                  <Card padding="sm" className="flex gap-3 items-start">
                    <input
                      type="checkbox"
                      className="w-4 h-4 mt-1 shrink-0"
                      checked={checked}
                      onChange={() => toggle(item.localId as string)}
                      aria-label="상품 선택"
                    />
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
              );
            })}
          </ul>

          <Card padding="md" className="mt-6 flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span>{t('subtotal')} ({selectedItems.length}건)</span>
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
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={selectedItems.length === 0}
              onClick={checkoutSelected}
            >
              {selectedItems.length > 0
                ? `${t('checkout')} (${selectedItems.length}건)`
                : t('checkout')}
            </Button>
          </div>
        </>
      )}
    </Container>
  );
}
