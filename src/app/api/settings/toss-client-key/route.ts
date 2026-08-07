/**
 * GET /api/settings/toss-client-key
 *
 * Toss 클라이언트 키(공개 정보)를 반환.
 * 실값 환경변수 우선 → placeholder/미설정이면 app_settings DB 조회
 * (getEffectiveTossClientKey 단일 경로 — 체크아웃 RSC 와 동일한 해석).
 * 인증 불필요 — 클라이언트 키는 공개 정보.
 */

import { NextResponse } from 'next/server';
import { getEffectiveTossClientKey } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const clientKey = await getEffectiveTossClientKey().catch(() => null);
  if (clientKey) {
    return NextResponse.json({ clientKey });
  }
  return NextResponse.json(
    { clientKey: null, error: 'Toss 클라이언트 키가 설정되지 않았습니다.' },
    { status: 404 },
  );
}
