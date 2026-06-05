import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// `unstable_cache` requires Next.js's incremental-cache request context, which
// does not exist under vitest (it throws "Invariant: incrementalCache missing").
// Replace it with a pass-through so any db function wrapped in `unstable_cache`
// (getProductDetail, getShippingMethods, getCategories, …) is testable as the
// raw async function. `revalidateTag`/`revalidatePath` become no-ops.
vi.mock('next/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/cache')>();
  return {
    ...actual,
    unstable_cache: <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => fn,
    revalidateTag: () => {},
    revalidatePath: () => {},
  };
});

// Default env vars for tests (override per-test as needed).
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon-test';
process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ||= 'test_ck_xxxxx';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'service-role-test';
process.env.TOSS_SECRET_KEY ||= 'test_sk_xxxxx';
process.env.TOSS_WEBHOOK_SECRET ||= 'whsec-test';

afterEach(() => {
  cleanup();
});
