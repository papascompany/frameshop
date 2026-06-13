/**
 * Friendly Korean copy for Toss payment failure codes.
 *
 * Toss redirects to /payment/fail with `?code=...&message=...`, and the
 * confirm endpoint may also return a Toss code. Raw codes like
 * `PAY_PROCESS_CANCELED` mean nothing to a shopper, so map the common ones to
 * plain Korean. Unknown codes fall back to a generic, non-alarming message.
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

/** Map a Toss code/message to friendly Korean copy. */
export function tossErrorCopy(code?: string | null, fallbackMessage?: string | null): string {
  if (code && TOSS_CODE_COPY[code]) return TOSS_CODE_COPY[code];
  // A human Korean message from Toss is better than a raw code, but never echo
  // an English code as the primary message.
  if (fallbackMessage && !/^[A-Z0-9_]+$/.test(fallbackMessage)) return fallbackMessage;
  return '결제를 완료하지 못했습니다. 다시 시도해 주세요.';
}
