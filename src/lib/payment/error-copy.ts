/**
 * Friendly Korean copy for Toss payment failure codes.
 *
 * Toss redirects to /payment/fail with `?code=...&message=...`, and the
 * confirm endpoint may also return a Toss code. Raw codes like
 * `PAY_PROCESS_CANCELED` mean nothing to a shopper, so map the common ones to
 * plain Korean. Unknown codes fall back to a generic, non-alarming message.
 * Our own confirm result codes (ORDER_NOT_PAYABLE, AMOUNT_MISMATCH) are mapped
 * here too, so the success page and the retry button show the same copy.
 */

const TOSS_CODE_COPY: Record<string, string> = {
  PAY_PROCESS_CANCELED: '결제를 취소하셨습니다.',
  PAY_PROCESS_ABORTED: '결제가 중단되었습니다. 다시 시도해 주세요.',
  REJECT_CARD_COMPANY: '카드사에서 결제가 거절되었습니다. 다른 카드로 시도해 주세요.',
  INVALID_CARD_EXPIRATION: '카드 유효기간을 다시 확인해 주세요.',
  INVALID_STOPPED_CARD: '정지된 카드입니다. 다른 카드로 시도해 주세요.',
  EXCEED_MAX_DAILY_PAYMENT_COUNT: '오늘 결제 가능 횟수를 초과했습니다.',
  NOT_ENOUGH_BALANCE: '잔액이 부족합니다.',
  EXCEED_MAX_AMOUNT: '결제 한도를 초과했습니다.',
  INVALID_CARD_NUMBER: '카드 번호를 다시 확인해 주세요.',
  TIMEOUT: '시간이 초과되었습니다. 다시 시도해 주세요.',
};

/** confirmPayment 가 Toss 호출 전에 거부한 경우의 문구 — 청구가 없었음을 분명히 한다. */
export const ORDER_NOT_PAYABLE_MESSAGE =
  '취소 또는 환불된 주문이라 결제할 수 없습니다. 이번 결제는 승인되지 않았습니다.';
export const AMOUNT_MISMATCH_MESSAGE =
  '결제 금액이 주문 금액과 일치하지 않습니다. 이번 결제는 승인되지 않았습니다.';
export const COUPON_UNAVAILABLE_MESSAGE =
  '이미 사용했거나 사용 한도가 끝난 쿠폰이 적용된 주문이라 결제하지 않았습니다. 이번 결제는 승인되지 않았습니다. 쿠폰을 빼고 다시 주문해 주세요.';

/** 우리 confirm 결과 코드(ConfirmErrorCode) 중 고객에게 따로 설명할 것. */
const CONFIRM_CODE_COPY: Record<string, string> = {
  ORDER_NOT_PAYABLE: ORDER_NOT_PAYABLE_MESSAGE,
  AMOUNT_MISMATCH: AMOUNT_MISMATCH_MESSAGE,
  COUPON_UNAVAILABLE: COUPON_UNAVAILABLE_MESSAGE,
};

/** Map a Toss code/message to friendly Korean copy. */
export function tossErrorCopy(code?: string | null, fallbackMessage?: string | null): string {
  if (code && TOSS_CODE_COPY[code]) return TOSS_CODE_COPY[code];
  if (code && CONFIRM_CODE_COPY[code]) return CONFIRM_CODE_COPY[code];
  // A human Korean message from Toss is better than a raw code, but never echo
  // an English code as the primary message.
  if (fallbackMessage && !/^[A-Z0-9_]+$/.test(fallbackMessage)) return fallbackMessage;
  return '결제를 완료하지 못했습니다. 다시 시도해 주세요.';
}
