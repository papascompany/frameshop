/**
 * validateCheckoutForm (UT-04 + ADR-008 PICKUP exemption).
 *
 * Spec: docs/specs/checkout.md AC-3~5, AC-15.
 */

import { describe, expect, it } from 'vitest';
import { formatPhone, validateCheckoutForm } from '@/lib/checkout/validate';
import type { CheckoutFormData } from '@/types/checkout';

function base(): CheckoutFormData {
  return {
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'a@b.com' },
    shipping: {
      sameAsOrderer: false,
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '06236',
      addr1: '서울특별시 강남구 테헤란로 1',
      addr2: '101동 1234호',
      memo: '',
    },
    shippingMethod: 'STANDARD',
  };
}

describe('validateCheckoutForm', () => {
  it('accepts a valid form', () => {
    expect(validateCheckoutForm(base())).toEqual({ ok: true });
  });

  it('rejects malformed email', () => {
    const data = base();
    data.orderer.email = 'not-an-email';
    const r = validateCheckoutForm(data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toContain('orderer.email');
  });

  it('rejects malformed phone', () => {
    const data = base();
    data.orderer.phone = '010-1234';
    const r = validateCheckoutForm(data);
    expect(r.ok).toBe(false);
  });

  it('rejects short zip', () => {
    const data = base();
    data.shipping.zip = '1234';
    expect(validateCheckoutForm(data).ok).toBe(false);
  });

  it('rejects memo over 200 chars', () => {
    const data = base();
    data.shipping.memo = 'a'.repeat(201);
    expect(validateCheckoutForm(data).ok).toBe(false);
  });

  it('exempts shipping address fields when method is PICKUP', () => {
    const data = base();
    data.shippingMethod = 'PICKUP';
    data.shipping.zip = '';
    data.shipping.addr1 = '';
    expect(validateCheckoutForm(data).ok).toBe(true);
  });
});

describe('formatPhone', () => {
  it('inserts hyphens at the right positions', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678');
    expect(formatPhone('0101234567')).toBe('010-123-4567');
    expect(formatPhone('010')).toBe('010');
    expect(formatPhone('01012')).toBe('010-12');
  });

  it('strips non-digits', () => {
    expect(formatPhone('010 1234 5678')).toBe('010-1234-5678');
    expect(formatPhone('010abc1234xyz5678')).toBe('010-1234-5678');
  });
});
