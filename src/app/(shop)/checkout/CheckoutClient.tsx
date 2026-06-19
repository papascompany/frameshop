'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PriceTag } from '@/components/PriceTag';
import { getCart, clearCart, getCartSummary } from '@/lib/cart/client';
import { takeCheckoutSelection } from '@/lib/cart/selection';
import { formatPhone, validateCheckoutForm } from '@/lib/checkout/validate';
import { calculateShippingFee } from '@/lib/shipping/calc';
import { requestPayment } from '@/lib/payment/client';
import { asBrand } from '@/types/common';
import type { OrderNo } from '@/types/common';
import type { CartItem } from '@/types/cart';
import type { CheckoutFormData } from '@/types/checkout';
import type {
  ShippingMethod,
  ShippingMethodConfig,
} from '@/types/shipping';
import type { Order } from '@/types/order';
import type { UserAddress } from '@/types/address';
import { envPublic } from '@/lib/env-public';
import { PostcodeButton } from '@/components/PostcodeButton';
import { MobileStickyBar } from '@/components/MobileStickyBar';
import { tossErrorCopy } from '@/lib/payment/error-copy';

type Props = {
  shippingMethods: ShippingMethodConfig[];
};

export function CheckoutClient({ shippingMethods }: Props) {
  const router = useRouter();
  const t = useTranslations('checkout');
  const [items, setItems] = useState<CartItem[]>([]);
  const [loadingCart, setLoadingCart] = useState(true);

  useEffect(() => {
    // Honor a one-shot selection handed off from the cart ("선택 상품 주문").
    // No selection → order the full cart (direct /checkout link still works).
    const selection = takeCheckoutSelection();
    void getCart().then((rows) => {
      const filtered =
        selection && selection.length > 0
          ? rows.filter((r) => selection.includes(r.localId as string))
          : rows;
      const finalRows = filtered.length > 0 ? filtered : rows;
      setItems(finalRows);
      setLoadingCart(false);
      if (finalRows.length === 0) router.replace('/cart');
    });
  }, [router]);

  const [form, setForm] = useState<CheckoutFormData>(() => ({
    orderer: { name: '', phone: '', email: '' },
    shipping: {
      sameAsOrderer: false,
      name: '',
      phone: '',
      zip: '',
      addr1: '',
      addr2: '',
      memo: '',
    },
    shippingMethod: (shippingMethods[0]?.code ?? 'STANDARD') as ShippingMethod,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // Inline failure message near the pay button (replaces alert()).
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Saved addresses (logged-in members only). The GET endpoint returns 401 for
  // guests, so an empty list naturally means "no selector" — guests are
  // unaffected. This only *prefills* the existing form; the submit payload and
  // the manual-entry flow are untouched.
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([]);
  const [pickedAddressId, setPickedAddressId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/account/addresses', { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) return null; // 401 (guest) / 500 → no selector
        return (await res.json()) as { ok: boolean; addresses?: UserAddress[] };
      })
      .then((body) => {
        if (cancelled || !body?.ok || !body.addresses) return;
        setSavedAddresses(body.addresses);
      })
      .catch(() => {
        /* network error → silently fall back to manual entry */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Fill the shipping form from a chosen saved address. Clears
   *  "주문인과 동일" since picking an address overrides the recipient. */
  function applySavedAddress(addressId: string) {
    setPickedAddressId(addressId);
    const addr = savedAddresses.find((a) => a.id === addressId);
    if (!addr) return;
    setForm((f) => ({
      ...f,
      shipping: {
        ...f.shipping,
        sameAsOrderer: false,
        name: addr.recipientName,
        phone: addr.phone,
        zip: addr.zip,
        addr1: addr.addr1,
        addr2: addr.addr2,
        memo: addr.memo,
      },
    }));
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of [
        'shipping.name',
        'shipping.phone',
        'shipping.zip',
        'shipping.addr1',
        'shipping.addr2',
        'shipping.memo',
      ]) {
        delete next[k];
      }
      return next;
    });
  }

  const summary = getCartSummary(items);
  const activeMethod = useMemo(
    () => shippingMethods.find((m) => m.code === form.shippingMethod) ?? null,
    [shippingMethods, form.shippingMethod],
  );
  const shippingFee = useMemo(() => {
    if (shippingMethods.length === 0) return 0;
    try {
      return calculateShippingFee(form.shippingMethod, summary.subtotal, shippingMethods);
    } catch {
      return 0;
    }
  }, [form.shippingMethod, summary.subtotal, shippingMethods]);
  const total = summary.subtotal + shippingFee;

  function setOrderer<K extends keyof CheckoutFormData['orderer']>(k: K, v: CheckoutFormData['orderer'][K]) {
    setForm((f) => {
      const orderer = { ...f.orderer, [k]: v };
      // #13: keep recipient in sync while "주문인과 동일" is checked so the
      // shipping name/phone never go stale after editing the orderer.
      const shipping =
        f.shipping.sameAsOrderer && (k === 'name' || k === 'phone')
          ? { ...f.shipping, name: orderer.name, phone: orderer.phone }
          : f.shipping;
      return { ...f, orderer, shipping };
    });
  }
  function setShipping<K extends keyof CheckoutFormData['shipping']>(k: K, v: CheckoutFormData['shipping'][K]) {
    setForm((f) => ({ ...f, shipping: { ...f.shipping, [k]: v } }));
  }

  function toggleSameAsOrderer(checked: boolean) {
    // Choosing "주문인과 동일" overrides recipient/phone, so the saved-address
    // selection no longer reflects the form — clear the selector's value.
    if (checked) setPickedAddressId('');
    setForm((f) => ({
      ...f,
      shipping: {
        ...f.shipping,
        sameAsOrderer: checked,
        name: checked ? f.orderer.name : '',
        phone: checked ? f.orderer.phone : '',
      },
    }));
  }

  /** Read `fs-guest-sid` cookie value (HttpOnly → readable only server-side,
   *  but the middleware writes it before the page renders so the browser
   *  will carry it in the POST automatically via fetch's credentials:include).
   *  We still read it here for explicit inclusion in the JSON body so the
   *  API route can use it for photo-ownership verification without relying on
   *  cookie parsing at the edge. */
  function getGuestSessionId(): string | null {
    if (typeof document === 'undefined') return null;
    // HttpOnly cookies are NOT accessible via document.cookie. The sessionId
    // travels automatically via the Set-Cookie header and is read server-side
    // from request.cookies in the API route. We send null here; the API route
    // reads it from cookies directly.
    return null;
  }

  async function submit() {
    const validation = validateCheckoutForm(form);
    if (!validation.ok) {
      setErrors(validation.errors);
      setSubmitError('입력 내용을 다시 확인해 주세요.');
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cartItems: items,
          orderer: form.orderer,
          shipping: {
            name: form.shipping.name,
            phone: form.shipping.phone,
            zip: form.shipping.zip,
            addr1: form.shipping.addr1,
            addr2: form.shipping.addr2,
            memo: form.shipping.memo,
          },
          shippingMethod: form.shippingMethod,
          clientShippingFee: shippingFee,
          sessionId: getGuestSessionId(),
        }),
      });
      const body = (await res.json()) as { ok: boolean; order?: Order; message?: string };
      if (!body.ok || !body.order) {
        setSubmitError('주문 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      // Persist order id for the success page lookup and clear cart.
      const order = body.order;
      const successUrl = `${envPublic.siteUrl()}/payment/success?orderNo=${order.orderNo}`;
      const failUrl = `${envPublic.siteUrl()}/payment/fail?orderNo=${order.orderNo}`;
      await requestPayment({
        orderNo: asBrand<OrderNo>(order.orderNo),
        totalPrice: order.totalPrice,
        orderName: `FrameShop ${items.length}건`,
        customerName: form.orderer.name,
        customerEmail: form.orderer.email,
        successUrl,
        failUrl,
      });
      // requestPayment redirects on success — fallback if SDK no-ops.
      await clearCart(items.map((i) => i.localId));
    } catch (err) {
      // Toss SDK throws with a code on user-cancel / failure — map to Korean.
      const code = (err as { code?: string } | null)?.code;
      setSubmitError(tossErrorCopy(code, err instanceof Error ? err.message : null));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingCart) {
    return <p className="text-sm text-muted-fg">{t('loading')}</p>;
  }

  return (
    <form
      className="flex flex-col gap-6 md:grid md:grid-cols-[1fr_340px] md:gap-6 md:items-start pb-24 md:pb-0"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      {/* 좌측: 주문인 + 배송방법 + 배송지 */}
      <div className="flex flex-col gap-4">
      {/* Orderer */}
      <Card padding="md">
        <h2 className="font-semibold mb-3">{t('orderer')}</h2>
        <div className="flex flex-col gap-3">
          <Input
            label={t('ordererName')}
            value={form.orderer.name}
            onChange={(e) => setOrderer('name', e.target.value)}
            error={errors['orderer.name']}
            autoComplete="name"
          />
          <Input
            label={t('ordererPhone')}
            inputMode="tel"
            value={form.orderer.phone}
            onChange={(e) => setOrderer('phone', formatPhone(e.target.value))}
            error={errors['orderer.phone']}
            placeholder="010-1234-5678"
            autoComplete="tel"
          />
          <Input
            label={t('ordererEmail')}
            type="email"
            value={form.orderer.email}
            onChange={(e) => setOrderer('email', e.target.value)}
            error={errors['orderer.email']}
            autoComplete="email"
          />
        </div>
      </Card>

      {/* Shipping method */}
      <Card padding="md">
        <h2 className="font-semibold mb-3">{t('shippingMethod')}</h2>
        <ul className="flex flex-col gap-2">
          {shippingMethods.length === 0 ? (
            <li className="text-sm text-muted-fg">
              {t('noShippingMethods')}
            </li>
          ) : (
            shippingMethods.map((m) => {
              const selected = form.shippingMethod === m.code;
              const isFree =
                m.code === 'STANDARD' &&
                m.freeThreshold !== null &&
                summary.subtotal >= m.freeThreshold;
              return (
                <li key={m.id}>
                  <label
                    className={`flex items-start gap-3 p-3 border cursor-pointer ${selected ? 'border-foreground' : 'border-border'}`}
                  >
                    <input
                      type="radio"
                      name="shippingMethod"
                      checked={selected}
                      onChange={() => {
                        setForm((f) => ({ ...f, shippingMethod: m.code }));
                      }}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{m.label}</span>
                      {m.code === 'STANDARD' && m.freeThreshold !== null ? (
                        <span className="text-xs text-muted-fg">
                          {t('freeAbove', { amount: m.freeThreshold.toLocaleString('ko-KR') })}
                        </span>
                      ) : null}
                      {m.note ? (
                        <span className="block text-xs text-muted-fg">{m.note}</span>
                      ) : null}
                    </span>
                    {isFree ? (
                      <Badge variant="success">{t('freeShipping')}</Badge>
                    ) : (
                      <span className="text-sm tabular-nums">
                        {m.fee.toLocaleString('ko-KR')}원
                      </span>
                    )}
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </Card>

      {/* Shipping address */}
      {form.shippingMethod !== 'PICKUP' ? (
        <Card padding="md">
          <h2 className="font-semibold mb-3">{t('shippingAddress')}</h2>
          <div className="flex flex-col gap-3">
            {savedAddresses.length > 0 ? (
              <Select
                label={t('savedAddress')}
                placeholder={t('savedAddressSelect')}
                value={pickedAddressId}
                onChange={(e) => applySavedAddress(e.target.value)}
                options={savedAddresses.map((a) => ({
                  value: a.id,
                  label: [
                    a.label || a.recipientName,
                    a.isDefault ? `(${t('savedAddressDefault')})` : '',
                    `${a.addr1}${a.addr2 ? ` ${a.addr2}` : ''}`,
                  ]
                    .filter(Boolean)
                    .join(' '),
                }))}
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.shipping.sameAsOrderer}
                onChange={(e) => toggleSameAsOrderer(e.target.checked)}
              />
              {t('sameAsOrderer')}
            </label>
            <Input
              label={t('recipient')}
              value={form.shipping.name}
              onChange={(e) => setShipping('name', e.target.value)}
              error={errors['shipping.name']}
              autoComplete="name"
            />
            <Input
              label={t('phone')}
              inputMode="tel"
              value={form.shipping.phone}
              onChange={(e) =>
                setShipping('phone', formatPhone(e.target.value))
              }
              error={errors['shipping.phone']}
              autoComplete="tel"
            />
            <div className="flex gap-2 items-end">
              <Input
                label={t('zipCode')}
                value={form.shipping.zip}
                readOnly
                error={errors['shipping.zip']}
                inputMode="numeric"
                autoComplete="postal-code"
                className="max-w-[140px]"
                placeholder={t('searchZip')}
              />
              <PostcodeButton
                onComplete={(zip, addr1) => {
                  // Manual postcode edit diverges from any saved address.
                  setPickedAddressId('');
                  setShipping('zip', zip);
                  setShipping('addr1', addr1);
                }}
                className="shrink-0 mb-0.5"
              />
            </div>
            <Input
              label={t('address')}
              value={form.shipping.addr1}
              readOnly
              error={errors['shipping.addr1']}
              autoComplete="address-line1"
              placeholder={t('searchZip')}
            />
            <Input
              label={t('addressDetail')}
              value={form.shipping.addr2}
              onChange={(e) => setShipping('addr2', e.target.value)}
              error={errors['shipping.addr2']}
              autoComplete="address-line2"
            />
            <Input
              label={t('memo')}
              value={form.shipping.memo}
              onChange={(e) => setShipping('memo', e.target.value)}
              error={errors['shipping.memo']}
              maxLength={200}
            />
          </div>
        </Card>
      ) : (
        <Card padding="md">
          <h2 className="font-semibold mb-3">{t('pickupNotice')}</h2>
          <p className="text-sm">
            {activeMethod?.note ?? '매장에서 직접 수령하실 수 있습니다.'}
          </p>
        </Card>
      )}

      </div>{/* 좌측 컬럼 끝 */}

      {/* 우측: 주문 상품 + 주문 요약 + 결제 버튼 */}
      <div className="flex flex-col gap-4 mt-4 md:mt-0">
      {/* #7 주문 상품 요약 — 결제 직전 무엇을 사는지 확인 */}
      <Card padding="md">
        <h2 className="font-semibold mb-3">주문 상품 ({items.length}건)</h2>
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.localId} className="flex items-center gap-3">
              <div
                className="w-12 h-12 shrink-0 bg-surface-muted bg-cover bg-center rounded"
                style={{ backgroundImage: `url(${item.previewUrl})` }}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate">
                  {item.options.sizeCode} / {item.options.colorCode}
                </p>
                <p className="text-xs text-muted-fg tabular-nums">
                  {item.quantity}장 × {item.price.toLocaleString('ko-KR')}원
                </p>
              </div>
              <span className="text-sm tabular-nums">
                {(item.price * item.quantity).toLocaleString('ko-KR')}원
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Total */}
      <Card padding="md" className="flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <span>{t('subtotal')}</span>
          <span className="tabular-nums">
            {summary.subtotal.toLocaleString('ko-KR')}원
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span>{t('shippingFee')}</span>
          <span className="tabular-nums">
            {shippingFee === 0 ? '0원' : `${shippingFee.toLocaleString('ko-KR')}원`}
          </span>
        </div>
        <hr className="my-2 border-border" />
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t('totalAmount')}</span>
          <PriceTag amount={total} variant="large" />
        </div>
      </Card>

      {submitError ? (
        <p role="alert" className="text-sm text-danger border border-danger rounded-md px-3 py-2">
          {submitError}
        </p>
      ) : null}

      {/* 데스크톱: 인라인 결제 버튼 */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={submitting}
        disabled={submitting || items.length === 0}
        className="hidden md:flex"
      >
        {t('pay')}
      </Button>
      </div>{/* 우측 컬럼 끝 */}

      {/* 모바일: 하단 고정 결제 바 (총액 + 결제) */}
      <MobileStickyBar>
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-mute leading-none mb-0.5">{t('totalAmount')}</p>
            <PriceTag amount={total} variant="large" />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={submitting || items.length === 0}
            className="ml-auto"
          >
            {t('pay')}
          </Button>
        </div>
      </MobileStickyBar>
    </form>
  );
}
