#!/usr/bin/env node
// scripts/apply-mirrored-urls.mjs
// P1-07: Rewrite src/data/landing-curation.ts to use Supabase Storage URLs
//        instead of Unsplash CDN URLs.
//
// Usage: node scripts/apply-mirrored-urls.mjs
// Env:   NEXT_PUBLIC_SUPABASE_URL (from .env.local)
//
// Run AFTER mirror-unsplash.mjs has successfully uploaded all photos.
//
// What changes in landing-curation.ts:
//   - The `unsplash(id, opts)` helper is replaced with a `mirrored(id)` helper
//     that returns the Supabase Storage public URL unconditionally.
//   - Every call-site (unsplash('...', {...})) becomes mirrored('...')
//     because the mirrored file is always served at full quality (w=1600, q=85)
//     and Next.js Image handles the resize/format at runtime.
//   - The `next.config.ts` allowlist note is preserved via a code comment.
//   - The `opts` parameter (w, q, fit) is intentionally dropped: the CDN
//     query-string was only needed by Unsplash; Next.js `<Image>` handles
//     all transforms on our side via its image optimizer.
//
// Idempotency: running the script a second time is a no-op because the
// `unsplash(` string will no longer exist in the file after the first run.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load env from .env.local ──────────────────────────────────────────────

const envPath = resolve(__dirname, '../.env.local');

function loadEnv(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(envPath);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!SUPABASE_URL) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL. Set it in .env.local before running.',
  );
  process.exit(1);
}

// ─── Target file path ─────────────────────────────────────────────────────

const CURATION_FILE = resolve(
  __dirname,
  '../src/data/landing-curation.ts',
);

// ─── Transformation ───────────────────────────────────────────────────────

/**
 * Returns the Supabase Storage public URL for a mirrored Unsplash photo.
 * Matches the path written by mirror-unsplash.mjs.
 */
function _mirroredUrl(photoId) {
  return `${SUPABASE_URL}/storage/v1/object/public/marketing/unsplash/${photoId}.jpg`;
}

function rewrite(source) {
  // 1. Check if already migrated (idempotent guard)
  if (!source.includes('unsplash(')) {
    console.log('File has already been migrated — no changes needed.');
    return source;
  }

  // 2. Replace the `unsplash` helper definition with a `mirrored` helper.
  //    The new helper ignores width/quality/fit because Next.js <Image>
  //    handles all transforms at serve time via its built-in optimizer.
  const newHelper = `/** Returns the Supabase Storage public URL for a mirrored Unsplash photo (P1-07). */
export function mirrored(id: string): string {
  return \`${SUPABASE_URL}/storage/v1/object/public/marketing/unsplash/\${id}.jpg\`;
}`;

  // Match the full function declaration including its JSDoc comment
  const helperPattern =
    /\/\*\*[\s\S]*?\*\/\s*\nexport function unsplash\([^)]*\)[^{]*\{[^}]*\}/;

  let result = source.replace(helperPattern, newHelper);

  if (!result.includes('export function mirrored')) {
    // Fallback: the JSDoc+signature pattern didn't match exactly.
    // Replace just the function body with a simpler pattern.
    const fallbackPattern =
      /export function unsplash\(\s*id:\s*string[\s\S]*?\n\}/;
    result = result.replace(fallbackPattern, newHelper);
  }

  // 3. Replace every call: unsplash('photo-id', { ...opts })  →  mirrored('photo-id')
  //    The opts object (w, q, fit) is dropped — Next.js Image handles resizing.
  //    Pattern: unsplash('<id>',  <optional-opts-object>)
  //    We match the string literal photo ID and greedily consume the trailing
  //    options argument (if any) including its closing paren.
  result = result.replace(
    /unsplash\(\s*'([^']+)'(?:\s*,\s*\{[^}]*\})?\s*\)/g,
    (_match, id) => `mirrored('${id}')`,
  );

  // 4. Update the file-level JSDoc to reflect the storage change.
  //    The original comment references Unsplash CDN URL patterns.
  result = result.replace(
    /\* {2}Stable Unsplash CDN URL pattern:[\s\S]*?\*\//m,
    `*  Mirrored asset URL pattern (P1-07):
 *    \`\${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/marketing/unsplash/{ID}.jpg\`
 *
 *  The \`images.unsplash.com\` host entry in \`next.config.ts\` can be removed
 *  once the migration to Supabase Storage is complete and the CDN URLs are
 *  no longer referenced anywhere.
 */`,
  );

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  let source;
  try {
    source = readFileSync(CURATION_FILE, 'utf8');
  } catch (err) {
    console.error(`Cannot read ${CURATION_FILE}: ${err.message}`);
    process.exit(1);
  }

  const updated = rewrite(source);

  if (updated === source) {
    // rewrite() returned unchanged source (already migrated)
    return;
  }

  writeFileSync(CURATION_FILE, updated, 'utf8');

  // Verify the transformation removed all unsplash() calls
  if (updated.includes('unsplash(')) {
    console.error(
      'WARNING: some unsplash() calls were not replaced. Check the file manually.',
    );
    process.exit(1);
  }

  // Count replaced call-sites for the summary
  const mirroredCount = (updated.match(/mirrored\('/g) || []).length;

  console.log(
    JSON.stringify({
      event: 'apply_mirrored_urls_ok',
      file: CURATION_FILE,
      mirroredCallSites: mirroredCount,
      supabaseUrl: SUPABASE_URL,
    }),
  );
  console.log(
    `Updated ${CURATION_FILE} — ${mirroredCount} call-sites now use Supabase Storage.`,
  );
}

main();
