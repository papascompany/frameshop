/**
 * 적립금 잔액 + 원장 조회 (FS-EC-01) — /account/points 페이지와
 * /api/account/points 라우트가 공유하는 server-only 로더.
 *
 * 주의(FS-EC-01 §5): `src/lib/db/points.ts` 는 backend-dev 소유(병렬 작업 중)
 * 이라 여기서 만들지도 import 하지도 않는다. 이 로더는 **사용자 JWT 클라이언트
 * (RLS owner-select, migration 031 정책)** 로 본인 데이터만 읽는 조회 전용이며,
 * 통합 단계에서 orchestrator 가 db/points.ts 로 정리할 수 있다.
 *
 * 호출 전제: feature-probe `isPointsAvailable()` true (031 적용됨). 미적용
 * graceful 분기는 호출자(page/route)가 담당한다.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import { pointsTransactionTypeSchema } from '@/types/points';
import type { OrderId, UserId } from '@/types/common';
import type { PointsLedgerEntry } from '@/types/points';
import type { getServerSupabase } from '@/lib/supabase/server';

type ServerSupabase = Awaited<ReturnType<typeof getServerSupabase>>;

/** user_points_ledger 명시 컬럼 select 결과 행(snake_case). */
type LedgerRow = {
  id: string;
  user_id: string;
  order_id: string | null;
  transaction_type: string;
  points_delta: number;
  balance_after: number;
  description: string | null;
  created_at: string;
};

const LEDGER_COLUMNS =
  'id, user_id, order_id, transaction_type, points_delta, balance_after, description, created_at';

/** 마이페이지/체크아웃 표시용 — 최근 원장 표시 개수. */
export const LEDGER_PAGE_SIZE = 20;

function mapLedgerRow(row: LedgerRow): PointsLedgerEntry {
  return {
    id: row.id,
    userId: asBrand<UserId>(row.user_id),
    orderId: row.order_id === null ? null : asBrand<OrderId>(row.order_id),
    // DB CHECK 와 동일 집합 — 런타임 검증으로 캐스트 없이 좁힌다.
    transactionType: pointsTransactionTypeSchema.parse(row.transaction_type),
    pointsDelta: row.points_delta,
    balanceAfter: row.balance_after,
    description: row.description,
    createdAt: row.created_at,
  };
}

export type PointsData = {
  balance: number;
  ledger: PointsLedgerEntry[];
};

/**
 * 잔액(user_profiles.points_balance) + 최근 원장 20건.
 * 프로필 행이 아직 없는 사용자는 잔액 0 (첫 적립 시 RPC 가 upsert).
 */
export async function loadPointsData(
  supabase: ServerSupabase,
  userId: string,
): Promise<PointsData> {
  const profileQuery = supabase
    .from('user_profiles')
    .select('points_balance')
    .eq('user_id', userId)
    .maybeSingle();
  const ledgerQuery = supabase
    .from('user_points_ledger')
    .select(LEDGER_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(LEDGER_PAGE_SIZE);

  const [profileRes, ledgerRes] = await Promise.all([profileQuery, ledgerQuery]);

  if (profileRes.error) {
    throw new Error(`loadPointsData(profile): ${profileRes.error.message}`);
  }
  if (ledgerRes.error) {
    throw new Error(`loadPointsData(ledger): ${ledgerRes.error.message}`);
  }

  const profile = (profileRes.data ?? null) as { points_balance: number } | null;
  const rows = (ledgerRes.data ?? []) as LedgerRow[];

  return {
    balance: profile?.points_balance ?? 0,
    ledger: rows.map(mapLedgerRow),
  };
}
