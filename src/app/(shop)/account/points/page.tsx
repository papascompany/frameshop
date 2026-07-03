import { redirect } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { getServerSupabase } from '@/lib/supabase/server';
import { isPointsAvailable } from '@/lib/db/feature-probe';
import type { PointsLedgerEntry } from '@/types/points';
import { loadPointsData } from './points-data';
import { PointsClient } from './PointsClient';

export const dynamic = 'force-dynamic';

/**
 * 적립금 페이지 (FS-EC-01).
 * graceful: migration 031 미적용(probe false)이면 스키마 쿼리 없이 안내만
 * 렌더 — 페이지가 죽지 않는다(주소록 페이지의 032 폴백과 동일 원칙).
 */
export default async function PointsPage() {
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login?redirect=/account/points');
  }

  const available = await isPointsAvailable().catch(() => false);

  let balance = 0;
  let ledger: PointsLedgerEntry[] = [];
  if (available) {
    try {
      const data = await loadPointsData(supabase, userData.user.id);
      balance = data.balance;
      ledger = data.ledger;
    } catch (err) {
      // probe true 인데 조회 실패(일시 오류) — 빈 상태로 폴백해 페이지 유지.
      console.warn('points data fetch failed:', err);
    }
  }

  return (
    <Container size="md" className="py-10">
      <h1 className="text-xl font-bold mb-6">적립금</h1>
      <PointsClient available={available} balance={balance} ledger={ledger} />
    </Container>
  );
}
