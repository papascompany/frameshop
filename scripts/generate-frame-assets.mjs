/**
 * Generate frame asset PNGs (transparent inner window) + colorway swatches.
 *
 *  Output (written to /tmp/frame-assets/):
 *    frame-{color}.png        — 1200×1500 4:5 portrait, alpha hole at
 *                                inner_rect = { x:.08, y:.08, w:.84, h:.84 }.
 *    frame-{color}-preview.jpg — 480×600 lifestyle thumbnail with a
 *                                photograph showing through the hole.
 *
 *  These are uploaded to the `photos` Supabase Storage bucket by the
 *  accompanying shell script, then referenced from `frame_assets.png_url`
 *  / `preview_url` rows seeded in 015_image_seed.sql.
 *
 *  Why 1200×1500?
 *  ─────────────
 *  Stage canvas is at most 1080 px (mobile GPU limit, docs/frame_skills.md
 *  §6.2). At 1200 px the PNG always downsamples — never upsamples —
 *  giving us crisp edges with zero perceptible cost. 4:5 portrait matches
 *  the most common variant aspects (4×6, 5×7, 8×10, 11×14 ≈ 4:5).
 *
 *  inner_rect is **normalized** per `frame_assets` schema (ADR / SSOT
 *  docs/frame_skills.md §2.1). The hole is centered with an 8% border on
 *  every side, leaving 84% × 84% visible area for the photograph.
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = '/tmp/frame-assets';

const FRAMES = [
  {
    code: 'black',
    label: '블랙',
    outer: '#141414',
    bevelLight: '#2a2a2a',
    bevelDark: '#000000',
    swatchBg: 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)',
  },
  {
    code: 'brown',
    label: '월넛 우드',
    outer: '#5b3a1f',
    bevelLight: '#7a5230',
    bevelDark: '#2e1a0c',
    swatchBg: 'linear-gradient(135deg, #6b4423 0%, #3e2614 100%)',
  },
  {
    code: 'white',
    label: '화이트',
    outer: '#f5f5f5',
    bevelLight: '#ffffff',
    bevelDark: '#dcdcdc',
    swatchBg: 'linear-gradient(135deg, #ffffff 0%, #e5e5e5 100%)',
  },
  {
    code: 'natural',
    label: '내추럴 오크',
    outer: '#c9a87c',
    bevelLight: '#dcc098',
    bevelDark: '#a88656',
    swatchBg: 'linear-gradient(135deg, #d4b48a 0%, #b08c5a 100%)',
  },
];

const W = 1200;
const H = 1500;
const INNER_X = Math.round(W * 0.08);
const INNER_Y = Math.round(H * 0.08);
const INNER_W = Math.round(W * 0.84);
const INNER_H = Math.round(H * 0.84);
const BEVEL = 14;

function frameSvg(f) {
  // Three-stop wood/lacquer effect: outer face, inner bevel highlight, and
  // a darker shadow line inside the hole. SVG `mask` carves the alpha
  // window; `rect` fills underneath are not drawn into the hole.
  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <mask id="hole">
      <rect width="${W}" height="${H}" fill="white"/>
      <rect x="${INNER_X}" y="${INNER_Y}" width="${INNER_W}" height="${INNER_H}" fill="black"/>
    </mask>
    <linearGradient id="grain" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${f.bevelLight}"/>
      <stop offset="0.45" stop-color="${f.outer}"/>
      <stop offset="0.55" stop-color="${f.outer}"/>
      <stop offset="1" stop-color="${f.bevelDark}"/>
    </linearGradient>
  </defs>

  <!-- Main frame face with vertical grain gradient -->
  <rect width="${W}" height="${H}" fill="url(#grain)" mask="url(#hole)"/>

  <!-- Inner bevel highlight (1px hairline just outside the hole) -->
  <rect
    x="${INNER_X - 2}" y="${INNER_Y - 2}"
    width="${INNER_W + 4}" height="${INNER_H + 4}"
    fill="none"
    stroke="${f.bevelLight}" stroke-width="2" opacity="0.55"
  />
  <!-- Inner bevel shadow -->
  <rect
    x="${INNER_X - BEVEL}" y="${INNER_Y - BEVEL}"
    width="${INNER_W + BEVEL * 2}" height="${INNER_H + BEVEL * 2}"
    fill="none"
    stroke="${f.bevelDark}" stroke-width="${BEVEL}" opacity="0.18"
    mask="url(#hole)"
  />

  <!-- Outer-edge hairline shadow -->
  <rect
    x="1" y="1" width="${W - 2}" height="${H - 2}"
    fill="none" stroke="${f.bevelDark}" stroke-width="2" opacity="0.45"
  />
</svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const f of FRAMES) {
    const svg = frameSvg(f);
    const pngPath = path.join(OUT_DIR, `frame-${f.code}.png`);
    await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9 })
      .toFile(pngPath);

    // Preview swatch — solid-tone tile with the label, 480×600 portrait.
    const previewSvg = `
<svg width="480" height="600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${f.bevelLight}"/>
      <stop offset="1" stop-color="${f.bevelDark}"/>
    </linearGradient>
  </defs>
  <rect width="480" height="600" fill="url(#g)"/>
  <rect x="36" y="36" width="408" height="528" fill="none" stroke="${f.bevelLight}" stroke-width="2" opacity="0.6"/>
  <text
    x="240" y="320"
    text-anchor="middle"
    font-family="Inter, sans-serif" font-size="38" font-weight="700"
    fill="${f.code === 'white' ? '#1a1a1a' : '#ffffff'}"
    letter-spacing="2"
  >${f.label}</text>
  <text
    x="240" y="364"
    text-anchor="middle"
    font-family="Inter, sans-serif" font-size="18" font-weight="500"
    fill="${f.code === 'white' ? '#444' : 'rgba(255,255,255,0.75)'}"
    letter-spacing="6"
  >${f.code.toUpperCase()}</text>
</svg>`;
    const previewPath = path.join(OUT_DIR, `frame-${f.code}-preview.jpg`);
    await sharp(Buffer.from(previewSvg))
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(previewPath);

    console.log(`✓ ${f.code} → ${pngPath}, ${previewPath}`);
  }

  console.log(`\nDone. Inner rect: { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }`);
  console.log(`Dimensions: ${W}×${H} (4:5 portrait).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
