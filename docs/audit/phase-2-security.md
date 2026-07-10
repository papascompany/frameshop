# Phase 2 Security Audit ‚Äî Order/Payment/Admin Completeness

Date: 2026-05-13
Reviewer: qc-reviewer
Scope: HEAD = aa81382 (`feat(render): 300dpi server-side print render`)
Compared against: `docs/audit/phase-1.md` (P0-01 + P1-01..07 fixed).
New surface since phase-1:
- `src/lib/render/{pipeline,print,enqueue}.ts` + `src/app/api/render/print/route.ts`
- `src/app/login/{page,LoginClient}.tsx`
- `src/lib/supabase/anon.ts` + ISR (`revalidate`) on landing/catalog/product
- `src/data/landing-curation.ts` (Unsplash imagery)
- `scripts/seed-admin-user.sh`, `supabase/seed/01_phase1_image_seed.sql`
- migrations `013_photos_cleanup.sql`, `014_order_no_atomic.sql`, `015_order_items_render_meta.sql`

## 1. Executive Summary

| Severity | Count |
|---|---|
| P0 (block release) | 4 |
| P1 (fix before next deploy) | 7 |
| P2 (tech debt) | 8 |

**Verdict: NO-GO until P0-01 .. P0-04 are fixed.** The order/payment pipeline has
four real, exploitable holes ‚Äî three of them allow an attacker to either skip
payment, defraud the merchant, or hijack other users' photos/orders. None are
regressions of phase-1 findings; all are new or were previously out of scope.

## 2. P0 ‚Äî Block release

---

### P0-01 ‚Äî `confirmPayment` does not verify Toss's response amount/orderId/status

**File:** `src/lib/payment/confirm.ts:47-78`
**Category:** Payment correctness / Fraud
**Status (vs phase-1):** New finding. Phase-1 P0-01 fixed `createOrder` server-side
pricing; the symmetrical check on the confirm side was never added.

**Code today:**
```ts
// confirm.ts:48-53
await tossClient.confirm({
  paymentKey: input.paymentKey,
  orderId: input.orderId as string,
  amount: input.amount,
});
} catch (err) { ... }
await transitionTo(order.id, 'PAID', { paymentKey: input.paymentKey });
```

The Toss `/v1/payments/confirm` response (`TossConfirmResponse` in
`src/lib/payment/toss.ts:23-34`) is **discarded**. We compare `order.totalPrice
=== input.amount` (the client's claim) before calling Toss, but never check that
Toss's authoritative response says the same thing.

**Attack scenario (real):**
1. Attacker creates legitimate order `20260513-0001` for `48,000Ïõê`.
2. In a parallel tab, attacker creates a second order `20260513-0002` for `100Ïõê`.
3. Attacker initiates Toss checkout for `20260513-0002` (`amount=100`).
4. Toss approves, returns `paymentKey=X`, redirects to
   `/payment/success?orderId=20260513-0002&amount=100&paymentKey=X`.
5. Attacker manually GETs `/payment/success?orderId=20260513-0001&amount=48000&paymentKey=X`
   (or replays the network request to `/api/payment/confirm` with that body).
6. `confirmPayment` looks up order `0001`, sees `totalPrice == 48000 == amount`,
   calls Toss confirm with `paymentKey=X, orderId=20260513-0002, amount=100`.
7. **Toss accepts** ‚Äî the paymentKey/orderId/amount triple is valid (it
   confirmed the 100Ïõê payment). The response has `orderId=20260513-0002,
   totalAmount=100`.
8. We ignore the response and transition `0001` ‚Üí PAID with paymentKey X.
   Attacker received a 48,000Ïõê frame for 100Ïõê.

A second variant: even if `orderId` matched, the confirm `status` could be
`READY` / `IN_PROGRESS` (test mode replay) and we'd still mark PAID.

**Fix (drop-in):**
```ts
// in confirm.ts after the try { await tossClient.confirm(...) }
let tossResp: TossConfirmResponse;
try {
  tossResp = await tossClient.confirm({ ... });
} catch (err) { ... }

if (
  tossResp.orderId !== (input.orderId as string) ||
  tossResp.totalAmount !== order.totalPrice ||
  tossResp.status !== 'DONE'
) {
  // Defensive: don't transition. Try to cancel the Toss payment.
  await tossClient.cancel({ paymentKey: input.paymentKey, cancelReason: 'order_mismatch' }).catch(() => {});
  return { ok: false, code: 'AMOUNT_MISMATCH',
    message: `toss=${tossResp.orderId}/${tossResp.totalAmount}/${tossResp.status} ours=${input.orderId}/${order.totalPrice}` };
}
```

**Test gap:** `tests/integration/api/payment-confirm.test.ts` currently only covers
BAD_JSON / BAD_INPUT (per phase-1 P2-09). No fixture for a forged paymentKey reuse.

**Owner:** backend-dev. **Severity is highest possible:** the entire order
fraud-prevention story rests on Toss-side amount verification.

---

### P0-02 ‚Äî `/api/render/print` SSRF ‚Äî service-role fetches any `photo_url` stored in `order_items`

**File:** `src/lib/render/pipeline.ts:169-189, 258-264`
**Category:** SSRF / Internal-network exposure
**Status:** New (phase-1 had no render API).

**Code today:**
```ts
// pipeline.ts:171
photoBuffer = await fetchAsBuffer(item.photo_url);
// pipeline.ts:258
async function fetchAsBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  ...
}
```

`order_items.photo_url` (migration 009) is a `text NOT NULL` column without a
CHECK constraint. The ingest path is `createOrder` ‚Üí `cartItemSchema.photoUrl`
(`src/types/cart.ts:80`) which **does** enforce `httpsUrl()` (per ADR-016).
However:

1. The schema is enforced only at IO boundaries ‚Äî admins (via service-role) or
   a future API surface could write arbitrary strings.
2. Even within the https constraint, `httpsUrl()` (`src/lib/validation/url.ts`)
   accepts any https host: `https://169.254.169.254/...` (AWS metadata) and
   `https://localhost.cluster.internal/...` (k8s) are valid. Vercel runs Node
   functions in an environment that *does* expose cloud-provider metadata
   endpoints ‚Äî IMDSv2 mitigations don't reach a raw `fetch()`.
3. The route runs at `runtime = 'nodejs'` with `maxDuration = 60`
   (route.ts:30-33), giving ample time to walk an internal HTTP attack surface
   by varying photo_url and reading sharp errors.

**Attack scenario:**
1. Attacker logs in (Phase 1 admin = OK, but any future logged-in writer who
   can upsert `cart_items` qualifies).
2. Attacker crafts a cart item with `photoUrl=https://<vercel-internal-host>/secret`.
3. (Or, if/when `cartItemSchema.photoUrl` validation is bypassed by a malformed
   request that the JS client treats leniently ‚Äî current `httpsUrl()` is regex
   `^https://` only, anything after passes.) `createOrder` snapshots it into
   `order_items.photo_url`.
4. Attacker pays for the order ‚Äî the render pipeline is fired by `enqueuePrintRender`
   (`confirm.ts:71`). The serverless function fetches `https://<internal>/...`.
5. Error messages bubble back via `console.error` in `enqueue.ts:27`, possibly
   leaking response body fragments through Sharp error strings if the response
   isn't an image.

**Fix:**
```ts
// src/lib/security/url-allowlist.ts
const ALLOWED_HOSTS = new Set([
  new URL(envPublic.supabaseUrl()).host, // <project>.supabase.co
  'images.unsplash.com', // landing only, not for photos
]);
export function isAllowedFetchUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.has(u.host);
  } catch { return false; }
}
```
Then in `pipeline.ts:fetchAsBuffer`, throw on `!isAllowedFetchUrl(url)`.
Tighten `httpsUrl()` similarly for ingress (`src/types/cart.ts`).

**Owner:** backend-dev + architect (ADR-016 superseded amendment).

---

### P0-03 ‚Äî `/api/orders` (and `/api/cart`) accept arbitrary `photoUrl` / `previewUrl` from the client; ownership not verified

**File:** `src/app/api/orders/route.ts:29-67`, `src/types/cart.ts:70-86`,
`src/lib/db/order.ts:175-205`
**Category:** Authorization / data integrity
**Status:** New (was masked by P0-01 in phase-1).

`cartItemSchema` validates `photoUrl` shape but **does not** check that the URL
points to a photo owned by the current user/session:

```ts
// types/cart.ts:80
photoUrl: httpsUrl(),
```

In `createOrder` (`src/lib/db/order.ts:175-205`), `photoUrl` and
`cropTransform` from the client are written verbatim into `order_items`. No
join against `photos` to confirm that:
(a) the photo exists,
(b) the photo's `user_id` / `session_id` matches the caller.

**Attack scenario A (steal another user's photo into your order, then download
the 300dpi print):**
1. Alice uploads `photo-Œ±` ‚Üí public URL `https://<sb>/storage/.../Œ±.jpg`.
2. Alice opens her own cart in Bob's browser tab (e.g. shared device);
   browser screenshot or Network panel reveals `photoUrl`.
3. Bob crafts a checkout with `photoUrl = Œ±'s URL`. `createOrder` accepts.
4. After payment, the render pipeline fetches Œ±'s photo, composites a 300dpi
   print, and stores it under `previews/print/<Bob's orderNo>.png` ‚Äî which is
   **also a public bucket URL** (`pipeline.ts:230-232`).
5. Bob receives Alice's photo on a frame, paid for at standard price. Without
   Alice's consent.

**Attack scenario B (cart-snapshot URL substitution for SSRF ‚Äî see P0-02):**
Bob inserts `https://attacker.controlled/innocuous.jpg` as `photoUrl`. Cart
endpoint accepts. Order endpoint accepts. Render pipeline fetches the URL when
PAID, exposing internal HTTP reachability and consuming server resources.

**Fix:**
1. Add `photoId: ProductId` reference (already present in `cartItemSchema`
   line 76) ‚Äî require server to look up the photo by `photoId` and replace the
   client-supplied `photoUrl` with the DB-stored `original_url`. Reject if the
   photo's owner doesn't match the caller's `userId` / `sessionId`.
2. In `createOrder`, snapshot `photoUrl` from `photos.original_url` lookup,
   not from `input.cartItems[i].photoUrl`.

```ts
// pseudo-fix in createOrder
const photoIds = input.cartItems.map(i => i.photoId);
const { data: photoRows } = await supabase
  .from('photos')
  .select('id, user_id, session_id, original_url')
  .in('id', photoIds);
for (const item of input.cartItems) {
  const p = photoRows.find(p => p.id === item.photoId);
  if (!p) throw new CreateOrderError('PHOTO_NOT_FOUND');
  const ownerMatches = (input.userId && p.user_id === input.userId)
    || (sessionId && p.session_id === sessionId);
  if (!ownerMatches) throw new CreateOrderError('PHOTO_FORBIDDEN');
  // use p.original_url, not item.photoUrl
}
```

**Owner:** backend-dev.

---

### P0-04 ‚Äî Service-role key compared with non-constant-time string compare

**File:** `src/app/api/render/print/route.ts:107-114`
**Category:** Crypto / Timing attack on bearer secret
**Status:** New.

```ts
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
```

The intent is right but the implementation has two real problems:
1. `a.length !== b.length` short-circuits ‚Äî an attacker can probe the secret's
   length distinct from its content (~minor signal, ~negligible exploit value,
   but the standard fix is free).
2. JavaScript engines aggressively optimise tight character loops; V8 may
   short-circuit XOR-reduce loops in ways `crypto.timingSafeEqual` would not.

This is exactly the case `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`
exists for, and `signature.ts:20-23` already uses it correctly. The render
route just didn't reuse the helper.

**Why this is P0, not P1:** `SUPABASE_SERVICE_ROLE_KEY` is *the* master key ‚Äî
leaking it bypasses every RLS policy in the system. Any timing leak on the
render endpoint is unacceptable. The fix is one line.

**Fix:**
```ts
import { timingSafeEqual } from 'node:crypto';
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Hash both sides to equal length before comparing so length is hidden.
    const sha = (s: Buffer) => createHash('sha256').update(s).digest();
    return timingSafeEqual(sha(ab), sha(bb));
  }
  return timingSafeEqual(ab, bb);
}
```

**Owner:** backend-dev.

## 3. P1 ‚Äî Fix before next deploy

---

### P1-01 ‚Äî `previews` bucket is public AND `print_file_url` is enumerable by order_no

**File:** `src/lib/render/pipeline.ts:219, 231`
**Category:** Information disclosure / Privacy

```ts
const path = `print/${orderNo}-${item.id}.png`;
const publicUrl = supabase.storage.from(PREVIEWS_BUCKET).getPublicUrl(path).data.publicUrl;
```

`order_no` is `YYYYMMDD-NNNN` ‚Äî sequential daily counter (migration 014). The
filename also includes `item.id` (a UUID) ‚Äî UUID v4 provides 122 bits of
entropy so the full path is unguessable, but: the 300dpi print **contains the
user's intimate photograph**, the file lives in a `public` bucket
(`previews` per migration 003/004 ‚Äî `getPublicUrl` returns a public URL), and
the URL is logged in `console.log` (`pipeline.ts:243-251`) which may end up in
Vercel logs / Sentry. Anyone who sees the URL (log access, support ticket,
share-link screenshot) can pull the high-resolution print indefinitely.

ADR-018 acknowledged the same risk for `photos` bucket. **The same trade-off
must be made explicit for `previews/print/*` (300dpi prints) ‚Äî and the print
quality file is more sensitive than the source photo because it is the
deliverable.** Recommend at minimum:
- Move `previews` to private bucket, gate via signed URL behind admin auth.
- Or rename to `print-files`, separate from preview thumbnails.
- Add ADR-020 documenting the choice.

---

### P1-02 ‚Äî Webhook `handleWebhook` ignores Toss event `createdAt` ‚Äî no replay window

**File:** `src/lib/payment/confirm.ts:87-157`, `src/types/payment.ts:128`

The webhook handler dedups on `payment_key` UNIQUE (good for same paymentKey
replay) but never compares the event's `createdAt` to `now()`. A leaked
webhook secret (P1-01 from phase-1 acknowledges this is "defense in depth")
plus an old captured event lets an attacker re-feed events forever.

**Fix:** reject events with `createdAt` older than ~10 minutes.
```ts
const ageMs = Date.now() - new Date(event.createdAt).getTime();
if (ageMs > 10 * 60_000) {
  console.warn('webhook_too_old', { event });
  return; // accept the HTTP request but no-op
}
```

---

### P1-03 ‚Äî Idempotency race between `/api/payment/confirm` and `/api/webhook/payment`

**File:** `src/lib/payment/confirm.ts:23-79`, `:87-157`

`confirmPayment` transitions `CREATED ‚Üí PAID`; `handleWebhook` independently
also transitions if `TOSS_STATUS_TO_ORDER_STATUS[status] === 'PAID'`. The
dedup keys differ: confirm checks `order.status === 'PAID'` (early-return),
webhook checks `payment_events.payment_key` row presence.

The race:
1. T0: User hits `/payment/success`. Confirm route loads order (status=CREATED).
2. T1: Toss sends webhook. `payment_events` insert succeeds, status was
   CREATED at load time, transitions to PAID.
3. T2: Confirm route reaches `transitionTo(order.id, 'PAID', ...)`. Now the DB
   status is already PAID ‚Äî `canTransition('PAID', 'PAID')` returns false-ish
   (per `state.ts`), but `transitionTo` (`order.ts:236-241`) short-circuits
   only when `currentStatus === target` AFTER a fresh SELECT.
4. Between SELECT (line 225) and UPDATE (line 253), if the webhook handler
   transitions in the same gap, the second update path will run a no-op (idempotent),
   but `enqueuePrintRender` fires **twice** (once from confirm, once from
   webhook). The pipeline has its own idempotency (skip if `print_file_url`
   set) but two simultaneous renders both upload the same path with `upsert:
   true` ‚Äî the second overwrites the first mid-flight, and if both writes
   complete out-of-order with different metadata, the DB row may end up
   pointing to a partial PNG.

**Fix:** an actual lock. Either:
1. Add `payment_events` insert *inside* the same DB transaction that
   transitions order status, and rely on the UNIQUE constraint as the lock.
2. Use Postgres `SELECT ... FOR UPDATE` in `transitionTo` (requires moving to
   `supabase.rpc()` since the JS client can't express `FOR UPDATE`).
3. Make `enqueuePrintRender` deduplicate by `order_item_id` in an in-memory
   set with TTL.

(2) is the proper fix; (3) is a band-aid that survives a single-instance
deployment only.

---

### P1-04 ‚Äî `payment_events.status` CHECK constraint is missing

**File:** `supabase/migrations/010_payment_events.sql:5-13`,
`src/lib/payment/confirm.ts:109-119`

Migration declares `status text NOT NULL` with **no CHECK**. The comment in
`confirm.ts:109` reads:
```
// payment_events.status is constrained to TossPaymentStatus values
```
‚Ä¶which is aspirational ‚Äî there is no DB-side enforcement. If a future code
path inserts a bogus status, the audit trail silently corrupts. **Fix:** add a
CHECK constraint mirroring `TOSS_PAYMENT_STATUSES`.

```sql
ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_status_chk CHECK (status IN
    ('READY','IN_PROGRESS','WAITING_FOR_DEPOSIT','DONE','CANCELED','PARTIAL_CANCELED','ABORTED','EXPIRED'));
```

---

### P1-05 ‚Äî No login rate limiting / brute force protection

**File:** `src/app/login/LoginClient.tsx:41-67`

The login form calls `supabase.auth.signInWithPassword` directly from the
browser. Supabase has internal throttling but it's per IP, not per email ‚Äî
distributed credential stuffing against `yohan73@gmail.com` (publicly known
admin from STATUS.md and seed script) is possible. Combined with seed script's
hardcoded default `\<REDACTED\ 2026\-07\-10\ \‚\Ä\î\ \Í\≥\µ\Í\∞\ú\Î\Ö\∏\Ï\∂\ú\ \Î\∞\ú\Í\≤\¨\,\ \Ì\ö\å\Ï\†\Ñ\ \Ì\ï\Ñ\Ï\à\ò\(\Ï\ò\§\Î\Ñ\à\)\,\ \Ï\ã\§\Í\∞\í\ \Í\∏\∞\Î\°\ù\ \Í\∏\à\Ï\ß\Ä\>` (`scripts/seed-admin-user.sh:23`), this is a
concrete risk if the seed script ran in production without override.

**Recommend:**
- Force admin password rotation off the seed default in deployment runbook.
- Add a server route `/api/auth/login` that proxies to Supabase auth with our
  own per-email rate limit (e.g. 5 attempts / 15 min) and a logged event.
- Consider TOTP for admin accounts (Supabase MFA exists; enable for `role=admin`).

---

### P1-06 ‚Äî `enqueuePrintRender` fires for every order item on `confirmPayment` and webhook with no failure visibility

**File:** `src/lib/payment/confirm.ts:67-72, 149-153`, `src/lib/render/enqueue.ts:25-35`

```ts
queueMicrotask(() => {
  renderOrderItemPrint(orderItemId).catch((err) => {
    console.error(JSON.stringify({ event: 'print_render_failed', ... }));
  });
});
```

The print render is the deliverable. A failure here means the customer paid
but their photo never goes to print. The current visibility is a `console.error`
JSON line ‚Äî no DB row marking the item as failed, no retry, no admin queue, no
alert. If Vercel kills the function before `queueMicrotask` runs (which it
will, since the route already returned), the render is silently lost.

**Fix:**
- Persist a render job row (e.g. `print_render_jobs(id, order_item_id,
  status, last_error, attempts)`).
- Use Vercel Cron or a Supabase Edge Function to poll/retry.
- Admin UI listing failed renders.

Phase-2 docs already mention "queue/Edge Function" ‚Äî this is the formal P1
ticket.

---

### P1-07 ‚Äî Unsplash URLs hard-coded in `landing-curation.ts` ‚Äî third-party CDN dependency in ISR HTML

**File:** `src/data/landing-curation.ts` (whole file), `next.config.ts:33-37`

The landing page renders `images.unsplash.com` URLs into ISR-cached HTML for
**10 minutes per region** (`page.tsx:60`). Risks:
1. Unsplash takedown / hot-link block ‚Üí broken hero, no fallback. The page
   has no try/catch around `<Image>`.
2. Unsplash CDN response is fetched by next/image's optimiser ‚Äî adds an
   outbound request to a third-party host on every cache miss.
3. Content compliance ‚Äî Unsplash license allows commercial use, but specific
   photos may be removed by the photographer. No audit trail.

**Recommend:** mirror Unsplash assets to Supabase Storage (one-time), update
URLs, drop `images.unsplash.com` from `remotePatterns`.

## 4. P2 ‚Äî Tech debt

| ID | File | Issue |
|---|---|---|
| P2-01 | `scripts/seed-admin-user.sh:23-24` | Default password `\<REDACTED\ 2026\-07\-10\ \‚\Ä\î\ \Í\≥\µ\Í\∞\ú\Î\Ö\∏\Ï\∂\ú\ \Î\∞\ú\Í\≤\¨\,\ \Ì\ö\å\Ï\†\Ñ\ \Ì\ï\Ñ\Ï\à\ò\(\Ï\ò\§\Î\Ñ\à\)\,\ \Ï\ã\§\Í\∞\í\ \Í\∏\∞\Î\°\ù\ \Í\∏\à\Ï\ß\Ä\>` and email hardcoded in committed script. Tracked in git history forever. Move to env-only, no default. |
| P2-02 | `src/lib/upload-ratelimit.ts:19` | `Map<string, Bucket>` grows unbounded ‚Äî no TTL eviction. On a long-lived Node instance, attacker can fill memory by rotating `sessionId`s. Add periodic prune. |
| P2-03 | `src/lib/security/same-origin.ts:64-67` | Non-production bypass `if (NODE_ENV !== 'production' && !secFetchSite) return true;` ‚Äî preview deployments run with `NODE_ENV=production` by default on Vercel, so this is fine **only if** preview env confirms it. Worth a deployment-config check. |
| P2-04 | `src/lib/render/print.ts:159-318` | Sharp pipeline allocates ‚â•4 large buffers (photoOut, clippedPhotoLayer, innerCanvas, innerComposite, withBleed). Memory peak for a 4000√ó4000 photo on 11√ó14 print ‚âà 200MB. Vercel Pro Node functions cap at 1GB; OK for now, but flag for load test. |
| P2-05 | `src/lib/render/pipeline.ts:243-251` | `console.log` in production path ‚Äî phase-1 verified 0 `console.log`s; this is a regression. Use `console.warn` or structured logger consistent with rest of codebase. |
| P2-06 | `next.config.ts:33-37` | `hostname: 'images.unsplash.com'` accepts `pathname: '/**'`. If Unsplash ever served HTML at a path (they don't, but their API does at `api.unsplash.com`), this would allow next/image to proxy other Unsplash subpaths. Tighten to `/photo-*`. |
| P2-07 | `src/lib/payment/confirm.ts:35-37` | "Already PAID ‚Üí ok: true" is silently idempotent. Caller can't distinguish "you just paid now" from "you already paid 5 minutes ago"; UX-wise the success screen is identical, but for analytics/funnel telemetry it matters. Return a discriminator. |
| P2-08 | `src/app/(shop)/order/lookup/page.tsx` + `src/lib/db/order.ts:290-298` | `findOrderByGuest(orderNo, phone)`: phone is compared with `===`. Acceptable for now, but no rate limit on `/order/lookup` ‚Äî guest phone enumeration is possible against a known orderNo. Add rate limit + brief lockout. |

## 5. Acknowledged risks / explicit trade-offs

These remain accepted (not findings):
- **ADR-018:** `photos` bucket public ‚Äî explicit; documented Phase 3 hardening plan.
- **ADR-019:** Daily sequential `order_no` (`YYYYMMDD-NNNN`) leaks order
  volume to attackers. Acceptable for a small-volume Phase 1 ecommerce; revisit
  if competitors mine the data.
- **No CSRF token (P2-05 phase-1):** mitigated by `isSameOrigin` (cookies
  SameSite=Lax by default from `@supabase/ssr`). Acceptable for cookie-less
  guest orders. State-changing routes still need origin check; verified
  present on `/api/cart`, `/api/cart/[localId]`, `/api/orders`, `/api/payment/confirm`,
  `/api/photos/upload`. Render API uses bearer auth instead ‚Äî correct.
- **Single-region Vercel deployment:** `upload-ratelimit.ts` is per-process.
  Phase 1 single-region only.

## 6. Comparison to e-commerce standards

| Capability | FrameShop | Shopify/WooCommerce baseline |
|---|---|---|
| Server-side price recompute on order | YES (P0-01 phase-1 fix) | YES |
| Server-side amount verify against PG response | **NO (P0-01 this audit)** | YES (Stripe `payment_intent.amount_received`) |
| Webhook signature timing-safe | YES (`signature.ts:20-23`) | YES |
| Webhook event replay window | **NO (P1-02)** | YES (Stripe rejects > 5 min) |
| Webhook idempotency dedup | YES (`payment_events.payment_key UNIQUE`) | YES |
| Confirm ‚Üî webhook race-free | **NO (P1-03)** | YES (Stripe single source of truth via webhook) |
| Refund flow | **Not implemented** | YES |
| Cart item snapshot frozen at order time | YES (`order.ts:175-205`) | YES |
| Order state machine enforced | YES (`canTransition`) | YES |
| RLS on user data | YES (12 tables) | N/A (different model) |
| Login rate limit / MFA | **NO (P1-05)** | YES (Shopify admin requires MFA) |
| PCI scope | Out-of-scope (Toss tokenizes) | Same |
| Print/deliverable URL access control | **NO (P1-01)** | YES (Shopify private metadata) |
| Photo ownership check on order create | **NO (P0-03)** | N/A (file ownership via uploaded UI session) |
| SSRF guard on outbound fetch | **NO (P0-02)** | YES (Shopify uses image-proxy with allowlist) |
| GDPR / PIPA data deletion endpoint | **Not implemented** | YES |
| Tax receipt / ÏÑ∏Í∏àÍ≥ÑÏÇ∞ÏÑú | **Not implemented** | Plugin/extension |
| Refund policy disclosure on checkout | Hardcoded in FAQ; not at checkout | YES |
| ÌÜµÏã†ÌåêÎß§ÏóÖ Ïã†Í≥† | Not present in Footer | YES (Korean ecommerce legal req'd) |

## 7. Recommended remediation order

1. **P0-01** (Toss response verify) ‚Äî single-file fix, blocks the largest fraud vector.
2. **P0-04** (`timingSafeEqualStr` ‚Üí `crypto.timingSafeEqual`) ‚Äî one-line fix.
3. **P0-03** (photo ownership check in `createOrder`) ‚Äî adds one DB roundtrip,
   eliminates two attack classes (photo theft + SSRF input vector).
4. **P0-02** (URL allowlist for `fetchAsBuffer`) ‚Äî defense-in-depth on top of P0-03.
5. **P1-03** (confirm‚Üîwebhook race) ‚Äî needs schema migration or RPC; design
   sprint required, but the race window today is small enough to ship while
   fix is in flight (operators monitor `print_render_failed` logs).
6. **P1-01** (private `previews` bucket + signed URL) ‚Äî meaningful schema/code
   churn; pair with ADR-020 like ADR-018.
7. **P1-02** (webhook replay window) ‚Äî trivial.
8. **P1-04** (CHECK constraint on payment_events.status) ‚Äî migration only.
9. **P1-05** (login rate limit / MFA) ‚Äî admin team policy + small route.
10. **P1-06** (render job persistence + retry) ‚Äî schedule with Phase 2 work
    that already plans Edge Function migration.
11. **P1-07** (host Unsplash mirrors) ‚Äî design/ops, not urgent security.
12. P2-01 .. P2-08 ‚Äî schedule in next sprint.

**Hard release gate:** P0-01, P0-02, P0-03, P0-04 must close before any
production deploy.
