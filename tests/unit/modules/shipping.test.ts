/**
 * calculateShippingFee — pure function for shipping price (ADR-008).
 *
 * Spec: docs/specs/checkout.md AC-13~17, ADR-008.
 */

import { describe, expect, it } from 'vitest';
import { calculateShippingFee } from '@/lib/shipping/calc';
import { InactiveShippingMethodError, type ShippingMethodConfig } from '@/types/shipping';
import { asBrand } from '@/types/common';
import type { ShippingMethodId } from '@/types/common';

function cfg(
  overrides: Partial<ShippingMethodConfig> & Pick<ShippingMethodConfig, 'code'>,
): ShippingMethodConfig {
  return {
    id: asBrand<ShippingMethodId>('id-' + overrides.code),
    code: overrides.code,
    label: overrides.label ?? overrides.code,
    fee: overrides.fee ?? 0,
    freeThreshold: overrides.freeThreshold ?? null,
    note: overrides.note ?? null,
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: '2026-05-12T00:00:00Z',
    updatedAt: '2026-05-12T00:00:00Z',
  };
}

const settings: ShippingMethodConfig[] = [
  cfg({ code: 'STANDARD', fee: 3000, freeThreshold: 30000 }),
  cfg({ code: 'PICKUP', fee: 0 }),
  cfg({ code: 'QUICK', fee: 10000 }),
];

describe('calculateShippingFee', () => {
  describe('STANDARD', () => {
    it('returns fee when subtotal is below threshold', () => {
      expect(calculateShippingFee('STANDARD', 29000, settings)).toBe(3000);
    });

    it('returns 0 at threshold', () => {
      expect(calculateShippingFee('STANDARD', 30000, settings)).toBe(0);
    });

    it('returns 0 above threshold', () => {
      expect(calculateShippingFee('STANDARD', 50000, settings)).toBe(0);
    });

    it('returns fee when threshold is null (disabled)', () => {
      const noThresh = [
        cfg({ code: 'STANDARD', fee: 3000, freeThreshold: null }),
        ...settings.slice(1),
      ];
      expect(calculateShippingFee('STANDARD', 50000, noThresh)).toBe(3000);
    });

    it('returns 0 when threshold is 0 (always free)', () => {
      const zeroThresh = [
        cfg({ code: 'STANDARD', fee: 3000, freeThreshold: 0 }),
        ...settings.slice(1),
      ];
      expect(calculateShippingFee('STANDARD', 0, zeroThresh)).toBe(0);
    });
  });

  describe('PICKUP', () => {
    it('is always zero regardless of subtotal', () => {
      expect(calculateShippingFee('PICKUP', 0, settings)).toBe(0);
      expect(calculateShippingFee('PICKUP', 100_000, settings)).toBe(0);
    });
  });

  describe('QUICK', () => {
    it('always returns the configured fee — threshold ignored', () => {
      expect(calculateShippingFee('QUICK', 100_000, settings)).toBe(10000);
      expect(calculateShippingFee('QUICK', 1000, settings)).toBe(10000);
    });
  });

  describe('error cases', () => {
    it('throws InactiveShippingMethodError when method is inactive', () => {
      const inactive = [cfg({ code: 'QUICK', fee: 10000, isActive: false })];
      expect(() => calculateShippingFee('QUICK', 1000, inactive)).toThrow(
        InactiveShippingMethodError,
      );
    });

    it('throws when method is missing from settings', () => {
      expect(() => calculateShippingFee('QUICK', 1000, [])).toThrow(
        InactiveShippingMethodError,
      );
    });
  });
});
