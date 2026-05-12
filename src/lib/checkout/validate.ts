/**
 * Pure checkout-form validator (UT-04).
 *
 * Wraps the Zod schema and returns a UI-friendly error map.
 */

import { checkoutFormSchema } from '@/types/checkout';
import type { CheckoutFormData, CheckoutValidation } from '@/types/checkout';

export function validateCheckoutForm(
  data: CheckoutFormData,
): CheckoutValidation {
  const result = checkoutFormSchema.safeParse(data);
  if (result.success) return { ok: true };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    if (!(path in errors)) errors[path] = issue.message;
  }
  return { ok: false, errors };
}

/** Format a phone string by inserting hyphens. Idempotent. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  const mid = digits.length === 10 ? 3 : 4;
  return `${digits.slice(0, 3)}-${digits.slice(3, 3 + mid)}-${digits.slice(3 + mid)}`;
}
