/**
 * Photo-upload rate limit — 10 uploads / 60s per session or user.
 *
 * Delegates to the unified limiter (`./ratelimit`): distributed when Upstash is
 * configured, in-memory otherwise. Caps Storage egress / service-role pool abuse.
 */
import 'server-only';
import { checkRate, _resetRateLimit, type RateLimitResult } from './ratelimit';

export const UPLOAD_RATE_PER_MIN = 10;
const WINDOW_MS = 60_000;

export function checkUploadRate(key: string): Promise<RateLimitResult> {
  return checkRate('upload', key, { max: UPLOAD_RATE_PER_MIN, windowMs: WINDOW_MS });
}

/** Test-only helper to reset state between tests. */
export function _resetUploadRateState(): void {
  _resetRateLimit();
}
