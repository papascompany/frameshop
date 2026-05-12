/**
 * <CheckoutForm> integration (Phase 4 — frontend dev).
 *
 * Spec: docs/specs/checkout.md IT-04, ADR-008 PICKUP exemption.
 *
 * Stubbed `it.todo` entries — Frontend Dev wires up the component to make
 * them green during Phase 4.
 */

import { describe, it } from 'vitest';

describe('<CheckoutForm>', () => {
  it.todo('renders orderer + shipping sections + shipping-method radios');
  it.todo('shows inline error on invalid email blur');
  it.todo('"same as orderer" toggle copies orderer values to shipping');
  it.todo('postcode mock dialog fills zip + addr1');
  it.todo('PICKUP selection disables shipping address fields');
  it.todo('STANDARD subtotal >= threshold shows "무료배송" badge');
  it.todo('submit calls createOrder API and routes to /payment/...');
  it.todo('previous-shipping dropdown shows for authed users only');
});
