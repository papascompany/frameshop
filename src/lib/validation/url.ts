/**
 * URL validation helpers shared by Zod schemas at IO boundaries.
 *
 * Why: Zod's `.url()` only checks that a string parses as a WHATWG URL.
 * That means `javascript:alert(1)`, `data:text/html,...`, and `file:///etc/passwd`
 * all pass. When admin-authored URLs flow into `next/image`, `<a href>`, or
 * background-image style, those schemes turn into stored XSS or data
 * exfiltration vectors.
 *
 * This helper layer rejects everything except `http(s)` so the renderer's
 * "trust the schema" assumption holds.
 *
 * Related: ADR-016, P1-07 (Phase 1 QC audit).
 */

import { z } from 'zod';

const HTTP_SCHEME = /^https?:\/\//i;
const HTTPS_SCHEME = /^https:\/\//i;

/**
 * Accepts only `http://` or `https://` URLs. Use this for fields that may
 * legitimately reference http origins (legacy assets, internal links).
 */
export function httpUrl() {
  return z
    .string()
    .url()
    .refine((value) => HTTP_SCHEME.test(value), {
      message: 'URL must use the http or https scheme',
    });
}

/**
 * Accepts only `https://` URLs. Prefer this for any URL that will be
 * rendered into a public surface (banner image, link, asset) — Supabase
 * Storage always serves https, so admin uploads stay compatible.
 */
export function httpsUrl() {
  return z
    .string()
    .url()
    .refine((value) => HTTPS_SCHEME.test(value), {
      message: 'URL must use the https scheme',
    });
}
