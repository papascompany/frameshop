/**
 * E2E-01: 비회원 풀 플로우 — landing → editor → cart → checkout → payment(test) → success.
 *
 * Spec: docs/PLAN.md §8.3 E2E-01, docs/specs/checkout.md E2E-Checkout-01.
 *
 * Skipped by default until Frontend Dev completes Phase 4 + a Supabase test
 * environment is wired (the project env file is empty in Phase 0). Toggle
 * `test.skip` to `test` when the seed + env are ready.
 */

import { test } from '@playwright/test';

test.describe('user-purchase (mobile 375px)', () => {
  test.skip('full happy-path purchase as guest', async () => {
    // Implemented in Phase 4 / by Frontend Dev once /catalog/[slug] and
    // /studio/[sessionId] render the real seed product.
  });
});
