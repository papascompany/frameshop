/**
 * POST /api/auth/login — 비회원 주문 귀속 조건 (보안 검토 P1-7).
 *
 * 비밀번호 로그인 성공만으로는 메일함 소유가 증명되지 않는다(Supabase "Confirm email"
 * 설정 의존). 귀속은 Supabase 가 확인한 계정 자신의 이메일로만, 확인된 경우에만 한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
};

const state: {
  user: MockUser | null;
  signInError: { status: number; message: string } | null;
  claimCalls: Array<{ userId: string; email: string }>;
} = {
  user: null,
  signInError: null,
  claimCalls: [],
};

vi.mock('@/lib/login-ratelimit', () => ({
  checkLoginRate: async () => ({ ok: true }),
  resetLoginRate: async () => {},
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: {
      signInWithPassword: async () =>
        state.signInError
          ? { data: { user: null, session: null }, error: state.signInError }
          : { data: { user: state.user, session: {} }, error: null },
    },
  }),
}));

vi.mock('@/lib/db/order', () => ({
  claimGuestOrdersByEmail: async (userId: string, email: string) => {
    state.claimCalls.push({ userId, email });
    return 1;
  },
}));

import { POST } from '@/app/api/auth/login/route';

async function login(email = 'Typed@Example.com'): Promise<Response> {
  return POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'pw-123456' }),
    }),
  );
}

beforeEach(() => {
  state.user = null;
  state.signInError = null;
  state.claimCalls = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('POST /api/auth/login — 비회원 주문 귀속 (P1-7)', () => {
  it('이메일이 확인된 계정은 계정 자신의 이메일로 귀속한다(입력값이 아니라)', async () => {
    state.user = {
      id: 'user-1',
      email: 'owner@example.com',
      email_confirmed_at: '2026-11-01T00:00:00Z',
    };
    const res = await login('Typed@Example.com');
    expect(res.status).toBe(200);
    expect(state.claimCalls).toEqual([{ userId: 'user-1', email: 'owner@example.com' }]);
  });

  it('confirmed_at 만 있는 경우도 확인된 것으로 본다', async () => {
    state.user = { id: 'user-1', email: 'owner@example.com', confirmed_at: '2026-11-01T00:00:00Z' };
    await login();
    expect(state.claimCalls).toEqual([{ userId: 'user-1', email: 'owner@example.com' }]);
  });

  it('이메일 미확인 계정은 로그인은 되지만 비회원 주문을 귀속하지 않는다', async () => {
    state.user = { id: 'user-1', email: 'victim@example.com', email_confirmed_at: null, confirmed_at: null };
    const res = await login('victim@example.com');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(state.claimCalls).toHaveLength(0);
  });

  it('계정에 이메일이 없으면 귀속하지 않는다', async () => {
    state.user = { id: 'user-1', email_confirmed_at: '2026-11-01T00:00:00Z' };
    await login();
    expect(state.claimCalls).toHaveLength(0);
  });

  it('로그인 실패면 귀속하지 않는다', async () => {
    state.signInError = { status: 400, message: 'Invalid login credentials' };
    const res = await login();
    expect(res.status).toBe(401);
    expect(state.claimCalls).toHaveLength(0);
  });
});
