/**
 * safeJsonLd — safely serialise an object for injection into an HTML
 * `<script type="application/ld+json">` tag.
 *
 * MEDIUM-003 FIX:
 * `JSON.stringify` alone does NOT escape `</script>` sequences. A database
 * value containing that substring would break out of the <script> tag and
 * allow arbitrary HTML/JS injection (stored XSS via a compromised admin
 * account or DB injection). We replace the two dangerous patterns with their
 * Unicode equivalents, which are valid JSON and harmless to JSON parsers.
 *
 *   <  →  <
 *   >  →  >
 *   &  →  &  (bonus: neutralises HTML entity injection)
 *
 * This is the same approach used by DOMPurify and most server-side JSON-in-HTML
 * libraries (e.g. json-stringify-safe, helmet).
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026');
}
