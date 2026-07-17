/**
 * 쿠폰 순수 계산 (FS-X-00, ADR-026).
 *
 * 정책(ADR-026 확정 + FS-X-FIX-A P1-3):
 * - fixed:   할인 = min(value, cap) — value 는 KRW 정액.
 * - percent: 할인 = min(floor(subtotal × value / 10000), cap) — value 는
 *   bps, **subtotal(상품합계) 기준** 계산.
 * - 상한 cap = max(0, payable − POINTS_MIN_PAYABLE): 쿠폰만으로 0원 결제가 되면
 *   PG 최소결제금액 위반 + 표시/청구 불일치가 생기므로, 적립금 maxRedeemable 과
 *   동일 정책으로 최소 결제액(100원)을 남긴다.
 * - 음수/비유한/비정상 입력은 전부 0 (fail-safe — 할인 0 은 항상 안전).
 *
 * 할인 순서: subtotal + shipping + surcharge − 쿠폰할인 − 적립금 = totalPrice.
 * 적립금 상한(maxRedeemable)은 쿠폰 적용 **후** payable 기준으로 재계산한다.
 *
 * 클라/서버 공용 — server-only import 금지 (체크아웃 표시 + createOrder 재검증
 * 이 같은 함수를 사용해 표시/청구 불일치를 구조적으로 차단).
 */

import type { Coupon } from '@/types/coupon';
import { POINTS_MIN_PAYABLE } from '@/types/points';

/**
 * 쿠폰 코드 정규화: trim + 대문자. 저장(042 CHECK `code = upper(btrim(code))`)
 * 과 조회가 모두 이 함수를 거쳐 대소문자/공백 차이로 인한 미스매치를 없앤다.
 */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * 확정 할인액(KRW, 정수 >= 0) 계산.
 *
 * @param coupon   type/value 만 사용(테스트·부분 스냅샷 친화 Pick).
 * @param subtotal 상품합계(KRW) — percent 계산 기준.
 * @param payable  쿠폰 차감 전 결제예정액(KRW) — 할인 상한의 기준. 실제 상한은
 *   payable − POINTS_MIN_PAYABLE 로, 쿠폰 적용 후에도 최소 결제액을 남긴다.
 */
export function calcCouponDiscount(
  coupon: Pick<Coupon, 'type' | 'value'>,
  subtotal: number,
  payable: number,
): number {
  const { type, value } = coupon;
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(subtotal) || !Number.isFinite(payable)) return 0;

  // 상한은 payable 전액이 아니라 payable − 최소결제액. 쿠폰만으로 총액이 0원이
  // 되는 것을 막아(적립금 maxRedeemable 과 동일 정책) PG 최소결제금액 위반과
  // 표시/청구 불일치를 구조적으로 차단한다(FS-X-FIX-A P1-3).
  const cap = Math.max(0, Math.floor(payable) - POINTS_MIN_PAYABLE);
  if (cap <= 0) return 0;

  if (type === 'fixed') {
    return Math.min(Math.floor(value), cap);
  }

  // percent — bps, subtotal 기준. 음수 subtotal 은 0 으로 클램프.
  const base = Math.max(0, Math.floor(subtotal));
  return Math.min(Math.floor((base * value) / 10_000), cap);
}
