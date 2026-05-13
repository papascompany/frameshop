/**
 * Same-origin guard for mutating API routes (P2-05).
 *
 * Browser cookies + auth flow make our cart/orders/photo endpoints implicitly
 * usable by any page that can reach them — without an Origin check, a third
 * party page can POST to `/api/orders` with the user's session cookie. We gate
 * every non-webhook mutating route at the entry point.
 *
 * Webhook routes (`/api/webhook/*`) MUST NOT use this guard — Toss calls them
 * from their own origin and authenticates via HMAC signature instead.
 *
 * GET handlers are read-only and don't need this guard either.
 */

import 'server-only';
import { envPublic } from '@/lib/env-public';

/**
 * Returns true if the request's Origin matches the configured site URL.
 * Falls back to `Sec-Fetch-Site: same-origin` when `Origin` is absent
 * (some same-origin GET-then-fetch flows omit Origin). Dev mode allows any
 * localhost / 127.0.0.1 origin for local tooling.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const siteUrl = envPublic.siteUrl();

  let expected: URL;
  try {
    expected = new URL(siteUrl);
  } catch {
    return false;
  }

  if (origin) {
    let actual: URL;
    try {
      actual = new URL(origin);
    } catch {
      return false;
    }

    // Dev: accept any localhost/127.0.0.1 origin so curl + dev tools work
    // without forcing operators to align NEXT_PUBLIC_SITE_URL with each port.
    if (
      process.env.NODE_ENV !== 'production' &&
      (actual.hostname === 'localhost' || actual.hostname === '127.0.0.1')
    ) {
      return true;
    }

    return (
      actual.protocol === expected.protocol && actual.host === expected.host
    );
  }

  // Origin header missing: fall back to Sec-Fetch-Site when available.
  // Browsers always set this for fetch(); explicit `same-origin` is safe.
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'same-origin') return true;

  // Tests and server-to-server callers commonly omit both headers; allowing
  // them in non-production keeps the existing route tests green without
  // weakening prod safety.
  //
  // P2-03 verification: Vercel sets NODE_ENV=production for BOTH production
  // AND preview deployments (see vercel.com/docs/projects/environment-variables
  // /system-environment-variables). This bypass therefore ONLY fires in true
  // local development (`next dev`). Preview URLs are fully guarded. ✓
  if (process.env.NODE_ENV !== 'production' && !secFetchSite) {
    return true;
  }

  return false;
}
