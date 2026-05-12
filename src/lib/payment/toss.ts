/**
 * Toss Payments REST adapter (server-only).
 *
 * Only Basic Auth + secret key used here. Client-side requestPayment() lives
 * in `src/lib/payment/client.ts`.
 *
 * Docs: https://docs.tosspayments.com/reference
 */

import 'server-only';
import { env } from '../env';
import { MAX_PAYMENT_CONFIRM_TIMEOUT_MS } from '@/types/payment';
import type { PaymentKey } from '@/types/common';

const TOSS_API_BASE = 'https://api.tosspayments.com/v1';

function authHeader(): string {
  const key = env.tossSecretKey();
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
        Authorization: authHeader(),
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
  }): Promise<TossConfirmResponse> {
    return call<TossConfirmResponse>(
      `/payments/${encodeURIComponent(input.paymentKey)}/cancel`,
      { cancelReason: input.cancelReason },
    );
  },

  /** GET wrapper. */
  async getPayment(paymentKey: PaymentKey): Promise<TossConfirmResponse> {
    const res = await fetch(
      `${TOSS_API_BASE}/payments/${encodeURIComponent(paymentKey)}`,
      {
        method: 'GET',
        headers: {
          Authorization: authHeader(),
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
