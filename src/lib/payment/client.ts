/**
 * Browser wrapper around Toss SDK requestPayment.
 *
 * The Toss SDK is loaded lazily — keeps initial bundle smaller and avoids
 * SSR issues.
 */

import { loadTossPayments } from '@tosspayments/payment-sdk';
import type { RequestPaymentInput } from '@/types/payment';
import { envPublic } from '../env-public';

export async function requestPayment(input: RequestPaymentInput): Promise<void> {
  const toss = await loadTossPayments(envPublic.tossClientKey());
  await toss.requestPayment('카드', {
    amount: input.totalPrice,
    orderId: input.orderNo as string,
    orderName: input.orderName,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    successUrl: input.successUrl,
    failUrl: input.failUrl,
  });
}
