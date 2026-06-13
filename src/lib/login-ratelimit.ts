/**
 * Admin login rate limit — 5 attempts / 15 min per email.
 *
 * Delegates to the unified limiter (`./ratelimit`), which is distributed when
 * Upstash is configured and in-memory otherwise. Keying by EMAIL means a single
 * account can't be brute-forced faster than the window regardless of source IP.
 */
import 'server-only';
import { checkRate, resetRate, _resetRateLimit, type RateLimitResult } from './ratelimit';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

export type LoginRateLimitResult = RateLimitResult;

/** Call BEFORE forwarding credentials to Supabase. */
export function checkLoginRate(email: string): Promise<RateLimitResult> {
  return checkRate('login', email.toLowerCase().trim(), {
    max: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
  });
}

/** Reset on successful login (don't penalise legit users). */
export function resetLoginRate(email: string): Promise<void> {
  return resetRate('login', email.toLowerCase().trim(), WINDOW_MS);
}

/** Test-only. */
export function _resetLoginRateState(): void {
  _resetRateLimit();
}
