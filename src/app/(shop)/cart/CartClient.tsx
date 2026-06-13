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
import { MobileStickyBar } from '@/components/MobileStickyBar';
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
    // #6: guard the destructive bulk delete (default-all-selected means one tap
    // could wipe the whole cart). Confirm before removing.
    if (!window.confirm(t('removeSelectedConfirm', { count: ids.length }))) return;
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
    <Container size="md" className="pt-6 pb-28 md:py-10">
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
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none min-h-[44px] py-2">
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={allSelected}
                onChange={toggleAll}
                aria-label={t('selectAll')}
              />
              {t('selectAll')} ({t('selectedCount', { selected: selected.size, total: items.length })})
            </label>
            <button
              type="button"
              onClick={() => void removeSelected()}
              disabled={selected.size === 0}
              className="text-sm text-muted-fg underline disabled:opacity-40 min-h-[44px] px-2"
            >
              {t('removeSelected')}
            </button>
          </div>

          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const checked = selected.has(item.localId as string);
              return (
                <li key={item.localId}>
                  <Card padding="sm" className="flex gap-2 items-start">
                    <label className="shrink-0 grid place-items-center w-11 h-11 -ml-1 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-5 h-5"
                        checked={checked}
                        onChange={() => toggle(item.localId as string)}
                        aria-label="상품 선택"
                      />
                    </label>
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
                      <div className="mt-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="수량 감소"
                          className="h-11 w-11 border border-border text-base grid place-items-center disabled:opacity-40"
                          disabled={item.quantity <= 1}
                          onClick={() =>
                            changeQty(item.localId, Math.max(1, item.quantity - 1))
                          }
                        >
                          −
                        </button>
                        <span
                          aria-label={`수량 ${item.quantity}`}
                          className="min-w-[2.5ch] text-center tabular-nums"
                        >
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="수량 증가"
                          className="h-11 w-11 border border-border text-base grid place-items-center disabled:opacity-40"
                          disabled={item.quantity >= 99}
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
              <span>{t('subtotal')} · {t('pieces', { count: summary.totalQuantity })}</span>
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

          {/* 데스크톱: 인라인 결제 버튼 */}
          <div className="mt-4 hidden md:block">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={selectedItems.length === 0}
              onClick={checkoutSelected}
            >
              {selectedItems.length > 0
                ? `${t('checkout')} (${t('pieces', { count: summary.totalQuantity })})`
                : t('checkout')}
            </Button>
          </div>

          {/* 모바일: 하단 고정 결제 바 */}
          <MobileStickyBar>
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-mute leading-none mb-0.5">
                  {t('pieces', { count: summary.totalQuantity })}
                </p>
                <PriceTag amount={summary.subtotal} variant="large" />
              </div>
              <Button
                variant="primary"
                size="lg"
                className="ml-auto"
                disabled={selectedItems.length === 0}
                onClick={checkoutSelected}
              >
                {t('checkout')}
              </Button>
            </div>
          </MobileStickyBar>
        </>
      )}
    </Container>
  );
}
