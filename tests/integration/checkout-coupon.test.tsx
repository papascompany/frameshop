/**
 * <CheckoutClient> 쿠폰 적용/해제/에러 + 묶음 요약 + couponCode 페이로드
 * (FS-X-04, ADR-026).
 *
 * 고정하는 계약:
 *  1. 주문 상품 요약이 묶음 그룹 카드(읽기전용)로 렌더된다.
 *  2. 쿠폰 적용 — /api/coupons/validate 에 subtotal/payable 전달, 성공 시
 *     합계 카드에 할인 행 + 해제 버튼.
 *  3. 해제 — 할인 행 제거, 입력 폼 복귀.
 *  4. errorCode 3종(COUPON_INVALID/EXHAUSTED/ALREADY_USED) 한국어 매핑.
 *  5. createOrder 페이로드에 couponCode 전달(할인액은 전송하지 않음 — 서버 재검증).
 *  6. 결제 직전 서버 재검증 실패(422) 한국어 안내.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import koMessages from '@/messages/ko.json';
import { asBrand } from '@/types/common';
import type {
  CartItemId,
  CartProjectId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  ShippingMethodId,
} from '@/types/common';
import type { CartItem } from '@/types/cart';
import type { ShippingMethodConfig } from '@/types/shipping';

const { getCartMock, clearCartMock, requestPaymentMock } = vi.hoisted(() => ({
  getCartMock: vi.fn<() => Promise<CartItem[]>>(async () => []),
  clearCartMock: vi.fn(async () => {}),
  requestPaymentMock: vi.fn(async () => {}),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/cart/client', async () => {
  const summary =
    await vi.importActual<typeof import('@/lib/cart/summary')>('@/lib/cart/summary');
  return {
    getCart: getCartMock,
    clearCart: clearCartMock,
    getCartSummary: summary.getCartSummary,
  };
});

vi.mock('@/lib/payment/client', () => ({
  requestPayment: requestPaymentMock,
}));

// 다음(카카오) 우편번호 스크립트는 jsdom 에서 로드 불가 — onComplete 만 재현.
vi.mock('@/components/PostcodeButton', () => ({
  PostcodeButton: ({
    onComplete,
  }: {
    onComplete: (zip: string, addr1: string) => void;
  }) => (
    <button
      type="button"
      data-testid="postcode-mock"
      onClick={() => onComplete('06236', '서울 강남구 테헤란로 1')}
    >
      우편번호 검색
    </button>
  ),
}));

import { CheckoutClient } from '@/app/(shop)/checkout/CheckoutClient';

// ---------- fixtures ----------

const STANDARD: ShippingMethodConfig = {
  id: asBrand<ShippingMethodId>('sm-1'),
  code: 'STANDARD',
  label: '택배',
  fee: 3_000,
  freeThreshold: 50_000,
  note: null,
  isActive: true,
  sortOrder: 0,
  surchargeFeeJeju: 0,
  surchargeFeeRemote: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PROJECT = asBrand<CartProjectId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

let seq = 0;

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  seq += 1;
  return {
    id: asBrand<CartItemId>(`ci-${seq}`),
    localId: asBrand<LocalId>(
      `b1b2c3d4-5e6f-4a89-9bca-${String(seq).padStart(12, '0')}`,
    ),
    userId: null,
    productId: asBrand<ProductId>('22222222-2222-4222-8222-222222222222'),
    variantId: asBrand<ProductVariantId>(`v-${seq}`),
    photoId: asBrand<PhotoId>(`ph-${seq}`),
    options: {
      sizeCode: '4x6',
      colorCode: 'black',
      matteCode: 'none',
      paperCode: 'glossy',
    },
    photoUrl: 'https://example.com/photo.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    previewUrl: 'https://example.com/preview.png',
    price: 5_000,
    quantity: 1,
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

// subtotal 15,000 + 배송비 3,000 = payable 18,000 (surcharge 0)
function fixtureCart(): CartItem[] {
  return [
    makeItem({ projectId: PROJECT, projectSeq: 0, orientation: 'landscape', price: 5_000 }),
    makeItem({ projectId: PROJECT, projectSeq: 1, orientation: 'portrait', price: 7_000 }),
    makeItem({ price: 3_000 }),
  ];
}

// ---------- fetch stub ----------

type FetchCall = { url: string; init?: RequestInit };
let fetchCalls: FetchCall[] = [];
let couponResponse: { status: number; body: unknown } = {
  status: 200,
  body: { ok: true, valid: false, errorCode: 'COUPON_INVALID' },
};
let ordersResponse: { status: number; body: unknown } = {
  status: 200,
  body: { ok: true, order: { orderNo: '20260717-0001', totalPrice: 13_000 } },
};

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  fetchCalls = [];
  couponResponse = {
    status: 200,
    body: { ok: true, valid: true, code: 'WELCOME5', type: 'fixed', value: 5_000, discount: 5_000 },
  };
  ordersResponse = {
    status: 200,
    body: { ok: true, order: { orderNo: '20260717-0001', totalPrice: 13_000 } },
  };
  getCartMock.mockResolvedValue(fixtureCart());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.includes('/api/account/addresses')) return jsonRes({ ok: false }, 401);
      if (url.includes('/api/coupons/validate')) {
        return jsonRes(couponResponse.body, couponResponse.status);
      }
      if (url.includes('/api/orders')) {
        return jsonRes(ordersResponse.body, ordersResponse.status);
      }
      return jsonRes({ ok: false }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderCheckout() {
  return render(
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      <CheckoutClient
        shippingMethods={[STANDARD]}
        features={{ points: false, receipt: false, surcharge: false, coupons: true }}
        tossClientKey="test_ck_test"
      />
    </NextIntlClientProvider>,
  );
}

async function applyCouponViaUi(code = 'welcome5'): Promise<void> {
  const input = await screen.findByTestId('coupon-input');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByTestId('coupon-apply'));
  await screen.findByTestId('coupon-clear');
}

/** 주문 폼을 유효 상태로 채운다(스키마: 이름/전화/이메일 + 배송지 + 동의). */
async function fillValidForm(): Promise<void> {
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '홍길동' } });
  fireEvent.change(screen.getAllByLabelText('전화번호')[0]!, {
    target: { value: '01012345678' },
  });
  fireEvent.change(screen.getByLabelText('이메일'), {
    target: { value: 'hong@example.com' },
  });
  fireEvent.click(screen.getByLabelText('주문인과 동일'));
  fireEvent.click(screen.getByTestId('postcode-mock'));
  fireEvent.click(screen.getByTestId('agree-privacy'));
  fireEvent.click(screen.getByTestId('agree-purchase'));
}

describe('<CheckoutClient> 묶음 요약 (FS-X-04)', () => {
  it('주문 상품 요약이 그룹 카드(헤더 + 라인) + 단품으로 렌더된다', async () => {
    renderCheckout();
    const group = await screen.findByTestId('checkout-group');
    expect(within(group).getByText(/묶음 1/)).toBeInTheDocument();
    expect(within(group).getByText('가로 1 · 세로 1')).toBeInTheDocument();
    // 그룹 소계 5,000 + 7,000
    expect(within(group).getAllByText(/12,000원/).length).toBeGreaterThan(0);
    // 단품 라인은 그룹 밖에 존재
    expect(screen.getByText('주문 상품 (3건)')).toBeInTheDocument();
  });
});

describe('<CheckoutClient> 쿠폰 (FS-X-04, ADR-026)', () => {
  it('적용 성공 — validate 에 subtotal/payable 전달, 할인 행 + 해제 버튼 표시', async () => {
    renderCheckout();
    await applyCouponViaUi();

    const call = fetchCalls.find((c) => c.url.includes('/api/coupons/validate'));
    expect(call).toBeDefined();
    const body = JSON.parse(String(call!.init?.body)) as Record<string, unknown>;
    // 입력은 대문자 정규화되어 전송, payable = subtotal + 배송비(쿠폰 차감 전).
    expect(body).toMatchObject({ code: 'WELCOME5', subtotal: 15_000, payable: 18_000 });

    const row = screen.getByTestId('coupon-row');
    expect(row).toHaveTextContent('쿠폰 할인 (WELCOME5)');
    expect(row).toHaveTextContent('-5,000원');
  });

  it('해제 — 할인 행이 사라지고 입력 폼으로 복귀한다', async () => {
    renderCheckout();
    await applyCouponViaUi();
    fireEvent.click(screen.getByTestId('coupon-clear'));
    expect(screen.queryByTestId('coupon-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('coupon-input')).toBeInTheDocument();
  });

  it.each([
    ['COUPON_INVALID', '사용할 수 없는 쿠폰입니다. 코드와 사용 조건을 확인해 주세요.'],
    ['COUPON_EXHAUSTED', '준비된 쿠폰이 모두 소진되었습니다.'],
    ['COUPON_ALREADY_USED', '이미 사용한 쿠폰입니다.'],
  ])('errorCode %s → 한국어 안내', async (errorCode, copy) => {
    couponResponse = { status: 200, body: { ok: true, valid: false, errorCode } };
    renderCheckout();
    const input = await screen.findByTestId('coupon-input');
    fireEvent.change(input, { target: { value: 'BADCODE' } });
    fireEvent.click(screen.getByTestId('coupon-apply'));
    expect(await screen.findByTestId('coupon-error')).toHaveTextContent(copy);
    // 미적용 상태 유지
    expect(screen.queryByTestId('coupon-row')).not.toBeInTheDocument();
  });

  it('createOrder 페이로드에 couponCode 를 전달한다(할인액은 미전송)', async () => {
    renderCheckout();
    await applyCouponViaUi();
    await fillValidForm();
    fireEvent.click(screen.getAllByRole('button', { name: '결제하기' })[0]!);

    await waitFor(() => {
      expect(fetchCalls.some((c) => c.url.includes('/api/orders'))).toBe(true);
    });
    const call = fetchCalls.find((c) => c.url.includes('/api/orders'));
    const body = JSON.parse(String(call!.init?.body)) as Record<string, unknown>;
    expect(body.couponCode).toBe('WELCOME5');
    expect(body).not.toHaveProperty('couponDiscount');
    // 배송비는 쿠폰과 무관하게 서버 검증값 그대로.
    expect(body.clientShippingFee).toBe(3_000);
    await waitFor(() => expect(requestPaymentMock).toHaveBeenCalledTimes(1));
  });

  it('결제 직전 서버 재검증 실패(422) — 한국어 안내를 표시한다', async () => {
    ordersResponse = {
      status: 422,
      body: { ok: false, code: 'COUPON_EXHAUSTED', message: 'coupon rejected' },
    };
    renderCheckout();
    await applyCouponViaUi();
    await fillValidForm();
    fireEvent.click(screen.getAllByRole('button', { name: '결제하기' })[0]!);

    expect(
      await screen.findByText(
        '쿠폰 수량이 모두 소진되었습니다. 쿠폰을 해제한 뒤 다시 시도해 주세요.',
      ),
    ).toBeInTheDocument();
    expect(requestPaymentMock).not.toHaveBeenCalled();
  });
});
