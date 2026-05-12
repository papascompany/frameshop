/**
 * Defense-in-depth guard for user-supplied URLs that will be rendered as
 * `<a href={...}>` or assigned to `location`.
 *
 * Upstream Zod schemas (e.g. `bannerPayloadSchema` in `src/types/curation.ts`)
 * already restrict the protocol at admin write-time, but a render-time guard
 * means even legacy/poisoned rows in `curations.payload` cannot produce a
 * `javascript:` / `data:` / `vbscript:` link.
 *
 * Returns `'#'` for anything that isn't a well-formed `http(s):` URL.
 */
export function safeHref(url: string | null | undefined): string {
  if (!url) return '#';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url;
    }
  } catch {
    // fall through
  }
  return '#';
}
