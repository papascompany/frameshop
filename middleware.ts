/**
 * Edge middleware: refreshes the Supabase session + guards /admin routes
 * + auto-issues guest session cookie (fs-guest-sid) for anonymous users.
 *
 * Performance optimisation (2025-05):
 *   - supabase.auth.getUser() is ONLY called for /admin/* and /api/admin/*
 *     paths. All other routes skip the Supabase network round-trip entirely
 *     (~100-200 ms saved per request on non-admin paths).
 *   - Guest session cookie is issued based on the absence of an 'sb-*'
 *     auth cookie instead of an explicit getUser() call.
 *
 * For /admin/* and /api/admin/*, requires a Supabase session whose
 * `app_metadata.role` is 'admin'. Anything else 302→/login or 403.
 *
 * Guest session cookie:
 * - Name: fs-guest-sid
 * - Issued to unauthenticated users visiting checkout/studio/api routes.
 * - 1-year MaxAge, SameSite=Lax, HttpOnly, Secure (in production).
 * - Used as sessionId for photo uploads and anonymous order ownership.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Routes that require a guest session ID when the user is not logged in. */
const GUEST_SESSION_PATHS = [
  '/checkout',
  '/studio',
  '/api/orders',
  '/api/photos',
];

const GUEST_COOKIE_NAME = 'fs-guest-sid';
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds

function needsGuestSession(pathname: string): boolean {
  return GUEST_SESSION_PATHS.some((p) => pathname.startsWith(p));
}

/** True when the request carries a Supabase auth cookie (logged-in user). */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith('sb-'));
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  const isAdminRoute =
    path.startsWith('/admin') || path.startsWith('/api/admin');

  // ── Admin routes: full Supabase session verification ──────────────────
  if (isAdminRoute) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // If env isn't ready yet (e.g. preview without Supabase), pass through.
    if (!supabaseUrl || !supabaseAnon) {
      return NextResponse.next();
    }

    // We need to mutate request headers so the verified identity is visible
    // to downstream Server Components (avoids a second `getUser()` RTT in
    // each page's `requireAdmin()` call — ~100-300 ms saved per navigation).
    const forwardedHeaders = new Headers(request.headers);
    const response = NextResponse.next({
      request: { headers: forwardedHeaders },
    });

    const supabase = createServerClient(supabaseUrl, supabaseAnon, {
      cookies: {
        getAll() {
          return request.cookies.getAll().map((c) => ({
            name: c.name,
            value: c.value,
          }));
        },
        setAll(toSet) {
          for (const { name, value, options } of toSet) {
            response.cookies.set({ name, value, ...options });
          }
        },
      },
    });

    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirect', path);
      return NextResponse.redirect(url);
    }

    const role =
      (user.app_metadata as { role?: string } | null)?.role ?? null;
    if (role !== 'admin') {
      return new NextResponse('Forbidden', { status: 403 });
    }

    // Forward verified identity to Server Components via request headers.
    // `requireAdmin()` reads these and skips its own auth.getUser() call.
    forwardedHeaders.set('x-fs-admin-user-id', user.id);
    forwardedHeaders.set('x-fs-admin-email', user.email ?? '');
    forwardedHeaders.set('x-fs-admin-role', 'admin');

    return response;
  }

  const response = NextResponse.next();

  // ── Non-admin routes: no Supabase network call ─────────────────────────
  // Auto-issue guest session cookie for unauthenticated users on relevant routes.
  // Use cookie presence heuristic instead of getUser() to avoid the RTT.
  if (needsGuestSession(path)) {
    const existingCookie = request.cookies.get(GUEST_COOKIE_NAME);
    if (!existingCookie && !hasAuthCookie(request)) {
      const guestSid = crypto.randomUUID();
      const isProduction = process.env.NODE_ENV === 'production';
      response.cookies.set({
        name: GUEST_COOKIE_NAME,
        value: guestSid,
        maxAge: GUEST_COOKIE_MAX_AGE,
        sameSite: 'lax',
        httpOnly: true,
        secure: isProduction,
        path: '/',
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Skip Next internal files and static images.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)',
  ],
};
