'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';

type Props = {
  /** Where to navigate after a successful sign-in. Already validated as
   *  same-origin by the calling Server Component / middleware. */
  redirectTo: string;
};

/**
 * Email/password sign-in form.
 *
 *  Why a plain client form instead of a server action?
 *  ─────────────────────────────────────────────────
 *  `signInWithPassword` on the browser client writes the session
 *  cookies via `@supabase/ssr`'s `createBrowserClient`, which is the
 *  cleanest path to keep the middleware in sync. Using a server action
 *  here would require manually plumbing `set-cookie` headers back
 *  through Next 16's response handling.
 *
 *  Defense-in-depth:
 *   - `redirectTo` is sanitized client-side to a same-origin pathname
 *     (no `http://evil.com/...` open-redirect).
 *   - `router.refresh()` after success forces the RSC tree to re-evaluate
 *     `cookies()` so the admin layout immediately renders authenticated.
 *
 *  Error surface: we surface Supabase's `error.message` literally — the
 *  copy ("Invalid login credentials") is already adequate for the Phase 1
 *  admin team. Phase 2 will Korean-localize.
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
      const supabase = getBrowserSupabase();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        setSubmitting(false);
        return;
      }
      // Same-origin pathname guard — never honor an off-site URL even if
      // it was somehow injected via the search param.
      const safeTarget = isSameOriginPath(redirectTo) ? redirectTo : '/admin';
      // Hard-navigate so the middleware re-reads the freshly-set session
      // cookies on the very next request. `router.push` + `router.refresh`
      // also works but a full assignment is more reliable across edge runtimes.
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
