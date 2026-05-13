#!/usr/bin/env node
// scripts/mirror-unsplash.mjs
// P1-07: Mirror Unsplash editorial photos to Supabase Storage.
// Usage: node scripts/mirror-unsplash.mjs
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from .env.local)
//
// Why mirror? Unsplash hot-link blocking and potential takedowns leave ISR-cached
// HTML referencing broken image URLs for up to 10 minutes per stale window.
// Storing files in Supabase Storage under our own project eliminates that risk.
//
// Idempotency: the upload uses x-upsert: false. A 409 response means the file
// already exists — treated as success so the script is safe to re-run at any time.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { request as httpsRequest, get as httpsGet } from 'node:https';
import { request as httpRequest, get as httpGet } from 'node:http';

// ─── Load env from .env.local ──────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');

function loadEnv(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    // No .env.local — rely on process.env already containing the vars
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Never overwrite values already present in the real environment
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(envPath);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.',
  );
  process.exit(1);
}

// ─── Photo ID list (all unique IDs from src/data/landing-curation.ts) ──────
//
// Extracted from every unsplash() call in that file.
// Update this list whenever landing-curation.ts adds new photo IDs.

const PHOTO_IDS = [
  '1513519245088-0e12902e5a38', // hero slide 1 — living room gallery wall
  '1577083552431-6e5fd01988ec', // hero slide 2 — gallery white walls
  '1506905925346-21bda4d32df4', // hero slide 3 / landscape tile 1 — alpine fog
  '1582738411706-bfc8e691d1c2', // masterpiece tile 1 — impressionist interior
  '1554188248-986adbb73be4',    // masterpiece tile 2 — abstract on white wall
  '1565195972571-edec74b0bef8', // masterpiece tile 3 — landscape in wood frame
  '1577720580479-7d839d829c73', // masterpiece tile 4 — black & white frames
  '1545987796-200677ee1011',    // masterpiece tile 5 — landscape interior
  '1518998053901-5348d3961a04', // masterpiece tile 6 — frame on furniture
  '1470071459604-3b5ec3a7fe05', // landscape tile 2 — misty forest
  '1501785888041-af3ef285b470', // landscape tile 3 — coastal cliff
  '1469474968028-56623f02e42e', // landscape tile 4 — river and mountain
  '1418065460487-3e41a6c84dc5', // landscape tile 5 — golden hour field
  '1597423498219-04418210827d', // lifestyle block — gallery wall interior
  '1607082348824-0a96f2a4b9da', // member benefit — free shipping concept
  '1452860606245-08befc0ff44b', // member benefit — 3-day craft workshop
  '1556015048-4d3aa10df74c',    // member benefit — editor preview scene
];

const BUCKET = 'marketing';
const DOWNLOAD_WIDTH = 1600;
const DOWNLOAD_QUALITY = 85;

// ─── HTTP helpers (Node built-ins only) ───────────────────────────────────────

/**
 * Download a URL, following up to `maxRedirects` 3xx redirects.
 * Resolves with { body: Buffer, statusCode: number, headers: object }.
 */
function fetchBuffer(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let redirectsLeft = maxRedirects;

    function doRequest(currentUrl) {
      const parsed = new URL(currentUrl);
      const getter = parsed.protocol === 'https:' ? httpsGet : httpGet;

      getter(currentUrl, (res) => {
        const { statusCode, headers } = res;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          if (redirectsLeft-- <= 0) {
            reject(new Error(`Too many redirects following ${url}`));
            return;
          }
          res.resume(); // drain response and ignore body
          doRequest(new URL(headers.location, currentUrl).toString());
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ body: Buffer.concat(chunks), statusCode, headers }),
        );
        res.on('error', reject);
      }).on('error', reject);
    }

    doRequest(url);
  });
}

/**
 * PUT a buffer into Supabase Storage using the REST API.
 * x-upsert: false — 409 means the file already exists (idempotent).
 * Resolves with { statusCode: number, body: string }.
 */
function uploadBuffer(buffer, storagePath, contentType) {
  return new Promise((resolve, reject) => {
    const target = new URL(
      `/storage/v1/object/${BUCKET}/${storagePath}`,
      SUPABASE_URL,
    );
    const isHttps = target.protocol === 'https:';
    const requester = isHttps ? httpsRequest : httpRequest;

    const options = {
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'x-upsert': 'false',
      },
    };

    const req = requester(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

// ─── Per-photo mirroring logic ─────────────────────────────────────────────

async function mirrorPhoto(photoId) {
  const downloadUrl =
    `https://images.unsplash.com/photo-${photoId}` +
    `?w=${DOWNLOAD_WIDTH}&q=${DOWNLOAD_QUALITY}&auto=format&fit=crop`;
  const storagePath = `unsplash/${photoId}.jpg`;
  const publicUrl =
    `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  // Step 1 — Download from Unsplash
  let download;
  try {
    download = await fetchBuffer(downloadUrl);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'mirror_download_failed',
        photoId,
        error: err.message,
      }),
    );
    return { photoId, ok: false, reason: 'download_failed' };
  }

  if (download.statusCode !== 200) {
    console.error(
      JSON.stringify({
        event: 'mirror_download_non_200',
        photoId,
        statusCode: download.statusCode,
      }),
    );
    return {
      photoId,
      ok: false,
      reason: `download_status_${download.statusCode}`,
    };
  }

  const contentType = download.headers['content-type'] || 'image/jpeg';

  // Step 2 — Upload to Supabase Storage (idempotent)
  let upload;
  try {
    upload = await uploadBuffer(download.body, storagePath, contentType);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'mirror_upload_failed',
        photoId,
        error: err.message,
      }),
    );
    return { photoId, ok: false, reason: 'upload_failed' };
  }

  // 409 = object already exists — treat as success
  if (upload.statusCode === 409) {
    console.log(
      JSON.stringify({ event: 'mirror_already_exists', photoId, publicUrl }),
    );
    return { photoId, ok: true, publicUrl, skipped: true };
  }

  if (upload.statusCode !== 200 && upload.statusCode !== 201) {
    console.error(
      JSON.stringify({
        event: 'mirror_upload_non_200',
        photoId,
        statusCode: upload.statusCode,
        body: upload.body,
      }),
    );
    return {
      photoId,
      ok: false,
      reason: `upload_status_${upload.statusCode}`,
    };
  }

  console.log(JSON.stringify({ event: 'mirror_ok', photoId, publicUrl }));
  return { photoId, ok: true, publicUrl, skipped: false };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    JSON.stringify({
      event: 'mirror_start',
      bucket: BUCKET,
      photoCount: PHOTO_IDS.length,
    }),
  );

  const results = [];
  // Process sequentially to avoid hammering either Unsplash or Storage
  for (const id of PHOTO_IDS) {
    const result = await mirrorPhoto(id);
    results.push(result);
  }

  console.log('\n--- URL mapping ---');
  for (const r of results) {
    const originalBase = `https://images.unsplash.com/photo-${r.photoId}`;
    if (r.ok) {
      const note = r.skipped ? ' (already existed, skipped download)' : '';
      console.log(`${originalBase}?...\n  → ${r.publicUrl}${note}\n`);
    } else {
      console.log(`${originalBase}: FAILED (${r.reason})\n`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(
      JSON.stringify({
        event: 'mirror_complete_with_errors',
        failedCount: failed.length,
        failedIds: failed.map((r) => r.photoId),
      }),
    );
    process.exit(1);
  }

  console.log(JSON.stringify({ event: 'mirror_complete', ok: true }));
}

main().catch((err) => {
  console.error(JSON.stringify({ event: 'mirror_fatal', error: err.message }));
  process.exit(1);
});
