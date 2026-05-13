#!/usr/bin/env bash
#
# Seed (or refresh) the FrameShop admin user.
#
#  - Idempotent: if the email already exists, the script PATCHes the row
#    to enforce the canonical role + password + email-confirm state.
#  - The middleware (src/middleware.ts) checks `app_metadata.role === 'admin'`
#    so we set that as the gate, not user_metadata.
#  - Email confirmation is forced so login works without an email round-trip.
#
# Usage:
#   set -a; source .env.local; set +a
#   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret bash scripts/seed-admin-user.sh
#
# Both ADMIN_EMAIL and ADMIN_PASSWORD are required — no defaults are provided.
#
set -euo pipefail

URL="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL not set}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"
EMAIL="${ADMIN_EMAIL:?Error: ADMIN_EMAIL is required. Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret bash scripts/seed-admin-user.sh}"
PASSWORD="${ADMIN_PASSWORD:?Error: ADMIN_PASSWORD is required. Minimum 8 chars recommended.}"

# Look up existing user by email
LOOKUP=$(curl -fsS "$URL/auth/v1/admin/users?email=${EMAIL}" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY")

USER_ID=$(echo "$LOOKUP" | python3 -c "import sys,json; d=json.load(sys.stdin); u=d.get('users',[]); print(u[0]['id'] if u else '')")

PAYLOAD=$(printf '{"password":"%s","email_confirm":true,"app_metadata":{"role":"admin","provider":"email","providers":["email"]}}' "$PASSWORD")

if [[ -n "$USER_ID" ]]; then
  echo "→ Updating existing user $USER_ID ($EMAIL)"
  curl -fsS -X PUT "$URL/auth/v1/admin/users/$USER_ID" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" > /dev/null
else
  echo "→ Creating new user ($EMAIL)"
  CREATE_PAYLOAD=$(printf '{"email":"%s","password":"%s","email_confirm":true,"app_metadata":{"role":"admin","provider":"email","providers":["email"]}}' "$EMAIL" "$PASSWORD")
  curl -fsS -X POST "$URL/auth/v1/admin/users" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "$CREATE_PAYLOAD" > /dev/null
fi

# Sanity-check login
ANON="${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY not set}"
LOGIN=$(curl -fsS -X POST "$URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")")

ROLE=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('app_metadata',{}).get('role','?'))")
echo ""
echo "✓ Admin user ready"
echo "   email: $EMAIL"
echo "   role:  $ROLE"
