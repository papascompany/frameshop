/**
 * 체크아웃 제출 검증 (FS-EC-01) — 순수 함수, UT 대상.
 *
 * FROZEN 계약(src/types/checkout.ts): 새 체크아웃 UI 는 submit 시
 * `checkoutFormSchema` 와 `checkoutAgreementsSchema` 를 **둘 다** 통과시켜야
 * 한다. base 에 refine 을 넣으면 기존 폼/픽스처가 깨지므로 상위(여기)에서
 * 두 결과를 병합한다. `src/lib/checkout/validate.ts` 는 FROZEN 소비 대상이
 * 아니지만 out-of-scope 라 수정하지 않고 새 헬퍼로 감싼다.
 */

import { checkoutAgreementsSchema, checkoutFormSchema } from '@/types/checkout';
import type { CheckoutFormData, CheckoutValidation } from '@/types/checkout';
import type { z } from 'zod';

function collectErrors(
  error: z.ZodError,
  into: Record<string, string>,
): void {
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!(path in into)) into[path] = issue.message;
  }
}

/**
 * base 폼 검증 + 필수 동의(개인정보/구매조건) 검증을 한 번에 수행하고
 * UI 친화적 에러 맵(`errors['agreePrivacy']` 등)으로 병합해 돌려준다.
 */
export function validateCheckoutSubmit(
  data: CheckoutFormData,
): CheckoutValidation {
  const errors: Record<string, string> = {};

  const base = checkoutFormSchema.safeParse(data);
  if (!base.success) collectErrors(base.error, errors);

  const agreements = checkoutAgreementsSchema.safeParse({
    agreePrivacy: data.agreePrivacy,
    agreePurchase: data.agreePurchase,
  });
  if (!agreements.success) collectErrors(agreements.error, errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true };
}
