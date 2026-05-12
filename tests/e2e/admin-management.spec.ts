import { test } from '@playwright/test';

test.describe('admin', () => {
  test.skip('admin can create a product and see it on the catalog', async () => {
    // Phase 4 — Frontend Dev wires admin/products + auth seeding.
  });
  test.skip('admin can adjust STANDARD shipping fee and threshold (ADR-008)', async () => {});
  test.skip('admin can deactivate a shipping method (ADR-008)', async () => {});
});
