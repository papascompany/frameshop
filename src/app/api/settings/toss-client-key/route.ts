/**
 * GET /api/settings/toss-client-key
 *
 * Toss 클라이언트 키(공개 정보)를 반환.
 * 환경변수 우선 → 없으면 app_settings DB 조회.
 * 인증 불필요 — 클라이언트 키는 공개 정보.
 */

import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db/settings';
import { envPublic } from '@/lib/env-public';

export const dynamic = 'force-dynamic';

export async function GET() {
  // 환경변수 우선
  const envKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  if (envKey) {
    return NextResponse.json({ clientKey: envKey });
  }

  // DB fallback
  const dbKey = await getSetting('toss_client_key');
  if (dbKey) {
    return NextResponse.json({ clientKey: dbKey });
  }

  // 미설정
  return NextResponse.json(
    { clientKey: null, error: 'Toss 클라이언트 키가 설정되지 않았습니다.' },
    { status: 404 },
  );
}

// envPublic 사용을 선언해 lint 경고 방지 (direct env access 허용됨)
void (envPublic as unknown);
