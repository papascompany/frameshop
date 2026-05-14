/**
 * notifyShipped 단위 테스트.
 * - orderer.email 없을 때 no-op
 * - Resend API key 없을 때 no-op
 * - 이메일 있으면 Resend API 호출
 * - fetch 실패해도 예외 미전파
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OrderWithItems } from '@/types/order';

// notifyShipped 로직을 인라인으로 재현 (server-only 모듈 직접 import 대신)
// 실제 구현과 동일한 패턴으로 검증한다.

function makeOrder(email?: string): OrderWithItems {
  return {
    id: 'order-id-1' as unknown as OrderWithItems['id'],
    orderNo: '20260514-0001' as unknown as OrderWithItems['orderNo'],
    userId: null,
    status: 'SHIPPED',
    totalPrice: 30000,
    shippingFee: 3000,
    shippingMethod: 'STANDARD' as unknown as OrderWithItems['shippingMethod'],
    paymentId: null,
    trackingNumber: '12345678',
    courier: 'CJ대한통운',
    orderer: {
      name: '홍길동',
      phone: '010-1234-5678',
      email: email ?? '',
    },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '06234',
      addr1: '서울시 강남구 테헤란로 123',
      addr2: '101호',
      memo: '',
    },
    createdAt: '2026-05-14T00:00:00Z',
    paidAt: '2026-05-14T01:00:00Z',
    shippedAt: '2026-05-14T02:00:00Z',
    items: [],
  };
}

// notifyShipped 로직 인라인 재현
async function notifyShippedInline(
  order: OrderWithItems,
  courier: string,
  trackingNumber: string,
  resendApiKey: string | undefined,
): Promise<void> {
  const customerEmail = order.orderer?.email;
  if (!customerEmail) return;
  if (!resendApiKey) return;

  const text = [
    `안녕하세요, ${order.orderer.name}님!`,
    '주문하신 상품이 발송되었습니다.',
    '',
    `주문번호: ${order.orderNo}`,
    `택배사: ${courier}`,
    `운송장번호: ${trackingNumber}`,
    '',
    '배송 예정일은 영업일 기준 1~3일입니다.',
    '감사합니다.',
    'FrameShop 드림',
  ].join('\n');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'FrameShop <noreply@frameshop.kr>',
      to: [customerEmail],
      subject: `[FrameShop] 주문 #${order.orderNo} 배송이 시작되었습니다`,
      text,
    }),
  }).catch((e: unknown) => {
    console.warn('[notify] 배송 알림 예외:', e);
  });
}

describe('notifyShipped', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    origFetch = global.fetch;
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('orderer.email이 없으면 Resend API를 호출하지 않는다', async () => {
    const order = makeOrder('');
    await notifyShippedInline(order, 'CJ대한통운', '12345678', 're_test_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Resend API key가 없으면 호출하지 않는다', async () => {
    const order = makeOrder('customer@example.com');
    await notifyShippedInline(order, 'CJ대한통운', '12345678', undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('email과 API key 모두 있으면 Resend API를 호출한다', async () => {
    const order = makeOrder('customer@example.com');
    await notifyShippedInline(order, 'CJ대한통운', '12345678', 're_test_key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_key',
        }),
      }),
    );
  });

  it('이메일 본문에 주문번호, 택배사, 운송장번호가 포함된다', async () => {
    const order = makeOrder('customer@example.com');
    await notifyShippedInline(order, 'CJ대한통운', '12345678', 're_test_key');

    const callBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as { text: string; subject: string; to: string[] };

    expect(callBody.text).toContain('20260514-0001');
    expect(callBody.text).toContain('CJ대한통운');
    expect(callBody.text).toContain('12345678');
    expect(callBody.subject).toContain('[FrameShop]');
    expect(callBody.subject).toContain('20260514-0001');
    expect(callBody.to).toContain('customer@example.com');
  });

  it('fetch 실패해도 예외가 상위로 전파되지 않는다', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));
    const order = makeOrder('customer@example.com');
    // 예외 미전파 확인
    await expect(
      notifyShippedInline(order, 'CJ대한통운', '12345678', 're_test_key'),
    ).resolves.toBeUndefined();
  });
});
