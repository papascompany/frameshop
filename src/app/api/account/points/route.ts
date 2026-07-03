/**
 * /api/account/points — 회원 적립금 잔액 + 최근 원장 (FS-EC-01).
 *  GET → { ok, available, balance, ledger }
 *
 * graceful 계약(FS-EC-01 §4):
 *  - 비로그인 → 401 UNAUTHENTICATED (주소록 라우트와 동일 — 체크아웃의 게스트
 *    fetch 는 !res.ok 로 조용히 섹션을 숨긴다).
 *  - migration 031 미적용(isPointsAvailable false) →
 *    200 { ok:true, available:false, balance:0, ledger:[] } — 클라는 available
 *    false 면 섹션을 렌더하지 않는다. 이때 스키마 쿼리는 아예 실행하지 않는다.
 *
 * 조회는 사용자 JWT 클라이언트(RLS owner-select) — 세션 사용자 본인 데이터만
 * 읽는다. 읽기 전용 GET 이므로 same-origin/rate-limit 게이트는 두지 않는다
 * (주소록 GET 과 동일 수준).
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { isPointsAvailable } from '@/lib/db/feature-probe';
import { getServerSupabase } from '@/lib/supabase/server';
import { loadPointsData } from '@/app/(shop)/account/points/points-data';

export async function GET(): Promise<Response> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  const available = await isPointsAvailable().catch(() => false);
  if (!available) {
    return NextResponse.json({
      ok: true,
      available: false,
      balance: 0,
      ledger: [],
    });
  }

  try {
    const { balance, ledger } = await loadPointsData(supabase, data.user.id);
    return NextResponse.json({ ok: true, available: true, balance, ledger });
  } catch {
    return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 });
  }
}
