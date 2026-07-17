'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PriceTag } from '@/components/PriceTag';
import { getCart, clearCart, getCartSummary } from '@/lib/cart/client';
import { groupCartByProject } from '@/lib/cart/grouping';
import { takeCheckoutSelection } from '@/lib/cart/selection';
import {
  ORIENTATION_LABELS,
  cartGroupTitle,
  composeOrientationChips,
} from '../cart/group-view';
import { formatPhone } from '@/lib/checkout/validate';
import { calculateShippingFee } from '@/lib/shipping/calc';
import { requestPayment } from '@/lib/payment/client';
import { asBrand } from '@/types/common';
import type { OrderNo } from '@/types/common';
import type { CartItem } from '@/types/cart';
import type { CheckoutFormData } from '@/types/checkout';
import type { PointsSummary } from '@/types/points';
import type {
  ShippingMethod,
  ShippingMethodConfig,
} from '@/types/shipping';
import type { CashReceiptRequest, Order } from '@/types/order';
import type { CouponErrorCode, CouponType } from '@/types/coupon';
import type { UserAddress } from '@/types/address';
import { envPublic } from '@/lib/env-public';
import { PostcodeButton } from '@/components/PostcodeButton';
import { MobileStickyBar } from '@/components/MobileStickyBar';
import { tossErrorCopy } from '@/lib/payment/error-copy';
import {
  clampRedeem,
  computeCheckoutTotals,
  computeSurchargeFee,
} from './checkout-totals';
import { validateCheckoutSubmit } from './submit-validation';

/**
 * 서버(page.tsx)가 feature-probe 로 판정한 기능 가용성 (FS-EC-01).
 * false = 해당 마이그레이션 미적용 → 섹션 자체를 렌더하지 않는다(graceful).
 */
export type CheckoutFeatures = {
  /** 적립금 (migration 031). */
  points: boolean;
  /** 현금영수증 (migration 039). */
  receipt: boolean;
  /** 제주/도서산간 추가 배송비 (migration 030). */
  surcharge: boolean;
  /** 쿠폰 (migration 042, FS-X-04). */
  coupons: boolean;
};

/** createOrder 응답의 알려진 실패 코드 → 한국어 안내 (FS-EC-01 추가분). */
const CREATE_ORDER_ERROR_COPY: Record<string, string> = {
  POINTS_INSUFFICIENT:
    '적립금 잔액이 부족합니다. 사용 금액을 확인해 주세요.',
  POINTS_UNAVAILABLE:
    '지금은 적립금을 사용할 수 없습니다. 적립금 없이 다시 시도해 주세요.',
  RECEIPT_UNAVAILABLE:
    '지금은 현금영수증 신청을 처리할 수 없습니다. 신청을 해제하고 다시 시도해 주세요.',
  SHIPPING_FEE_MISMATCH:
    '배송비 정보가 변경되었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
  // FS-X-04 (ADR-026): 결제 직전 서버 재검증(createOrder)이 쿠폰을 거부한 경우.
  COUPON_INVALID:
    '쿠폰을 더 이상 적용할 수 없습니다. 쿠폰을 해제한 뒤 다시 시도해 주세요.',
  COUPON_EXHAUSTED:
    '쿠폰 수량이 모두 소진되었습니다. 쿠폰을 해제한 뒤 다시 시도해 주세요.',
  COUPON_ALREADY_USED:
    '이미 사용한 쿠폰입니다. 쿠폰을 해제한 뒤 다시 시도해 주세요.',
};

/** /api/coupons/validate 의 errorCode → 한국어 안내 (FS-X-04, ADR-026 3종). */
const COUPON_ERROR_COPY: Record<CouponErrorCode, string> = {
  COUPON_INVALID: '사용할 수 없는 쿠폰입니다. 코드와 사용 조건을 확인해 주세요.',
  COUPON_EXHAUSTED: '준비된 쿠폰이 모두 소진되었습니다.',
  COUPON_ALREADY_USED: '이미 사용한 쿠폰입니다.',
};

/** 적용된 쿠폰 상태 — validate 응답 스냅샷(할인액은 totals 가 재계산). */
type AppliedCoupon = {
  /** 서버가 정규화한 코드(createOrder 페이로드에 그대로 전달). */
  code: string;
  type: CouponType;
  value: number;
};

type Props = {
  shippingMethods: ShippingMethodConfig[];
  features: CheckoutFeatures;
};

export function CheckoutClient({ shippingMethods, features }: Props) {
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
    // FS-EC-01 — 옵셔널 확장 필드의 controlled-input 초깃값.
    redeemPoints: 0,
    receiptRequested: false,
    receiptInfo: '',
    agreePrivacy: false,
    agreePurchase: false,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // Synchronous re-entrancy guard: the `submitting` state + disabled button can
  // still be double-fired in the frame before React re-renders. A ref blocks the
  // second call immediately, preventing a duplicate order/payment.
  const submittingRef = useRef(false);
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

  // 적립금 요약 (FS-EC-01). 주소록과 같은 graceful 패턴: 게스트(401)/미적용
  // (available:false)/네트워크 오류 → available:false 유지 → 섹션 비노출.
  const [points, setPoints] = useState<PointsSummary>({
    balance: 0,
    available: false,
  });

  useEffect(() => {
    if (!features.points) return;
    let cancelled = false;
    void fetch('/api/account/points', { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) return null; // 401 (guest) / 500 → 섹션 비노출
        return (await res.json()) as {
          ok: boolean;
          available?: boolean;
          balance?: number;
        };
      })
      .then((body) => {
        if (cancelled || !body?.ok || body.available !== true) return;
        setPoints({ balance: body.balance ?? 0, available: true });
      })
      .catch(() => {
        /* network error → 적립금 없이 진행 */
      });
    return () => {
      cancelled = true;
    };
  }, [features.points]);

  // 쿠폰 (FS-X-04, ADR-026). validate API 는 UX 프리뷰 — 청구는 createOrder 가
  // 같은 순수 함수(calcCouponDiscount)로 재검증·확정한다.
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponPending, setCouponPending] = useState(false);

  function clearCoupon() {
    setCoupon(null);
    setCouponError(null);
  }

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
  // FS-EC-01: 제주/도서산간 추가배송비 — 서버 재계산과 같은 순수 함수 사용.
  // 030 미적용이면 설정 필드가 0 폴백이라 자동으로 0(양쪽 일치).
  const surchargeFee = useMemo(
    () => computeSurchargeFee(form.shipping.zip, activeMethod),
    [form.shipping.zip, activeMethod],
  );
  // 합계(ADR-026 §3): 상품합계 + 배송비 + 추가배송비 − 쿠폰 − 적립금 = 최종액.
  // redeem 은 파생 계산에서 재-clamp — payable/쿠폰이 변해도 effect 불필요.
  const { payable, couponDiscount, payableAfterCoupon, redeemApplied, total } =
    computeCheckoutTotals({
      subtotal: summary.subtotal,
      shippingFee,
      surchargeFee,
      desiredRedeem: form.redeemPoints ?? 0,
      points,
      coupon,
    });
  // FS-X-04: redeem 상한은 쿠폰 반영 후 payable 기준으로 재계산(ADR-026 §3).
  const maxRedeem = clampRedeem(points.balance, points.balance, payableAfterCoupon);

  // 주문 상품 요약의 묶음 그룹 뷰 (FS-X-04 — 읽기전용).
  const groupedItems = useMemo(() => groupCartByProject(items), [items]);

  async function applyCoupon() {
    const code = couponInput.trim();
    if (code.length < 2) {
      setCouponError('쿠폰 코드를 입력해 주세요.');
      return;
    }
    setCouponPending(true);
    setCouponError(null);
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // subtotal/payable 은 표시용 할인 계산 기준 — payable 은 쿠폰 차감 전
        // 결제예정액(음수 방지 상한)을 보낸다.
        body: JSON.stringify({ code, subtotal: summary.subtotal, payable }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        valid?: boolean;
        code?: string;
        type?: CouponType;
        value?: number;
        discount?: number;
        errorCode?: CouponErrorCode;
      };
      if (!body.ok) {
        setCouponError(
          res.status === 429
            ? '쿠폰 확인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
            : '쿠폰 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        );
        return;
      }
      if (
        body.valid !== true ||
        typeof body.code !== 'string' ||
        (body.type !== 'fixed' && body.type !== 'percent') ||
        typeof body.value !== 'number'
      ) {
        setCouponError(
          (body.errorCode && COUPON_ERROR_COPY[body.errorCode]) ??
            COUPON_ERROR_COPY.COUPON_INVALID,
        );
        return;
      }
      // type/value 를 저장해 이후 금액 변동(배송방법 등) 시 totals 파생 계산이
      // 공용 순수 함수로 할인액을 재계산한다(서버 discount 값 고정 아님).
      setCoupon({ code: body.code, type: body.type, value: body.value });
      setCouponInput('');
    } catch {
      setCouponError('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setCouponPending(false);
    }
  }

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
    // FROZEN 계약: checkoutFormSchema + checkoutAgreementsSchema 둘 다 통과.
    const validation = validateCheckoutSubmit(form);
    if (!validation.ok) {
      setErrors(validation.errors);
      setSubmitError('입력 내용을 다시 확인해 주세요.');
      return;
    }
    if (submittingRef.current) return; // block a rapid double-submit
    submittingRef.current = true;
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      // FS-EC-01: 신청 시에만 receipt 페이로드 포함(미신청 = 필드 자체 생략).
      const receipt: CashReceiptRequest | undefined =
        features.receipt && form.receiptRequested === true && form.receiptType
          ? { type: form.receiptType, info: form.receiptInfo ?? '' }
          : undefined;
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
          // 추가배송비 포함 총 배송비 — 서버가 같은 순수 함수로 재계산·검증.
          clientShippingFee: shippingFee + surchargeFee,
          sessionId: getGuestSessionId(),
          // >0 일 때만 포함 — 서버가 잔액/상한을 권위 있게 재검증(031).
          redeemPoints: redeemApplied > 0 ? redeemApplied : undefined,
          receipt,
          // FS-X-04 (ADR-026): 적용 시에만 포함 — 서버가 재검증·원자 소비.
          // 할인액은 보내지 않는다(클라이언트 금액은 결코 신뢰되지 않음).
          couponCode: coupon ? coupon.code : undefined,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        order?: Order;
        code?: string;
        message?: string;
      };
      if (!body.ok || !body.order) {
        setSubmitError(
          (body.code !== undefined && CREATE_ORDER_ERROR_COPY[body.code]) ||
            '주문 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        );
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
      submittingRef.current = false;
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
            {features.surcharge && form.shippingMethod === 'STANDARD' ? (
              <p className="text-xs text-muted-fg">
                제주/도서산간 지역은 추가 배송비가 부과될 수 있습니다.
              </p>
            ) : null}
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

      {/* FS-EC-01: 적립금 사용 — 031 적용 + 로그인 + 잔액 보유 시에만 노출 */}
      {features.points && points.available && points.balance > 0 ? (
        <Card padding="md" data-testid="points-section">
          <h2 className="font-semibold mb-3">적립금</h2>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-fg">
              보유 적립금{' '}
              <span className="text-ink font-medium tabular-nums">
                {points.balance.toLocaleString('ko-KR')}P
              </span>
            </p>
            <div className="flex gap-2 items-end">
              <Input
                label="사용할 적립금"
                inputMode="numeric"
                value={String(redeemApplied)}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, '') || '0');
                  setForm((f) => ({
                    ...f,
                    // 쿠폰 반영 payable 기준 상한(ADR-026 §3)
                    redeemPoints: clampRedeem(n, points.balance, payableAfterCoupon),
                  }));
                }}
                data-testid="redeem-input"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setForm((f) => ({ ...f, redeemPoints: maxRedeem }))
                }
                disabled={maxRedeem === 0}
                className="shrink-0 mb-0.5"
              >
                전액 사용
              </Button>
            </div>
            <p className="text-xs text-muted-fg">
              이 주문에 최대 {maxRedeem.toLocaleString('ko-KR')}P 사용 가능
              (최소 결제 금액 100원)
            </p>
          </div>
        </Card>
      ) : null}

      {/* FS-X-04: 쿠폰 — 042 적용 시에만 노출(probe 게이트). 비회원도 입력 가능 */}
      {features.coupons ? (
        <Card padding="md" data-testid="coupon-section">
          <h2 className="font-semibold mb-3">쿠폰</h2>
          <div className="flex flex-col gap-2">
            {coupon ? (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{coupon.code}</p>
                  <p className="text-xs text-muted-fg tabular-nums">
                    {couponDiscount > 0
                      ? `-${couponDiscount.toLocaleString('ko-KR')}원 할인 적용`
                      : '이 주문에는 할인이 적용되지 않습니다'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={clearCoupon}
                  className="shrink-0"
                  data-testid="coupon-clear"
                >
                  해제
                </Button>
              </div>
            ) : (
              <div className="flex gap-2 items-end">
                <Input
                  label="쿠폰 코드"
                  value={couponInput}
                  onChange={(e) => {
                    setCouponInput(e.target.value.toUpperCase());
                    setCouponError(null);
                  }}
                  placeholder="쿠폰 코드를 입력해 주세요"
                  autoComplete="off"
                  data-testid="coupon-input"
                />
                <Button
                  type="button"
                  variant="secondary"
                  loading={couponPending}
                  disabled={couponPending || couponInput.trim().length < 2}
                  onClick={() => void applyCoupon()}
                  className="shrink-0 mb-0.5"
                  data-testid="coupon-apply"
                >
                  적용
                </Button>
              </div>
            )}
            {couponError ? (
              <p role="alert" className="text-xs text-danger" data-testid="coupon-error">
                {couponError}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* FS-EC-01: 현금영수증 신청 — 039 적용 시에만 노출 */}
      {features.receipt ? (
        <Card padding="md" data-testid="receipt-section">
          <h2 className="font-semibold mb-3">현금영수증</h2>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.receiptRequested ?? false}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((f) => ({ ...f, receiptRequested: checked }));
                  if (!checked) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next['receiptType'];
                      delete next['receiptInfo'];
                      return next;
                    });
                  }
                }}
                data-testid="receipt-toggle"
              />
              현금영수증 신청
            </label>
            {form.receiptRequested ? (
              <>
                <Select
                  label="발급 유형"
                  placeholder="유형을 선택해주세요"
                  value={form.receiptType ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      receiptType:
                        e.target.value === 'income' || e.target.value === 'proof'
                          ? e.target.value
                          : undefined,
                    }))
                  }
                  options={[
                    { value: 'income', label: '소득공제용 (개인)' },
                    { value: 'proof', label: '지출증빙용 (사업자)' },
                  ]}
                  error={errors['receiptType']}
                />
                <Input
                  label="식별번호"
                  inputMode="numeric"
                  placeholder={
                    form.receiptType === 'proof'
                      ? '사업자등록번호 (예: 123-45-67890)'
                      : '휴대폰번호 (예: 010-1234-5678)'
                  }
                  value={form.receiptInfo ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      // 숫자·하이픈만 (checkoutFormSchema 규칙과 동일)
                      receiptInfo: e.target.value
                        .replace(/[^0-9-]/g, '')
                        .slice(0, 20),
                    }))
                  }
                  error={errors['receiptInfo']}
                />
              </>
            ) : null}
            <p className="text-xs text-muted-fg">
              현금성 결제(계좌이체 등) 시에만 발급됩니다.
            </p>
          </div>
        </Card>
      ) : null}

      </div>{/* 좌측 컬럼 끝 */}

      {/* 우측: 주문 상품 + 주문 요약 + 결제 버튼 */}
      <div className="flex flex-col gap-4 mt-4 md:mt-0">
      {/* #7 주문 상품 요약 — 결제 직전 무엇을 사는지 확인.
          FS-X-04: 묶음은 그룹 카드(헤더 + 라인 목록, 읽기전용)로 표시. */}
      <Card padding="md">
        <h2 className="font-semibold mb-3">주문 상품 ({items.length}건)</h2>
        <div className="flex flex-col gap-3">
          {groupedItems.groups.map((group, gi) => (
            <div
              key={group.key}
              className="border border-border p-2"
              data-testid="checkout-group"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold">
                  {cartGroupTitle(gi)}{' '}
                  <span className="font-normal text-muted-fg">
                    {composeOrientationChips(group.lines.map((l) => l.orientation))}
                  </span>
                </p>
                <span className="text-sm tabular-nums">
                  {group.subtotal.toLocaleString('ko-KR')}원
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {group.lines.map((item) => (
                  <li key={item.localId} className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 shrink-0 bg-surface-muted bg-cover bg-center rounded"
                      style={{ backgroundImage: `url(${item.previewUrl})` }}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate">
                        {item.options.sizeCode}
                        {item.orientation
                          ? ` / ${ORIENTATION_LABELS[item.orientation]}형`
                          : ''}{' '}
                        / {item.options.colorCode}
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
            </div>
          ))}
          {groupedItems.singles.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {groupedItems.singles.map((item) => (
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
          ) : null}
        </div>
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
        {surchargeFee > 0 ? (
          <div
            className="flex justify-between text-sm"
            data-testid="surcharge-row"
          >
            <span>제주/도서산간 추가 배송비</span>
            <span className="tabular-nums">
              +{surchargeFee.toLocaleString('ko-KR')}원
            </span>
          </div>
        ) : null}
        {couponDiscount > 0 ? (
          <div
            className="flex justify-between text-sm"
            data-testid="coupon-row"
          >
            <span>쿠폰 할인{coupon ? ` (${coupon.code})` : ''}</span>
            <span className="tabular-nums text-sale">
              -{couponDiscount.toLocaleString('ko-KR')}원
            </span>
          </div>
        ) : null}
        {redeemApplied > 0 ? (
          <div
            className="flex justify-between text-sm"
            data-testid="redeem-row"
          >
            <span>적립금 사용</span>
            <span className="tabular-nums text-sale">
              -{redeemApplied.toLocaleString('ko-KR')}원
            </span>
          </div>
        ) : null}
        <hr className="my-2 border-border" />
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t('totalAmount')}</span>
          <PriceTag amount={total} variant="large" />
        </div>
      </Card>

      {/* FS-EC-01: 필수 동의 — 미체크 시 submit 검증이 인라인 에러로 차단 */}
      <Card padding="md" className="flex flex-col gap-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.agreePrivacy ?? false}
            onChange={(e) => {
              const checked = e.target.checked;
              setForm((f) => ({ ...f, agreePrivacy: checked }));
              if (checked) {
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next['agreePrivacy'];
                  return next;
                });
              }
            }}
            data-testid="agree-privacy"
          />
          <span className="flex-1">
            [필수] 개인정보 수집·이용 동의{' '}
            <Link
              href="/privacy"
              target="_blank"
              className="underline text-muted-fg hover:text-ink"
            >
              보기
            </Link>
          </span>
        </label>
        {errors['agreePrivacy'] ? (
          <p className="text-xs text-danger">{errors['agreePrivacy']}</p>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.agreePurchase ?? false}
            onChange={(e) => {
              const checked = e.target.checked;
              setForm((f) => ({ ...f, agreePurchase: checked }));
              if (checked) {
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next['agreePurchase'];
                  return next;
                });
              }
            }}
            data-testid="agree-purchase"
          />
          <span className="flex-1">
            [필수] 구매조건 확인 및 결제진행 동의{' '}
            <Link
              href="/terms"
              target="_blank"
              className="underline text-muted-fg hover:text-ink"
            >
              보기
            </Link>
          </span>
        </label>
        {errors['agreePurchase'] ? (
          <p className="text-xs text-danger">{errors['agreePurchase']}</p>
        ) : null}
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
