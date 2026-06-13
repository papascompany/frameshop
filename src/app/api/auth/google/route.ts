/**
 * GET /api/auth/google
 *
 * Google Photos OAuth 시작 — Authorization URL로 redirect.
 * google_client_id가 미설정이면 400.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getSetting } from '@/lib/db/settings';
import { envPublic } from '@/lib/env-public';

export const dynamic = 'force-dynamic';

/** Name of the httpOnly cookie that carries the OAuth CSRF state token. */
export const GOOGLE_OAUTH_STATE_COOKIE = 'fs_g_oauth_state';

export async function GET(request: NextRequest) {
  // Linking a Google Photos integration mutates THIS user's account, so it
  // requires an authenticated session. (The old flow encoded the user id in the
  // `state` param and trusted it back in the callback — a CSRF / identity-
  // injection hole. Identity now comes only from the session.)
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL('/login?redirect=/account', request.url),
    );
  }

  // Google OAuth Client ID 조회 (env 우선 → DB fallback)
  const clientId =
    process.env.GOOGLE_CLIENT_ID ?? (await getSetting('google_client_id'));

  if (!clientId) {
    return NextResponse.json(
      { error: 'Google OAuth가 설정되지 않았습니다. 어드민 설정을 확인하세요.' },
      { status: 400 },
    );
  }

  // CSRF: random, single-use state echoed by Google and matched against an
  // httpOnly cookie in the callback. Not derived from any guessable value.
  const state = crypto.randomUUID();
  const siteUrl = envPublic.siteUrl();
  const redirectUri = `${siteUrl}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/photoslibrary.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const res = NextResponse.redirect(authUrl);
  res.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // top-level GET redirect back from Google still sends it
    path: '/api/auth/google',
    maxAge: 600, // 10 minutes
  });
  return res;
}
