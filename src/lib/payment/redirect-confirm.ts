/**
 * 결제 성공 URL 도착 시 서버측 확정 — 결제 confirm 백스톱의 1차 경로.
 *
 * Toss 는 인증을 마친 브라우저를 successUrl 로 돌려보내고, 상점이 인증 후 10분 안에
 * 승인 API 를 호출해야 결제가 완료된다(미호출 시 EXPIRED — 청구 없음). 예전에는
 * /payment/success 의 클라이언트 useEffect 만 승인을 호출해서, 페이지가 뜨자마자 탭을
 * 닫거나 JS 가 실패하면 고객은 결제했다고 믿는데 주문은 CREATED 로 남고 사용한
 * 적립금도 묶였다. 이제 성공 페이지의 서버 렌더가 이 함수를 먼저 호출한다 — 브라우저가
 * 우리 서버에 도착한 순간 확정이 시작되고, 클라이언트 JS 와 무관하게 끝난다.
 *
 * /api/payment/confirm(재시도 버튼)과 같은 레이트리밋 버킷을 공유한다.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { OrderNo, PaymentKey } from '@/types/common';
import { confirmPaymentInputSchema, type ConfirmResult } from '@/types/payment';
import { checkRate, type RateOpts } from '../ratelimit';
import { confirmPayment } from './confirm';

/** orderNo 무차별 대입·Toss 쿼터 소진 억제 (금전 경로는 금액·Toss 응답 검증이 별도로 막는다). */
export const CONFIRM_RATE_PER_IP: RateOpts = { max: 20, windowMs: 60_000 };
/** 주문 단위 상한 — IP 를 바꿔도 한 주문에 대한 (위조 paymentKey) 시도 횟수를 묶는다. */
export const CONFIRM_RATE_PER_ORDER: RateOpts = { max: 10, windowMs: 10 * 60_000 };

export type RedirectConfirmResult =
  | ConfirmResult
  | { ok: false; code: 'BAD_INPUT' | 'RATE_LIMITED'; message: string };

export async function confirmFromSuccessRedirect(
  params: { paymentKey: string; orderId: string; amount: string },
  clientIp: string,
): Promise<RedirectConfirmResult> {
  const parsed = confirmPaymentInputSchema.safeParse({
    paymentKey: params.paymentKey,
    orderId: params.orderId,
    amount: Number(params.amount),
  });
  if (!parsed.success) {
    return { ok: false, code: 'BAD_INPUT', message: '결제 정보가 올바르지 않습니다.' };
  }

  const ipRate = await checkRate('payment_confirm_ip', clientIp, CONFIRM_RATE_PER_IP);
  const orderRate = ipRate.ok
    ? await checkRate('payment_confirm_order', parsed.data.orderId, CONFIRM_RATE_PER_ORDER)
    : ipRate;
  if (!orderRate.ok) {
    return { ok: false, code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' };
  }

  try {
    return await confirmPayment({
      paymentKey: asBrand<PaymentKey>(parsed.data.paymentKey),
      orderId: asBrand<OrderNo>(parsed.data.orderId),
      amount: parsed.data.amount,
    });
  } catch (err) {
    // DB 오류 등 confirmPayment 가 결과로 돌려주지 못한 예외. Toss 승인이 이미 끝났을
    // 수 있으므로 재시도 버튼(ALREADY_PROCESSED_PAYMENT 수렴)과 스윕이 마무리한다.
    console.error(
      JSON.stringify({
        event: 'payment_redirect_confirm_error',
        orderNo: parsed.data.orderId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, code: 'INTERNAL', message: '결제 확인 중 오류가 발생했습니다.' };
  }
}
