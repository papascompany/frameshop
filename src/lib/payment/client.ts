/**
 * Browser wrapper around Toss SDK requestPayment.
 *
 * The Toss SDK is loaded lazily — keeps initial bundle smaller and avoids
 * SSR issues.
 *
 * clientKey 는 서버(RSC)가 getEffectiveTossClientKey() 로 해석해 prop 으로
 * 내려준 값을 받는다 — 클라이언트 번들의 빌드타임 env 인라인에 의존하면
 * 어드민 설정(app_settings) 키가 재배포 없이는 반영되지 않는다.
 */

import { loadTossPayments } from '@tosspayments/payment-sdk';
import type { RequestPaymentInput } from '@/types/payment';

export async function requestPayment(
  input: RequestPaymentInput,
  clientKey: string,
): Promise<void> {
  const toss = await loadTossPayments(clientKey);
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
