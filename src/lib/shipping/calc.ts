/**
 * Pure shipping-fee calculator (ADR-008).
 *
 * Rules:
 *  - PICKUP → always 0
 *  - STANDARD → subtotal >= freeThreshold (when set) → 0, else `fee`.
 *               freeThreshold === null → always `fee`.
 *  - QUICK    → always `fee` (no free threshold)
 *
 * Throws `InactiveShippingMethodError` if the requested method is missing
 * or inactive in `settings`.
 *
 * UT target — see tests/unit/modules/shipping.test.ts.
 */

import {
  InactiveShippingMethodError,
  type ShippingMethod,
  type ShippingMethodConfig,
} from '@/types/shipping';

export function calculateShippingFee(
  method: ShippingMethod,
  subtotal: number,
  settings: readonly ShippingMethodConfig[],
): number {
  const config = settings.find((s) => s.code === method && s.isActive);
  if (!config) {
    throw new InactiveShippingMethodError(method);
  }

  switch (method) {
    case 'PICKUP':
      return 0;
    case 'QUICK':
      return config.fee;
    case 'STANDARD': {
      if (config.freeThreshold !== null && subtotal >= config.freeThreshold) {
        return 0;
      }
      return config.fee;
    }
  }
}
