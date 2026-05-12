#!/usr/bin/env bash
#
# Upload the 4 generated frame PNGs (+ preview JPGs) to the Supabase
# `photos` Storage bucket. Idempotent — uses `x-upsert: true` so re-runs
# overwrite the same object keys without 409 conflicts.
#
# Prerequisite:
#   1. Run `node scripts/generate-frame-assets.mjs` first. The output
#      lives in /tmp/frame-assets/.
#   2. Source the project's .env.local so NEXT_PUBLIC_SUPABASE_URL and
#      SUPABASE_SERVICE_ROLE_KEY are exported.
#
# Usage:
#   set -a; source .env.local; set +a
#   bash scripts/upload-frame-assets.sh
#
set -euo pipefail

URL="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL not set}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"
SRC="${FRAME_ASSET_DIR:-/tmp/frame-assets}"

if [[ ! -d "$SRC" ]]; then
  echo "✗ $SRC not found — run scripts/generate-frame-assets.mjs first."
  exit 1
fi

for color in black brown white natural; do
  png="$SRC/frame-${color}.png"
  jpg="$SRC/frame-${color}-preview.jpg"

  [[ -f "$png" ]] || { echo "✗ missing $png"; exit 1; }
  [[ -f "$jpg" ]] || { echo "✗ missing $jpg"; exit 1; }

  echo "→ frame-${color}.png"
  curl -fsS -X POST "$URL/storage/v1/object/photos/frame-${color}.png" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: image/png" -H "x-upsert: true" \
    --data-binary "@$png" > /dev/null
  echo "→ frame-${color}-preview.jpg"
  curl -fsS -X POST "$URL/storage/v1/object/photos/frame-${color}-preview.jpg" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: image/jpeg" -H "x-upsert: true" \
    --data-binary "@$jpg" > /dev/null
done

echo ""
echo "✓ Uploaded 8 frame assets to ${URL}/storage/v1/object/public/photos/"
