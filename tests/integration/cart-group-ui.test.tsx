/**
 * <CartClient> 묶음(세트) 그룹 렌더 + 원자 선택 (FS-X-04, ADR-021).
 *
 * 고정하는 계약:
 *  1. projectId 그룹은 묶음 카드(헤더: 구성 칩·그룹 소계·안내)로, 단품은 기존
 *     평면 카드로 공존 렌더.
 *  2. 세트 원자 선택 — 헤더 체크박스 = 그룹 전 라인 일괄 토글, 그룹 내 라인
 *     체크박스는 비활성(부분선택 불가).
 *  3. 수량 변경/삭제는 라인 단위 허용(선택만 원자).
 *  4. 펼침/접기 토글.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import koMessages from '@/messages/ko.json';
import { asBrand } from '@/types/common';
import type {
  CartItemId,
  CartProjectId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import type { CartItem } from '@/types/cart';

const { getCartMock, removeFromCartMock, updateQuantityMock } = vi.hoisted(() => ({
  getCartMock: vi.fn<() => Promise<CartItem[]>>(async () => []),
  removeFromCartMock: vi.fn(async () => {}),
  updateQuantityMock: vi.fn(async () => {}),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// 실 모듈은 supabase 브라우저 클라이언트를 끌어온다 — 순수 요약 함수만 실물로
// 재노출하고 IO 함수는 스텁.
vi.mock('@/lib/cart/client', async () => {
  const summary =
    await vi.importActual<typeof import('@/lib/cart/summary')>('@/lib/cart/summary');
  return {
    getCart: getCartMock,
    removeFromCart: removeFromCartMock,
    updateQuantity: updateQuantityMock,
    getCartSummary: summary.getCartSummary,
  };
});

import { CartClient } from '@/app/(shop)/cart/CartClient';

let seq = 0;

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  seq += 1;
  return {
    id: asBrand<CartItemId>(`ci-${seq}`),
    localId: asBrand<LocalId>(
      `a1b2c3d4-5e6f-4a89-9bca-${String(seq).padStart(12, '0')}`,
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

const PROJECT = asBrand<CartProjectId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

function fixtureCart(): CartItem[] {
  return [
    makeItem({ projectId: PROJECT, projectSeq: 0, orientation: 'landscape', price: 10_000 }),
    makeItem({ projectId: PROJECT, projectSeq: 1, orientation: 'landscape', price: 10_000 }),
    makeItem({ projectId: PROJECT, projectSeq: 2, orientation: 'portrait', price: 12_000 }),
    makeItem(), // 단품 (projectId 없음)
  ];
}

function renderCart() {
  return render(
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      <CartClient />
    </NextIntlClientProvider>,
  );
}

let cart: CartItem[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  cart = fixtureCart();
  getCartMock.mockResolvedValue(cart);
});

describe('<CartClient> 묶음 그룹 렌더', () => {
  it('묶음 카드(제목·구성 칩·소계·안내)와 단품 평면 카드가 공존한다', async () => {
    renderCart();
    const group = await screen.findByTestId('cart-group');

    expect(within(group).getByText('묶음 1')).toBeInTheDocument();
    expect(within(group).getByText('가로 2 · 세로 1')).toBeInTheDocument();
    expect(within(group).getByText('세트는 함께 주문됩니다')).toBeInTheDocument();
    // 그룹 소계 = 10,000 + 10,000 + 12,000
    expect(within(group).getAllByText(/32,000/).length).toBeGreaterThan(0);

    // 단품은 기존 평면 카드(개별 선택 체크박스 활성) 그대로.
    const singleCheckbox = screen.getByLabelText('상품 선택');
    expect(singleCheckbox).toBeEnabled();
  });

  it('그룹 내 라인 체크박스는 비활성(부분선택 불가)이다', async () => {
    renderCart();
    await screen.findByTestId('cart-group');
    const lineCheckboxes = screen.getAllByTestId('cart-group-line-checkbox');
    expect(lineCheckboxes).toHaveLength(3);
    for (const cb of lineCheckboxes) expect(cb).toBeDisabled();
  });

  it('헤더 체크박스가 그룹 전 라인을 일괄 토글한다 (원자 선택)', async () => {
    renderCart();
    await screen.findByTestId('cart-group');
    // 기본 전체 선택: 4/4
    expect(screen.getByText(/선택 4\/4/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cart-group-checkbox'));
    // 그룹 3라인이 한 번에 빠진다 — 단품 1개만 남음.
    expect(screen.getByText(/선택 1\/4/)).toBeInTheDocument();
    for (const cb of screen.getAllByTestId('cart-group-line-checkbox')) {
      expect(cb).not.toBeChecked();
    }

    fireEvent.click(screen.getByTestId('cart-group-checkbox'));
    expect(screen.getByText(/선택 4\/4/)).toBeInTheDocument();
    for (const cb of screen.getAllByTestId('cart-group-line-checkbox')) {
      expect(cb).toBeChecked();
    }
  });

  it('수량 변경은 라인 단위로 허용된다 (해당 라인만 updateQuantity)', async () => {
    renderCart();
    const group = await screen.findByTestId('cart-group');
    const firstIncrease = within(group).getAllByLabelText('수량 증가')[0]!;
    fireEvent.click(firstIncrease);
    await waitFor(() => expect(updateQuantityMock).toHaveBeenCalledTimes(1));
    expect(updateQuantityMock).toHaveBeenCalledWith(cart[0]!.localId, 2);
  });

  it('펼침/접기 토글 — 접으면 라인 행이 사라지고 헤더는 유지된다', async () => {
    renderCart();
    await screen.findByTestId('cart-group');
    fireEvent.click(screen.getByTestId('cart-group-expand')); // 접기
    expect(screen.queryAllByTestId('cart-group-line-checkbox')).toHaveLength(0);
    expect(screen.getByText('묶음 1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cart-group-expand')); // 펼치기 (3)
    expect(screen.getAllByTestId('cart-group-line-checkbox')).toHaveLength(3);
  });
});
