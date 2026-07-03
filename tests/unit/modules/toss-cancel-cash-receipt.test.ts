/**
 * Toss 어댑터 확장(FS-EC-03) 단위 테스트 — fetch mock (실 Toss 호출 없음).
 *
 * - cancel: cancelAmount 생략 시 body 에서 필드 자체가 빠져야 한다(전액 취소 —
 *   Toss 스펙). 지정 시 그대로 전달.
 * - issueCashReceipt: POST /v1/cash-receipts 에 계약된 페이로드 전달.
 * - 에러 응답은 TossApiError 로 래핑.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tossClient, TossApiError } from '@/lib/payment/toss';
import { asBrand } from '@/types/common';
import type { PaymentKey } from '@/types/common';

type FetchCall = { url: string; body: Record<string, unknown> };

const calls: FetchCall[] = [];
let nextResponse: { ok: boolean; status: number; json: Record<string, unknown> };

const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push({
    url: String(url),
    body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
  });
  return {
    ok: nextResponse.ok,
    status: nextResponse.status,
    json: async () => nextResponse.json,
  } as unknown as Response;
});

const paymentKey = asBrand<PaymentKey>('tk_test_payment_key');

beforeEach(() => {
  calls.length = 0;
  nextResponse = {
    ok: true,
    status: 200,
    json: { paymentKey: 'tk_test_payment_key', orderId: 'o-1', status: 'CANCELED', totalAmount: 30000 },
  };
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tossClient.cancel — cancelAmount conditional spread', () => {
  it('cancelAmount 생략 시 body 에 cancelAmount 키가 없다(전액 취소)', async () => {
    await tossClient.cancel({ paymentKey, cancelReason: '고객 요청' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v1/payments/tk_test_payment_key/cancel');
    expect(calls[0].body).toEqual({ cancelReason: '고객 요청' });
    expect(calls[0].body).not.toHaveProperty('cancelAmount');
  });

  it('cancelAmount 지정 시 body 에 그대로 포함된다(부분 취소)', async () => {
    await tossClient.cancel({
      paymentKey,
      cancelReason: '부분 환불',
      cancelAmount: 5000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ cancelReason: '부분 환불', cancelAmount: 5000 });
  });
});

describe('tossClient.issueCashReceipt', () => {
  it('POST /v1/cash-receipts 에 계약 페이로드를 전달한다', async () => {
    nextResponse = {
      ok: true,
      status: 200,
      json: { receiptKey: 'rk-1', receiptUrl: 'https://dashboard.tosspayments.com/receipt/rk-1' },
    };

    const resp = await tossClient.issueCashReceipt({
      amount: 30000,
      orderId: '20260703-0001',
      orderName: '오크 원목 액자 외 1건',
      customerIdentityNumber: '010-1234-5678',
      type: '소득공제',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v1/cash-receipts');
    expect(calls[0].body).toEqual({
      amount: 30000,
      orderId: '20260703-0001',
      orderName: '오크 원목 액자 외 1건',
      customerIdentityNumber: '010-1234-5678',
      type: '소득공제',
    });
    expect(resp.receiptUrl).toBe('https://dashboard.tosspayments.com/receipt/rk-1');
  });

  it('Toss 에러 응답은 TossApiError 로 래핑된다', async () => {
    nextResponse = {
      ok: false,
      status: 400,
      json: { code: 'INVALID_REQUEST', message: '잘못된 요청입니다.' },
    };

    await expect(
      tossClient.issueCashReceipt({
        amount: 30000,
        orderId: '20260703-0001',
        orderName: '액자',
        customerIdentityNumber: '010-1234-5678',
        type: '지출증빙',
      }),
    ).rejects.toThrowError(TossApiError);
  });
});
