/**
 * Toss Payments REST adapter (server-only).
 *
 * Only Basic Auth + secret key used here. Client-side requestPayment() lives
 * in `src/lib/payment/client.ts`.
 *
 * Docs: https://docs.tosspayments.com/reference
 */

import 'server-only';
import { getEffectiveTossSecretKey } from '../env';
import { MAX_PAYMENT_CONFIRM_TIMEOUT_MS } from '@/types/payment';
import type { PaymentKey } from '@/types/common';

const TOSS_API_BASE = 'https://api.tosspayments.com/v1';

/**
 * 실값 env 우선 → placeholder/미설정이면 app_settings DB 조회.
 * 모든 Toss API 호출이 이 경로를 거쳐야 어드민 설정 키가 반영된다.
 */
export async function getAuthHeader(): Promise<string> {
  const key = await getEffectiveTossSecretKey();
  const encoded = Buffer.from(`${key}:`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

export type TossConfirmResponse = {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  method?: string;
  approvedAt?: string;
  failure?: {
    code: string;
    message: string;
  };
};

/** Toss 현금영수증 발급 유형 (POST /v1/cash-receipts `type`). */
export type TossCashReceiptType = '소득공제' | '지출증빙';

export type TossCashReceiptResponse = {
  receiptKey?: string;
  orderId?: string;
  orderName?: string;
  type?: string;
  issueStatus?: string;
  receiptUrl?: string;
  failure?: {
    code: string;
    message: string;
  };
};

export class TossApiError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
    this.name = 'TossApiError';
  }
}

async function call<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_PAYMENT_CONFIRM_TIMEOUT_MS);
  const merged = signal
    ? mergeSignals(signal, controller.signal)
    : controller.signal;

  try {
    const res = await fetch(`${TOSS_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: await getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: merged,
    });
    const json: unknown = await res.json();
    if (!res.ok) {
      const err = json as { code?: string; message?: string };
      throw new TossApiError(
        res.status,
        err.code ?? 'TOSS_REJECTED',
        err.message ?? 'Toss API error',
      );
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const onA = () => ctrl.abort(a.reason);
  const onB = () => ctrl.abort(b.reason);
  if (a.aborted) ctrl.abort(a.reason);
  if (b.aborted) ctrl.abort(b.reason);
  a.addEventListener('abort', onA);
  b.addEventListener('abort', onB);
  return ctrl.signal;
}

// ---------- Public API ----------

export const tossClient = {
  async confirm(input: {
    paymentKey: PaymentKey;
    orderId: string;
    amount: number;
  }): Promise<TossConfirmResponse> {
    return call<TossConfirmResponse>('/payments/confirm', input);
  },

  async cancel(input: {
    paymentKey: PaymentKey;
    cancelReason: string;
    /** 부분취소 금액(KRW). 생략 = 잔액 전액 취소 (Toss 스펙 — 기존 호출 불변). */
    cancelAmount?: number;
  }): Promise<TossConfirmResponse> {
    return call<TossConfirmResponse>(
      `/payments/${encodeURIComponent(input.paymentKey)}/cancel`,
      {
        cancelReason: input.cancelReason,
        // Conditional spread: 필드를 아예 생략해야 Toss 가 전액 취소로 해석한다.
        ...(input.cancelAmount !== undefined
          ? { cancelAmount: input.cancelAmount }
          : {}),
      },
    );
  },

  /**
   * 현금영수증 발급 (POST /v1/cash-receipts). 현금성 결제(계좌이체/가상계좌)
   * 전용 — 카드 결제는 매출전표가 증빙이므로 발급 대상이 아니다.
   */
  async issueCashReceipt(input: {
    amount: number;
    orderId: string;
    orderName: string;
    customerIdentityNumber: string;
    type: TossCashReceiptType;
  }): Promise<TossCashReceiptResponse> {
    return call<TossCashReceiptResponse>('/cash-receipts', input);
  },

  /** GET wrapper. */
  async getPayment(paymentKey: PaymentKey): Promise<TossConfirmResponse> {
    const res = await fetch(
      `${TOSS_API_BASE}/payments/${encodeURIComponent(paymentKey)}`,
      {
        method: 'GET',
        headers: {
          Authorization: await getAuthHeader(),
        },
      },
    );
    const json: unknown = await res.json();
    if (!res.ok) {
      const err = json as { code?: string; message?: string };
      throw new TossApiError(
        res.status,
        err.code ?? 'TOSS_REJECTED',
        err.message ?? 'Toss API error',
      );
    }
    return json as TossConfirmResponse;
  },
};
