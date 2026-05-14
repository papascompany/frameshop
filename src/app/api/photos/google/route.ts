/**
 * GET /api/photos/google
 *
 * 인증된 사용자의 Google Photos 목록 반환 (최대 50건).
 * access_token은 user_integrations에서 조회.
 */

import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceRoleSupabase } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type GoogleMediaItem = {
  id: string;
  baseUrl: string;
  filename: string;
  mediaMetadata: {
    width: string;
    height: string;
    photo?: Record<string, unknown>;
  };
};

type GooglePhotosResponse = {
  mediaItems?: GoogleMediaItem[];
  nextPageToken?: string;
};

export async function GET() {
  // 현재 사용자 확인
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // 토큰 조회
  const svcSupabase = getServiceRoleSupabase();
  const { data: integration, error: intErr } = await svcSupabase
    .from('user_integrations')
    .select('access_token, expires_at')
    .eq('user_id', user.id)
    .eq('provider', 'google_photos')
    .maybeSingle();

  if (intErr || !integration) {
    return NextResponse.json(
      { error: 'Google Photos가 연결되지 않았습니다.' },
      { status: 404 },
    );
  }

  // 토큰 만료 체크 (refresh는 별도 구현 필요 — 여기선 expired 안내만)
  if (
    integration.expires_at &&
    new Date(integration.expires_at as string) < new Date()
  ) {
    return NextResponse.json(
      { error: 'Google 연결이 만료되었습니다. 다시 연결해주세요.', expired: true },
      { status: 401 },
    );
  }

  // Google Photos API 호출
  const photosRes = await fetch(
    'https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=50',
    {
      headers: {
        Authorization: `Bearer ${integration.access_token as string}`,
      },
    },
  );

  if (!photosRes.ok) {
    const text = await photosRes.text().catch(() => '');
    console.error('[google-photos] API error:', photosRes.status, text);
    return NextResponse.json(
      { error: 'Google Photos API 호출 실패.' },
      { status: 502 },
    );
  }

  const data = (await photosRes.json()) as GooglePhotosResponse;
  return NextResponse.json({ items: data.mediaItems ?? [] });
}
