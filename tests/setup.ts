import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

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
