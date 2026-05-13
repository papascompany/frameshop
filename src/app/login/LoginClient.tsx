'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

type Props = {
  /** Where to navigate after a successful sign-in. Already validated as
   *  same-origin by the calling Server Component / middleware. */
  redirectTo: string;
};

/**
 * Email/password sign-in form.
 *
 *  Why POST /api/auth/login instead of the browser Supabase client?
 *  ─────────────────────────────────────────────────────────────────
 *  Routing through a server-side Route Handler lets us apply per-email rate
 *  limiting (P1-05) before touching Supabase auth, without exposing the
 *  rate-limiter state to the client bundle. The Route Handler calls
 *  `supabase.auth.signInWithPassword` via `createServerClient` so the
 *  session cookies are written server-side and the middleware stays in sync.
 *
 *  Defense-in-depth:
 *   - `redirectTo` is sanitized client-side to a same-origin pathname
 *     (no `http://evil.com/...` open-redirect).
 *   - Hard-navigate via `window.location.assign` so the middleware
 *     re-reads the freshly-set session cookies on the very next request.
 */
export function LoginClient({ redirectTo }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = await res.json() as { ok: boolean; code?: string; message?: string };
      if (!json.ok) {
        setError(json.message ?? '로그인에 실패했습니다.');
        setSubmitting(false);
        return;
      }
      const safeTarget = isSameOriginPath(redirectTo) ? redirectTo : '/admin';
      window.location.assign(safeTarget);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1.5">
        <span className="caption-sm uppercase tracking-wider text-ink">
          이메일
        </span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={cn(
            'h-12 px-4 rounded-[24px]',
            'bg-soft-cloud text-ink body-md',
            'border border-transparent focus:border-ink focus:bg-canvas',
            'outline-none transition-colors',
          )}
          placeholder="you@example.com"
          disabled={submitting}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="caption-sm uppercase tracking-wider text-ink">
          비밀번호
        </span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={cn(
            'h-12 px-4 rounded-[24px]',
            'bg-soft-cloud text-ink body-md',
            'border border-transparent focus:border-ink focus:bg-canvas',
            'outline-none transition-colors',
          )}
          disabled={submitting}
        />
      </label>

      {error ? (
        <div
          role="alert"
          className="caption-md text-sale bg-sale/5 border border-sale/20 rounded-[18px] px-4 py-3"
        >
          {error}
        </div>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="md"
        fullWidth
        loading={submitting}
        disabled={submitting || !email || !password}
      >
        {submitting ? '로그인 중…' : '로그인'}
      </Button>

      <p className="caption-sm text-mute text-center mt-2">
        비밀번호를 잊으셨나요? 관리자에게 문의해주세요.
      </p>
    </form>
  );
}

/**
 * Accepts only same-origin, absolute path-style targets. Rejects:
 *   - Empty string
 *   - Absolute URLs (http://..., //evil.com/..., javascript:..., etc)
 *   - Anything not starting with a single forward slash
 */
function isSameOriginPath(p: string): boolean {
  if (!p) return false;
  if (!p.startsWith('/')) return false;
  // Reject protocol-relative URLs ("//evil.com/path") which start with '/'.
  if (p.startsWith('//')) return false;
  // Reject backslashes that some browsers normalize to '/'.
  if (p.includes('\\')) return false;
  return true;
}
