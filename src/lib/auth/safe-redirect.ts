/**
 * Post-login redirect sanitizer (security review P2-2).
 *
 * The `?redirect=` value is attacker-controlled. A prefix check such as
 * `startsWith('/') && !startsWith('//')` is not enough: browsers strip tab/CR/LF
 * from URLs (WHATWG URL parser), so `/\t/evil.example` becomes
 * `//evil.example` — a protocol-relative open redirect. Backslashes are
 * likewise normalized to `/`.
 *
 * Rule: reject control characters and backslashes outright, require a single
 * leading `/`, then parse against our own origin with the same URL parser the
 * browser uses and accept only when the origin is unchanged. The returned
 * value is rebuilt from pathname + search + hash, never the raw input.
 *
 * Pure (no DOM access) so it is unit-testable; callers pass
 * `window.location.origin`.
 */

// C0 controls, DEL and C1 controls — includes \t \n \r that browsers strip.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export function safeRedirectPath(
  raw: string | null | undefined,
  origin: string,
  fallback: string,
): string {
  if (!raw) return fallback;
  if (CONTROL_CHARS.test(raw) || raw.includes('\\')) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;

  let url: URL;
  let base: URL;
  try {
    base = new URL(origin);
    url = new URL(raw, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base.origin) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;
  // Defense in depth: the rebuilt path must itself still be a single-slash path.
  return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
}
