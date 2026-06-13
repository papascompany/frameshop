/**
 * Guest order-lookup rate limit — 10 attempts / 15 min per IP.
 *
 * P2-08: prevents phone enumeration against known order numbers. Delegates to
 * the unified limiter (`./ratelimit`): distributed when Upstash is configured,
 * in-memory otherwise. The route also applies a per-orderNo limit so IP rotation
 * alone can't enumerate phone numbers.
 */
import 'server-only';
import { checkRate, _resetRateLimit, type RateLimitResult } from './ratelimit';

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

export type LookupRateLimitResult = RateLimitResult;

export function checkLookupRate(ip: string): Promise<RateLimitResult> {
  return checkRate('lookup', ip, { max: MAX_ATTEMPTS, windowMs: WINDOW_MS });
}

/** Test-only. */
export function _resetLookupRateState(): void {
  _resetRateLimit();
}
