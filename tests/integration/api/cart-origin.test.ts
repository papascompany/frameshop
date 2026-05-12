/**
 * /api/cart Origin guard test (P2-05).
 *
 * Verifies that mutating cart endpoints reject cross-origin POSTs before
 * reading auth or body — a CSRF safety net on top of cookies.
 */

import { describe, expect, it, vi } from 'vitest';

// The cart route reads the auth user before reading the body, so even though
// the Origin guard fires first we still stub the supabase server client so
// any accidental reach-through wouldn't crash the test.
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

describe('Cart routes — Origin guard (P2-05)', () => {
  it('POST /api/cart returns 403 BAD_ORIGIN for cross-origin request', async () => {
    const { POST } = await import('@/app/api/cart/route');
    const req = new Request('http://localhost/api/cart', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_ORIGIN');
  });

  it('DELETE /api/cart/:localId returns 403 BAD_ORIGIN for cross-origin request', async () => {
    const { DELETE } = await import('@/app/api/cart/[localId]/route');
    const req = new Request('http://localhost/api/cart/abc', {
      method: 'DELETE',
      headers: {
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      },
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ localId: 'abc' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_ORIGIN');
  });
});
