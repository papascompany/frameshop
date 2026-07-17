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
import { groupCartByProject } from '@/lib/cart/grouping';
import { CHECKOUT_SELECTION_KEY } from '@/lib/cart/selection';
import { MobileStickyBar } from '@/components/MobileStickyBar';
import {
  ORIENTATION_LABELS,
  cartGroupTitle,
  composeOrientationChips,
} from './group-view';
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

  // FS-X-04 (ADR-021 세트 원자 선택): 그룹 헤더 토글 = 그룹 전 라인 일괄
  // add/remove. 부분선택 상태(기본 전체선택/라인 삭제 잔여)에서 누르면 먼저
  // 전체선택으로 복구한다 — 그룹이 반쯤 선택된 채 주문되는 경로를 없앤다.
  function toggleGroup(lines: readonly CartItem[]) {
    setSelected((curr) => {
      const ids = lines.map((l) => l.localId as string);
      const allIn = ids.every((id) => curr.has(id));
      const next = new Set(curr);
      if (allIn) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }

  // 묶음 카드 펼침/접기 (기본: 펼침).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  function toggleGroupOpen(key: string) {
    setCollapsedGroups((curr) => {
      const next = new Set(curr);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 묶음(projectId) 그룹 뷰모델 — 깨진 키/단품은 singles 로 폴백(X-00 계약).
  const grouped = useMemo(() => groupCartByProject(items), [items]);

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
            {/* FS-X-04: 묶음(세트) 카드 — 헤더(원자 선택 체크박스·구성 칩·
                썸네일 미니그리드·그룹 소계·펼침) + 라인 행. 선택만 원자이고
                수량 변경/삭제는 라인 단위로 허용한다(ADR-021). */}
            {grouped.groups.map((group, gi) => {
              const groupChecked = group.lines.every((l) =>
                selected.has(l.localId as string),
              );
              const isOpen = !collapsedGroups.has(group.key);
              const title = cartGroupTitle(gi);
              return (
                <li key={group.key} data-testid="cart-group">
                  <Card padding="sm">
                    <div className="flex gap-2 items-start">
                      <label className="shrink-0 grid place-items-center w-11 h-11 -ml-1 cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-5 h-5"
                          checked={groupChecked}
                          onChange={() => toggleGroup(group.lines)}
                          aria-label={`${title} 전체 선택`}
                          data-testid="cart-group-checkbox"
                        />
                      </label>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{title}</p>
                          <span className="inline-flex items-center px-2 py-0.5 text-xs bg-surface-muted border border-border rounded-full">
                            {composeOrientationChips(
                              group.lines.map((l) => l.orientation),
                            )}
                          </span>
                        </div>
                        <p className="text-xs text-muted-fg mt-0.5">
                          세트는 함께 주문됩니다
                        </p>
                        <div className="mt-2 flex items-center gap-1">
                          {group.lines.slice(0, 4).map((l) => (
                            <div
                              key={l.localId}
                              className="w-10 h-10 shrink-0 bg-surface-muted bg-cover bg-center"
                              style={{ backgroundImage: `url(${l.previewUrl})` }}
                              aria-hidden
                            />
                          ))}
                          {group.lines.length > 4 ? (
                            <span className="text-xs text-muted-fg">
                              +{group.lines.length - 4}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <PriceTag amount={group.subtotal} />
                        <button
                          type="button"
                          onClick={() => toggleGroupOpen(group.key)}
                          aria-expanded={isOpen}
                          className="text-xs text-muted-fg underline min-h-[44px] px-2"
                          data-testid="cart-group-expand"
                        >
                          {isOpen ? '접기' : `펼치기 (${group.lines.length})`}
                        </button>
                      </div>
                    </div>
                    {isOpen ? (
                      <ul className="mt-2 pt-2 border-t border-border flex flex-col gap-2">
                        {group.lines.map((line) => (
                          <li key={line.localId} className="flex gap-2 items-start">
                            {/* ADR-021: 그룹 내 개별 해제 금지 — 비활성 체크박스 */}
                            <span
                              className="shrink-0 grid place-items-center w-11 h-11 -ml-1"
                              title="세트는 함께 주문됩니다"
                            >
                              <input
                                type="checkbox"
                                className="w-5 h-5 opacity-40"
                                checked={groupChecked}
                                disabled
                                aria-label="세트 상품 (개별 선택 불가)"
                                data-testid="cart-group-line-checkbox"
                              />
                            </span>
                            <div
                              className="w-14 h-14 shrink-0 bg-surface-muted bg-cover bg-center"
                              style={{ backgroundImage: `url(${line.previewUrl})` }}
                              aria-label="미리보기"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {line.options.sizeCode}
                                {line.orientation
                                  ? ` / ${ORIENTATION_LABELS[line.orientation]}형`
                                  : ''}{' '}
                                / {line.options.colorCode}
                              </p>
                              <p className="text-xs text-muted-fg">
                                {line.options.paperCode}
                              </p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <button
                                  type="button"
                                  aria-label="수량 감소"
                                  className="h-11 w-11 border border-border text-base grid place-items-center disabled:opacity-40"
                                  disabled={line.quantity <= 1}
                                  onClick={() =>
                                    changeQty(
                                      line.localId,
                                      Math.max(1, line.quantity - 1),
                                    )
                                  }
                                >
                                  −
                                </button>
                                <span
                                  aria-label={`수량 ${line.quantity}`}
                                  className="min-w-[2.5ch] text-center tabular-nums"
                                >
                                  {line.quantity}
                                </span>
                                <button
                                  type="button"
                                  aria-label="수량 증가"
                                  className="h-11 w-11 border border-border text-base grid place-items-center disabled:opacity-40"
                                  disabled={line.quantity >= 99}
                                  onClick={() =>
                                    changeQty(
                                      line.localId,
                                      Math.min(99, line.quantity + 1),
                                    )
                                  }
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <PriceTag amount={line.price * line.quantity} />
                              <button
                                type="button"
                                onClick={() => remove(line.localId)}
                                className="text-xs text-muted-fg underline"
                              >
                                {t('remove')}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Card>
                </li>
              );
            })}
            {grouped.singles.map((item) => {
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
