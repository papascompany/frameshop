'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PriceTag } from '@/components/PriceTag';
import { getCart, clearCart, getCartSummary } from '@/lib/cart/client';
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
import { envPublic } from '@/lib/env-public';
import { PostcodeButton } from '@/components/PostcodeButton';

type Props = {
  shippingMethods: ShippingMethodConfig[];
};

export function CheckoutClient({ shippingMethods }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loadingCart, setLoadingCart] = useState(true);

  useEffect(() => {
    void getCart().then((rows) => {
      setItems(rows);
      setLoadingCart(false);
      if (rows.length === 0) router.replace('/cart');
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
    setForm((f) => ({ ...f, orderer: { ...f.orderer, [k]: v } }));
  }
  function setShipping<K extends keyof CheckoutFormData['shipping']>(k: K, v: CheckoutFormData['shipping'][K]) {
    setForm((f) => ({ ...f, shipping: { ...f.shipping, [k]: v } }));
  }

  function toggleSameAsOrderer(checked: boolean) {
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
      return;
    }
    setErrors({});
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
        alert(`주문 생성에 실패했습니다: ${body.message ?? '오류'}`);
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
      alert(err instanceof Error ? err.message : '결제 요청 실패');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingCart) {
    return <p className="text-sm text-muted-fg">불러오는 중...</p>;
  }

  return (
    <form
      className="flex flex-col gap-6 md:grid md:grid-cols-[1fr_340px] md:gap-6 md:items-start"
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
        <h2 className="font-semibold mb-3">주문인</h2>
        <div className="flex flex-col gap-3">
          <Input
            label="이름"
            value={form.orderer.name}
            onChange={(e) => setOrderer('name', e.target.value)}
            error={errors['orderer.name']}
            autoComplete="name"
          />
          <Input
            label="전화번호"
            inputMode="tel"
            value={form.orderer.phone}
            onChange={(e) => setOrderer('phone', formatPhone(e.target.value))}
            error={errors['orderer.phone']}
            placeholder="010-1234-5678"
            autoComplete="tel"
          />
          <Input
            label="이메일"
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
        <h2 className="font-semibold mb-3">배송 방법</h2>
        <ul className="flex flex-col gap-2">
          {shippingMethods.length === 0 ? (
            <li className="text-sm text-muted-fg">
              현재 이용 가능한 배송 방법이 없습니다. 운영자에게 문의해 주세요.
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
                          {m.freeThreshold.toLocaleString('ko-KR')}원 이상 무료
                        </span>
                      ) : null}
                      {m.note ? (
                        <span className="block text-xs text-muted-fg">{m.note}</span>
                      ) : null}
                    </span>
                    {isFree ? (
                      <Badge variant="success">무료배송</Badge>
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
          <h2 className="font-semibold mb-3">배송지</h2>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.shipping.sameAsOrderer}
                onChange={(e) => toggleSameAsOrderer(e.target.checked)}
              />
              주문인과 동일
            </label>
            <Input
              label="받는 분"
              value={form.shipping.name}
              onChange={(e) => setShipping('name', e.target.value)}
              error={errors['shipping.name']}
              autoComplete="name"
            />
            <Input
              label="전화번호"
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
                label="우편번호"
                value={form.shipping.zip}
                readOnly
                error={errors['shipping.zip']}
                inputMode="numeric"
                autoComplete="postal-code"
                className="max-w-[140px]"
                placeholder="검색 후 자동입력"
              />
              <PostcodeButton
                onComplete={(zip, addr1) => {
                  setShipping('zip', zip);
                  setShipping('addr1', addr1);
                }}
                className="shrink-0 mb-0.5"
              />
            </div>
            <Input
              label="주소"
              value={form.shipping.addr1}
              readOnly
              error={errors['shipping.addr1']}
              autoComplete="address-line1"
              placeholder="우편번호 검색 후 자동입력"
            />
            <Input
              label="상세 주소"
              value={form.shipping.addr2}
              onChange={(e) => setShipping('addr2', e.target.value)}
              error={errors['shipping.addr2']}
              autoComplete="address-line2"
            />
            <Input
              label="배송 메모"
              value={form.shipping.memo}
              onChange={(e) => setShipping('memo', e.target.value)}
              error={errors['shipping.memo']}
              maxLength={200}
            />
          </div>
        </Card>
      ) : (
        <Card padding="md">
          <h2 className="font-semibold mb-3">픽업 안내</h2>
          <p className="text-sm">
            {activeMethod?.note ?? '매장에서 직접 수령하실 수 있습니다.'}
          </p>
        </Card>
      )}

      </div>{/* 좌측 컬럼 끝 */}

      {/* 우측: 주문 요약 + 결제 버튼 */}
      <div className="flex flex-col gap-4 mt-4 md:mt-0">
      {/* Total */}
      <Card padding="md" className="flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <span>상품 합계</span>
          <span className="tabular-nums">
            {summary.subtotal.toLocaleString('ko-KR')}원
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span>배송비</span>
          <span className="tabular-nums">
            {shippingFee === 0 ? '0원' : `${shippingFee.toLocaleString('ko-KR')}원`}
          </span>
        </div>
        <hr className="my-2 border-border" />
        <div className="flex items-center justify-between">
          <span className="font-semibold">총 결제 금액</span>
          <PriceTag amount={total} variant="large" />
        </div>
      </Card>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} disabled={submitting || items.length === 0}>
        결제하기
      </Button>
      </div>{/* 우측 컬럼 끝 */}
    </form>
  );
}
