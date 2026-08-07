/**
 * Toss 키 유효값 해석(env ↔ app_settings) 단위 테스트.
 *
 * - 실값 env 우선 → placeholder/미설정이면 DB(app_settings) 폴백.
 * - placeholder env(`test_ck_placeholder` 등)는 미설정으로 간주 —
 *   초기 배포 placeholder 가 어드민 DB 설정을 가리지 않는다.
 * - requestPayment 는 서버가 해석해 내려준 clientKey 로 SDK 를 초기화한다
 *   (클라이언트 번들 빌드타임 env 인라인 비의존).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  dbSettings: {} as Record<string, string>,
  loadedClientKeys: [] as string[],
  requestPaymentCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db/settings', () => ({
  getSetting: vi.fn(async (key: string) => h.dbSettings[key] ?? null),
  getSettings: vi.fn(async () => ({})),
  setSetting: vi.fn(async () => undefined),
}));

vi.mock('@tosspayments/payment-sdk', () => ({
  loadTossPayments: vi.fn(async (clientKey: string) => {
    h.loadedClientKeys.push(clientKey);
    return {
      requestPayment: vi.fn(async (_method: string, params: Record<string, unknown>) => {
        h.requestPaymentCalls.push(params);
      }),
    };
  }),
}));

const ENV_KEYS = ['NEXT_PUBLIC_TOSS_CLIENT_KEY', 'TOSS_SECRET_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  h.dbSettings = {};
  h.loadedClientKeys = [];
  h.requestPaymentCalls = [];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.clearAllMocks();
});

describe('getEffectiveTossClientKey', () => {
  it('실값 env 가 있으면 env 를 반환한다 (DB 미조회)', async () => {
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = 'test_ck_real';
    h.dbSettings['toss_client_key'] = 'test_ck_from_db';
    const { getEffectiveTossClientKey } = await import('@/lib/env');
    await expect(getEffectiveTossClientKey()).resolves.toBe('test_ck_real');
  });

  it('placeholder env 는 미설정으로 간주하고 DB 값을 반환한다', async () => {
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = 'test_ck_placeholder';
    h.dbSettings['toss_client_key'] = 'test_ck_from_db';
    const { getEffectiveTossClientKey } = await import('@/lib/env');
    await expect(getEffectiveTossClientKey()).resolves.toBe('test_ck_from_db');
  });

  it('env 미설정이면 DB 값을 반환한다', async () => {
    delete process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    h.dbSettings['toss_client_key'] = 'test_ck_from_db';
    const { getEffectiveTossClientKey } = await import('@/lib/env');
    await expect(getEffectiveTossClientKey()).resolves.toBe('test_ck_from_db');
  });

  it('env·DB 모두 없으면 null (체크아웃이 결제 미구성 안내)', async () => {
    delete process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    const { getEffectiveTossClientKey } = await import('@/lib/env');
    await expect(getEffectiveTossClientKey()).resolves.toBeNull();
  });
});

describe('getEffectiveTossSecretKey', () => {
  it('placeholder env 는 무시하고 DB 값을 사용한다', async () => {
    process.env.TOSS_SECRET_KEY = 'test_sk_placeholder';
    h.dbSettings['toss_secret_key'] = 'test_sk_from_db';
    const { getEffectiveTossSecretKey } = await import('@/lib/env');
    await expect(getEffectiveTossSecretKey()).resolves.toBe('test_sk_from_db');
  });

  it('실값 env 가 있으면 env 우선', async () => {
    process.env.TOSS_SECRET_KEY = 'test_sk_real';
    h.dbSettings['toss_secret_key'] = 'test_sk_from_db';
    const { getEffectiveTossSecretKey } = await import('@/lib/env');
    await expect(getEffectiveTossSecretKey()).resolves.toBe('test_sk_real');
  });

  it('env·DB 모두 없으면 안내 메시지와 함께 throw', async () => {
    delete process.env.TOSS_SECRET_KEY;
    const { getEffectiveTossSecretKey } = await import('@/lib/env');
    await expect(getEffectiveTossSecretKey()).rejects.toThrow(/설정되지 않았습니다/);
  });
});

describe('requestPayment(clientKey 명시 전달)', () => {
  it('전달된 clientKey 로 SDK 를 초기화하고 파라미터를 매핑한다', async () => {
    const { requestPayment } = await import('@/lib/payment/client');
    await requestPayment(
      {
        orderNo: 'FS-20260801-0001' as never,
        totalPrice: 12000,
        orderName: 'FrameShop 1건',
        customerName: '홍길동',
        customerEmail: 'hong@example.com',
        successUrl: 'https://example.com/payment/success',
        failUrl: 'https://example.com/payment/fail',
      },
      'test_ck_explicit',
    );
    expect(h.loadedClientKeys).toEqual(['test_ck_explicit']);
    expect(h.requestPaymentCalls).toHaveLength(1);
    expect(h.requestPaymentCalls[0]).toMatchObject({
      amount: 12000,
      orderId: 'FS-20260801-0001',
      successUrl: 'https://example.com/payment/success',
    });
  });
});
