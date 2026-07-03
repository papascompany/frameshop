/**
 * issueCashReceiptIfEligible(FS-EC-03) 단위 테스트.
 *
 * - 현금성 결제(계좌이체/가상계좌) + 신청 주문만 Toss 발급 호출.
 * - 카드 결제 / 미신청(039 미적용 graceful) / 기발급 → 호출 안 함.
 * - 성공 시 receipt_url/receipt_issued_at 조건부 UPDATE.
 * - Toss 실패는 로그만 — 절대 throw 하지 않는다(결제 플로우 무영향).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderItem, OrderWithItems } from '@/types/order';
import { asBrand } from '@/types/common';
import type { OrderId, PaymentKey } from '@/types/common';

const h = vi.hoisted(() => ({
  updateCalls: [] as Array<{
    table: string;
    patch: Record<string, unknown>;
    eqs: Array<[string, unknown]>;
    isConds: Array<[string, unknown]>;
  }>,
  updateError: null as { message: string } | null,
}));

vi.mock('@/lib/payment/toss', () => {
  class TossApiError extends Error {
    public readonly code: string;
    public readonly httpStatus: number;
    constructor(httpStatus: number, code: string, message: string) {
      super(message);
      this.httpStatus = httpStatus;
      this.code = code;
      this.name = 'TossApiError';
    }
  }
  return {
    TossApiError,
    tossClient: {
      confirm: vi.fn(),
      cancel: vi.fn(),
      getPayment: vi.fn(),
      issueCashReceipt: vi.fn(async () => ({
        receiptKey: 'rk-1',
        receiptUrl: 'https://dashboard.tosspayments.com/receipt/rk-1',
      })),
    },
  };
});

vi.mock('@/lib/db/order', () => ({
  getOrder: vi.fn(),
  transitionTo: vi.fn(),
}));

vi.mock('@/lib/render/enqueue', () => ({
  enqueuePrintRender: vi.fn(),
}));

vi.mock('@/lib/notify', () => ({
  notifyNewOrder: vi.fn(async () => {}),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        const call = {
          table,
          patch,
          eqs: [] as Array<[string, unknown]>,
          isConds: [] as Array<[string, unknown]>,
        };
        h.updateCalls.push(call);
        const builder = {
          eq(col: string, val: unknown) {
            call.eqs.push([col, val]);
            return builder;
          },
          is(col: string, val: unknown) {
            call.isConds.push([col, val]);
            return Promise.resolve({ error: h.updateError });
          },
        };
        return builder;
      },
    }),
  }),
}));

import { issueCashReceiptIfEligible } from '@/lib/payment/confirm';
import { tossClient } from '@/lib/payment/toss';

const issueMock = vi.mocked(tossClient.issueCashReceipt);

function makeItem(name: string): OrderItem {
  return {
    id: `item-${name}` as unknown as OrderItem['id'],
    orderId: asBrand<OrderId>('order-id-1'),
    snapshot: {
      productId: 'p-1' as unknown as OrderItem['snapshot']['productId'],
      variantId: 'v-1' as unknown as OrderItem['snapshot']['variantId'],
      productName: name,
      options: {} as OrderItem['snapshot']['options'],
      sizeLabel: 'A4',
      colorLabel: '오크',
      unitPrice: 15000,
    },
    photoUrl: 'https://cdn.example.com/photo.jpg',
    cropTransform: {} as OrderItem['cropTransform'],
    printFileUrl: null,
    quantity: 1,
    price: 15000,
  };
}

function makeOrder(overrides: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    id: asBrand<OrderId>('order-id-1'),
    orderNo: '20260703-0001' as unknown as OrderWithItems['orderNo'],
    userId: null,
    status: 'PAID',
    totalPrice: 30000,
    shippingFee: 3000,
    shippingMethod: 'STANDARD' as unknown as OrderWithItems['shippingMethod'],
    paymentId: asBrand<PaymentKey>('tk_pay_1'),
    trackingNumber: null,
    courier: null,
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'hong@example.com' },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '06234',
      addr1: '서울시 강남구 테헤란로 123',
      addr2: '101호',
      memo: '',
    },
    receiptType: 'income',
    receiptInfo: '010-1234-5678',
    receiptUrl: null,
    receiptIssuedAt: null,
    createdAt: '2026-07-03T00:00:00Z',
    paidAt: '2026-07-03T01:00:00Z',
    shippedAt: null,
    items: [makeItem('오크 원목 액자'), makeItem('월넛 원목 액자')],
    ...overrides,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.updateCalls.length = 0;
  h.updateError = null;
  issueMock.mockResolvedValue({
    receiptKey: 'rk-1',
    receiptUrl: 'https://dashboard.tosspayments.com/receipt/rk-1',
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
});

describe('현금성 결제 판정', () => {
  it('income 신청 + 계좌이체 → 소득공제로 발급하고 결과를 조건부 UPDATE 한다', async () => {
    await issueCashReceiptIfEligible(makeOrder(), '계좌이체');

    expect(issueMock).toHaveBeenCalledWith({
      amount: 30000,
      orderId: '20260703-0001',
      orderName: '오크 원목 액자 외 1건',
      customerIdentityNumber: '010-1234-5678',
      type: '소득공제',
    });
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0].table).toBe('orders');
    expect(h.updateCalls[0].patch).toMatchObject({
      receipt_url: 'https://dashboard.tosspayments.com/receipt/rk-1',
    });
    expect(h.updateCalls[0].patch.receipt_issued_at).toEqual(expect.any(String));
    expect(h.updateCalls[0].eqs).toEqual([['id', 'order-id-1']]);
    // 조건부 UPDATE — 최초 발급 기록을 덮어쓰지 않는다.
    expect(h.updateCalls[0].isConds).toEqual([['receipt_issued_at', null]]);
  });

  it('proof 신청 + 가상계좌 → 지출증빙으로 발급한다', async () => {
    await issueCashReceiptIfEligible(
      makeOrder({ receiptType: 'proof', receiptInfo: '123-45-67890' }),
      '가상계좌',
    );

    expect(issueMock).toHaveBeenCalledTimes(1);
    expect(issueMock.mock.calls[0][0]).toMatchObject({
      type: '지출증빙',
      customerIdentityNumber: '123-45-67890',
    });
  });

  it('카드 결제는 발급 대상이 아니다', async () => {
    await issueCashReceiptIfEligible(makeOrder(), '카드');

    expect(issueMock).not.toHaveBeenCalled();
    expect(h.updateCalls).toHaveLength(0);
  });
});

describe('graceful 스킵', () => {
  it('미신청(receiptType null — 039 미적용 폴백 포함)이면 아무것도 하지 않는다', async () => {
    await issueCashReceiptIfEligible(
      makeOrder({ receiptType: null, receiptInfo: null }),
      '계좌이체',
    );

    expect(issueMock).not.toHaveBeenCalled();
    expect(h.updateCalls).toHaveLength(0);
  });

  it('이미 발급된 주문(재확정 멱등성)은 다시 발급하지 않는다', async () => {
    await issueCashReceiptIfEligible(
      makeOrder({
        receiptUrl: 'https://dashboard.tosspayments.com/receipt/rk-0',
        receiptIssuedAt: '2026-07-03T02:00:00Z',
      }),
      '계좌이체',
    );

    expect(issueMock).not.toHaveBeenCalled();
  });

  it('method 미상(undefined)이면 발급하지 않는다', async () => {
    await issueCashReceiptIfEligible(makeOrder(), undefined);

    expect(issueMock).not.toHaveBeenCalled();
  });
});

describe('실패 무영향', () => {
  it('Toss 발급 실패는 throw 하지 않고 구조화 로그만 남긴다', async () => {
    issueMock.mockRejectedValue(new Error('PROVIDER_ERROR'));

    await expect(
      issueCashReceiptIfEligible(makeOrder(), '계좌이체'),
    ).resolves.toBeUndefined();

    expect(h.updateCalls).toHaveLength(0);
    const logged = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('cash_receipt_issue_failed');
    // 민감정보(식별번호)는 로그에 남기지 않는다.
    expect(logged).not.toContain('010-1234-5678');
  });

  it('발급 성공 후 기록 UPDATE 실패도 로그만 남긴다(은폐 금지)', async () => {
    h.updateError = { message: 'connection reset' };

    await expect(
      issueCashReceiptIfEligible(makeOrder(), '계좌이체'),
    ).resolves.toBeUndefined();

    const logged = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('cash_receipt_update_failed');
  });
});
