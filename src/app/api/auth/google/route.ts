/**
 * GET /api/auth/google
 *
 * Google Photos OAuth 시작 — Authorization URL로 redirect.
 * google_client_id가 미설정이면 400.
 */

import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getSetting } from '@/lib/db/settings';
import { envPublic } from '@/lib/env-public';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Google OAuth Client ID 조회 (env 우선 → DB fallback)
  const clientId =
    process.env.GOOGLE_CLIENT_ID ?? (await getSetting('google_client_id'));

  if (!clientId) {
    return NextResponse.json(
      { error: 'Google OAuth가 설정되지 않았습니다. 어드민 설정을 확인하세요.' },
      { status: 400 },
    );
  }

  // 현재 사용자 ID (state에 인코딩)
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const state = user?.id ?? 'anon';
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
  return NextResponse.redirect(authUrl);
}
