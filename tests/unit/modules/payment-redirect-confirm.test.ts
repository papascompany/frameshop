/**
 * 성공 URL 서버측 확정 (src/lib/payment/redirect-confirm.ts) — 입력 검증·
 * 레이트리밋·예외 흡수를 고정한다. confirmPayment 자체는 payment-confirm IT 가 담당.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state: {
  confirmCalls: Array<{ paymentKey: string; orderId: string; amount: number }>;
  confirmImpl: () => Promise<unknown>;
  rateCalls: Array<{ namespace: string; key: string }>;
  limited: Set<string>;
} = {
  confirmCalls: [],
  confirmImpl: async () => ({ ok: true, orderNo: '20261028-0001', paymentKey: 'pk' }),
  rateCalls: [],
  limited: new Set(),
};

vi.mock('@/lib/payment/confirm', () => ({
  confirmPayment: async (input: { paymentKey: string; orderId: string; amount: number }) => {
    state.confirmCalls.push(input);
    return state.confirmImpl();
  },
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRate: async (namespace: string, key: string) => {
    state.rateCalls.push({ namespace, key });
    return state.limited.has(namespace)
      ? { ok: false, retryAfterSec: 30 }
      : { ok: true, remaining: 1 };
  },
}));

beforeEach(() => {
  state.confirmCalls = [];
  state.confirmImpl = async () => ({ ok: true, orderNo: '20261028-0001', paymentKey: 'pk' });
  state.rateCalls = [];
  state.limited = new Set();
});

const PARAMS = { paymentKey: 'pk-redirect', orderId: '20261028-0001', amount: '16800' };

async function run(params = PARAMS) {
  const { confirmFromSuccessRedirect } = await import('@/lib/payment/redirect-confirm');
  return confirmFromSuccessRedirect(params, '203.0.113.7');
}

describe('confirmFromSuccessRedirect', () => {
  it('정상 파라미터면 숫자 금액으로 confirmPayment 를 호출하고 결과를 그대로 돌려준다', async () => {
    const result = await run();
    expect(state.confirmCalls).toEqual([
      { paymentKey: 'pk-redirect', orderId: '20261028-0001', amount: 16800 },
    ]);
    expect(result).toEqual({ ok: true, orderNo: '20261028-0001', paymentKey: 'pk' });
  });

  it('재시도 버튼(/api/payment/confirm)과 같은 레이트리밋 버킷(IP·주문)을 쓴다', async () => {
    await run();
    expect(state.rateCalls).toEqual([
      { namespace: 'payment_confirm_ip', key: '203.0.113.7' },
      { namespace: 'payment_confirm_order', key: '20261028-0001' },
    ]);
  });

  it.each([
    ['형식이 아닌 orderId', { ...PARAMS, orderId: 'not-ours' }],
    ['숫자가 아닌 amount', { ...PARAMS, amount: 'abc' }],
    ['음수 amount', { ...PARAMS, amount: '-1' }],
  ])('%s → BAD_INPUT, Toss 승인 시도 없음', async (_label, params) => {
    const result = await run(params);
    expect(result).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(state.confirmCalls).toHaveLength(0);
  });

  it.each(['payment_confirm_ip', 'payment_confirm_order'])(
    '%s 한도 초과 → RATE_LIMITED, 승인 시도 없음',
    async (namespace) => {
      state.limited.add(namespace);
      const result = await run();
      expect(result).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
      expect(state.confirmCalls).toHaveLength(0);
    },
  );

  it('confirmPayment 가 throw 해도(DB 오류) 페이지를 깨지 않고 INTERNAL 로 돌려준다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.confirmImpl = async () => {
      throw new Error('transitionTo update failed: timeout');
    };
    const result = await run();
    expect(result).toEqual({
      ok: false,
      code: 'INTERNAL',
      message: '결제 확인 중 오류가 발생했습니다.',
    });
    errSpy.mockRestore();
  });
});
