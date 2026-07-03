/**
 * 체크아웃 합계 계산 — 순수 함수 (FS-EC-01, UT 대상).
 *
 * CheckoutClient 의 표시 금액과 createOrder 전송값(clientShippingFee)이
 * 서버 재계산과 일치해야 하므로(SHIPPING_FEE_MISMATCH), 추가배송비는 반드시
 * backend 와 동일한 공용 순수 함수(`@/lib/shipping/surcharge`)로 계산한다.
 *
 * 합계 계약(FS-EC-01 §6):
 *   상품합계 + 배송비 + 추가배송비(surcharge) − 적립금 사용 = 최종 결제액.
 *
 * 클라/테스트 공용 — server-only import 금지, IO 없음.
 */

import { classifyZip, calcSurcharge } from '@/lib/shipping/surcharge';
import { maxRedeemable } from '@/types/points';
import type { PointsSummary } from '@/types/points';
import type { ShippingMethodConfig } from '@/types/shipping';

/** calcSurcharge 가 실제로 사용하는 설정 부분집합. */
export type SurchargeMethodConfig = Pick<
  ShippingMethodConfig,
  'code' | 'surchargeFeeJeju' | 'surchargeFeeRemote'
>;

/**
 * 우편번호 + 배송방법 설정 → 추가배송비(KRW).
 * method 가 null(설정 미로드/비활성)이면 0. PICKUP/QUICK, 잘못된 zip,
 * 030 미적용(surcharge 필드 0/undefined 폴백)도 calcSurcharge 규칙대로 0.
 */
export function computeSurchargeFee(
  zip: string,
  method: SurchargeMethodConfig | null,
): number {
  if (!method) return 0;
  return calcSurcharge(classifyZip(zip), method);
}

/**
 * 입력된 사용 적립금을 [0, maxRedeemable(balance, payable)] 로 clamp.
 * 비정상 입력(NaN/음수/Infinity)은 0. 소수 입력은 내림(1P = 1KRW 정수).
 */
export function clampRedeem(
  desired: number,
  balance: number,
  payable: number,
): number {
  if (!Number.isFinite(desired) || desired <= 0) return 0;
  return Math.min(Math.floor(desired), maxRedeemable(balance, payable));
}

export type CheckoutTotals = {
  /** 포인트 차감 전 결제 예정액 = 상품합계 + 배송비 + 추가배송비. */
  payable: number;
  /** 실제 적용될 적립금(clamp 후). 포인트 미가용이면 0. */
  redeemApplied: number;
  /** 최종 결제액 = payable − redeemApplied. Toss 위젯 요청 금액. */
  total: number;
};

/**
 * 체크아웃 요약 카드 + 결제 요청 금액의 단일 계산 지점.
 * `desiredRedeem` 은 폼 입력값 그대로 — payable 이 나중에 줄어도(배송방법
 * 변경 등) 파생 계산이 자동으로 재-clamp 하므로 effect 로 폼을 고칠 필요가
 * 없다(React 19 set-state-in-effect 회피).
 */
export function computeCheckoutTotals(args: {
  subtotal: number;
  shippingFee: number;
  surchargeFee: number;
  desiredRedeem: number;
  points: PointsSummary;
}): CheckoutTotals {
  const payable = args.subtotal + args.shippingFee + args.surchargeFee;
  const redeemApplied = args.points.available
    ? clampRedeem(args.desiredRedeem, args.points.balance, payable)
    : 0;
  return { payable, redeemApplied, total: payable - redeemApplied };
}
