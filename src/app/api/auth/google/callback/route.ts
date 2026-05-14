/**
 * GET /api/auth/google/callback
 *
 * Google OAuth 콜백 — code를 token으로 교환하여 user_integrations에 저장.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { getSettings } from '@/lib/db/settings';
import { envPublic } from '@/lib/env-public';

export const dynamic = 'force-dynamic';

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // userId or 'anon'
  const errorParam = searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(
      new URL('/account?google_error=' + encodeURIComponent(errorParam), request.url),
    );
  }

  if (!code) {
    return NextResponse.json({ error: 'code 파라미터가 없습니다.' }, { status: 400 });
  }

  // 설정 조회
  const settings = await getSettings(['google_client_id', 'google_client_secret']);
  const clientId = process.env.GOOGLE_CLIENT_ID ?? settings['google_client_id'];
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET ?? settings['google_client_secret'];

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Google OAuth 설정이 불완전합니다.' },
      { status: 400 },
    );
  }

  const siteUrl = envPublic.siteUrl();
  const redirectUri = `${siteUrl}/api/auth/google/callback`;

  // code → token 교환
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error('[google-callback] token exchange failed:', text);
    return NextResponse.redirect(
      new URL('/account?google_error=token_exchange_failed', request.url),
    );
  }

  const tokenData = (await tokenRes.json()) as GoogleTokenResponse;

  // 현재 로그인 사용자 확인
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = user?.id ?? state;
  if (!userId || userId === 'anon') {
    return NextResponse.redirect(
      new URL('/login?redirect=/account', request.url),
    );
  }

  // user_integrations에 저장 (service role — RLS 우회)
  const svcSupabase = getServiceRoleSupabase();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const { error: upsertErr } = await svcSupabase
    .from('user_integrations')
    .upsert(
      {
        user_id: userId,
        provider: 'google_photos',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        expires_at: expiresAt,
      },
      { onConflict: 'user_id,provider' },
    );

  if (upsertErr) {
    console.error('[google-callback] upsert error:', upsertErr.message);
    return NextResponse.redirect(
      new URL('/account?google_error=save_failed', request.url),
    );
  }

  // 성공 — 스튜디오 또는 계정 페이지로 redirect
  return NextResponse.redirect(new URL('/account?google_connected=1', request.url));
}
