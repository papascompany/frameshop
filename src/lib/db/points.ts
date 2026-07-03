/**
 * Reward points IO (FS-EC-02) — migration 031 RPC wrapper + probe-graceful reads.
 *
 * Money path. All balance mutations go through the SECURITY DEFINER RPC
 * `apply_points_transaction` (service-role only): it updates
 * `user_profiles.points_balance` and appends to the immutable
 * `user_points_ledger` atomically. Its `CHECK (points_balance >= 0)` is the
 * DB-level double-spend guard — an overdraw aborts the whole transaction and
 * surfaces here as an RPC error value.
 *
 * Errors are values across this module boundary (never thrown), and every
 * entry point degrades gracefully when migration 031 is not applied yet
 * (feature-probe `isPointsAvailable()`).
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { OrderId, UserId } from '@/types/common';
import {
  calcEarnPoints,
  type PointsLedgerEntry,
  type PointsSummary,
  type PointsTransactionType,
} from '@/types/points';
import { isPointsAvailable } from './feature-probe';
import { getServiceRoleSupabase } from '../supabase/service';

// ---------- Result values ----------

export type PointsTxResult =
  | { ok: true; balance: number }
  | { ok: false; error: string };

export type PointsAccrualResult = {
  ok: boolean;
  /** 이번 호출로 적립된 포인트. 멱등 skip / 기능 부재 / 0원 적립이면 0. */
  accrued: number;
  error?: string;
};

export type PointsReversalResult = {
  ok: boolean;
  /** 이번 호출로 복원된 사용 적립금(ADJUSTMENT +). 멱등 skip / 0 이면 0. */
  restored: number;
  /** 이번 호출로 회수된 적립 포인트(REFUND −). 멱등 skip / 0 이면 0. */
  reclaimed: number;
  error?: string;
};

// ---------- Ledger row mapping (local — mappers.ts is FROZEN) ----------

type LedgerRow = {
  id: string;
  user_id: string;
  order_id: string | null;
  /** DB CHECK guarantees one of POINTS_TRANSACTION_TYPES. */
  transaction_type: string;
  points_delta: number;
  balance_after: number;
  description: string | null;
  created_at: string;
};

function mapLedgerRow(row: LedgerRow): PointsLedgerEntry {
  return {
    id: row.id,
    userId: asBrand<UserId>(row.user_id),
    orderId: row.order_id ? asBrand<OrderId>(row.order_id) : null,
    transactionType: row.transaction_type as PointsTransactionType,
    pointsDelta: row.points_delta,
    balanceAfter: row.balance_after,
    description: row.description,
    createdAt: row.created_at,
  };
}

// ---------- RPC wrapper ----------

async function applyPointsTransaction(
  userId: UserId,
  orderId: OrderId | null,
  type: PointsTransactionType,
  delta: number,
  description: string,
): Promise<PointsTxResult> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase.rpc('apply_points_transaction', {
    p_user_id: userId as string,
    p_order_id: (orderId ?? null) as string | null,
    p_type: type,
    p_delta: delta,
    p_description: description,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  if (typeof data !== 'number') {
    return {
      ok: false,
      error: 'apply_points_transaction returned non-numeric balance',
    };
  }
  return { ok: true, balance: data };
}

// ---------- Reads (probe-graceful) ----------

/**
 * 체크아웃/마이페이지용 잔액 요약. 031 미적용이거나 잔액 조회가 실패하면
 * `available: false` — createOrder 는 이를 POINTS_UNAVAILABLE 로 fail-close
 * 하므로, 조회 실패가 조용한 전액결제로 이어지지 않는다.
 */
export async function getPointsSummary(userId: UserId): Promise<PointsSummary> {
  if (!(await isPointsAvailable())) {
    return { balance: 0, available: false };
  }
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('points_balance')
    .eq('user_id', userId as string)
    .maybeSingle();
  if (error) {
    console.error(
      JSON.stringify({ event: 'points_summary_failed', error: error.message }),
    );
    return { balance: 0, available: false };
  }
  // No profile row yet = never earned/redeemed → balance 0 but feature works.
  const balance =
    (data as { points_balance?: number | null } | null)?.points_balance ?? 0;
  return { balance, available: true };
}

/** 최근 원장 내역 (마이페이지). 031 미적용/오류 시 빈 배열. */
export async function getPointsLedger(
  userId: UserId,
  limit = 20,
): Promise<PointsLedgerEntry[]> {
  if (!(await isPointsAvailable())) return [];
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('user_points_ledger')
    .select(
      'id, user_id, order_id, transaction_type, points_delta, balance_after, description, created_at',
    )
    .eq('user_id', userId as string)
    .order('created_at', { ascending: false })
    .limit(Math.min(100, Math.max(1, Math.floor(limit))));
  if (error) {
    console.error(
      JSON.stringify({ event: 'points_ledger_failed', error: error.message }),
    );
    return [];
  }
  return ((data ?? []) as LedgerRow[]).map(mapLedgerRow);
}

// ---------- Mutations ----------

/**
 * 주문 생성 시 적립금 차감 (REDEMPTION, delta = -amount).
 *
 * `orderId` 는 null 허용 — createOrder 는 주문 INSERT **직전**에 차감하므로
 * 그 시점엔 orders.id 가 아직 없다(orderNo 를 description 에 담아 연결).
 * 초과 차감은 RPC 의 CHECK 가 원자적으로 거부한다.
 */
export async function redeemPoints(
  userId: UserId,
  orderId: OrderId | null,
  amount: number,
  description = '적립금 사용',
): Promise<PointsTxResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: `invalid redeem amount: ${amount}` };
  }
  if (!(await isPointsAvailable())) {
    return { ok: false, error: 'points feature unavailable (migration 031)' };
  }
  return applyPointsTransaction(userId, orderId, 'REDEMPTION', -amount, description);
}

/**
 * 보상 트랜잭션: 차감 후 주문 생성이 실패했을 때 포인트를 되돌린다
 * (ADJUSTMENT, delta = +amount). 호출자는 실패 시 구조화 로그를 남겨야 한다.
 */
export async function refundRedeemedPoints(
  userId: UserId,
  orderId: OrderId | null,
  amount: number,
  description = '주문 생성 실패 환급',
): Promise<PointsTxResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: `invalid refund amount: ${amount}` };
  }
  if (!(await isPointsAvailable())) {
    return { ok: false, error: 'points feature unavailable (migration 031)' };
  }
  return applyPointsTransaction(userId, orderId, 'ADJUSTMENT', amount, description);
}

/**
 * 구매확정 시 1% 적립 (ACCRUAL). **멱등** — 원장에 이 주문의 ACCRUAL 이 이미
 * 있으면 재적립하지 않는다(031 주석의 idempotency 계약). 멱등 체크 자체가
 * 실패하면 적립하지 않고 실패를 돌려준다(늦은 적립은 보정 가능, 이중 적립은
 * 회수가 어렵다 — fail closed).
 */
export async function accruePointsForOrder(
  orderId: OrderId,
  userId: UserId,
  totalPrice: number,
): Promise<PointsAccrualResult> {
  if (!(await isPointsAvailable())) return { ok: true, accrued: 0 };

  // totalPrice is already net of redeemed points (031) — no earn on points spend.
  const earn = calcEarnPoints(totalPrice);
  if (earn <= 0) return { ok: true, accrued: 0 };

  const supabase = getServiceRoleSupabase();

  const { data: existing, error: exErr } = await supabase
    .from('user_points_ledger')
    .select('id')
    .eq('order_id', orderId as string)
    .eq('transaction_type', 'ACCRUAL')
    .limit(1);
  if (exErr) {
    return { ok: false, accrued: 0, error: exErr.message };
  }
  if ((existing ?? []).length > 0) {
    return { ok: true, accrued: 0 };
  }

  const tx = await applyPointsTransaction(
    userId,
    orderId,
    'ACCRUAL',
    earn,
    '구매확정 적립 (결제액의 1%)',
  );
  if (!tx.ok) {
    return { ok: false, accrued: 0, error: tx.error };
  }

  // Snapshot for refund reversal (orders.points_accrued). isPointsAvailable()
  // implies migration 031 created this column too; still non-fatal on failure —
  // the ledger row above remains the authority.
  const { error: updErr } = await supabase
    .from('orders')
    .update({ points_accrued: earn })
    .eq('id', orderId as string);
  if (updErr) {
    console.error(
      JSON.stringify({
        event: 'points_accrued_snapshot_failed',
        orderId,
        earn,
        error: updErr.message,
      }),
    );
  }

  return { ok: true, accrued: earn };
}

/** 이 주문의 원장에 (order_id, transaction_type) 행이 이미 있는지 조회. */
async function hasLedgerEntry(
  supabase: ReturnType<typeof getServiceRoleSupabase>,
  orderId: OrderId,
  type: PointsTransactionType,
): Promise<{ exists: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('user_points_ledger')
    .select('id')
    .eq('order_id', orderId as string)
    .eq('transaction_type', type)
    .limit(1);
  if (error) {
    return { exists: false, error: error.message };
  }
  return { exists: (data ?? []).length > 0 };
}

/**
 * 취소/환불 원장 정합 (FS-EC P1-1) — 주문이 CANCELLED 또는 REFUNDED(부분환불
 * 누적이 전액에 도달한 전이 포함)로 전이 **성공한 후**에만 호출한다.
 *
 *  (a) redeemed > 0 → 사용분 복원: ADJUSTMENT +redeemed
 *  (b) accrued  > 0 → 적립분 회수: REFUND −accrued
 *
 * 두 다리 모두 (order_id, transaction_type) 원장 존재 여부로 **멱등** — 재시도/
 * 중복 호출이 이중 복원·이중 회수로 이어지지 않는다. 멱등 체크 자체가 실패하면
 * 해당 다리는 적용하지 않는다(fail closed — 늦은 보정이 이중 지급보다 낫다).
 * 회수는 고객이 이미 포인트를 써버려 잔액이 부족하면 RPC 의 CHECK 로 실패할 수
 * 있다 — 이때 주문 흐름을 되돌리지 않고 구조화 로그(points_reversal_failed)로
 * 남긴다(은폐 금지, 운영 수동 보정 대상). 031 미적용이면 전부 skip.
 *
 * fire-and-forget 호출용 — 이 함수는 절대 throw 하지 않는다.
 */
export async function reversePointsForOrder(
  orderId: OrderId,
  userId: UserId,
  amounts: { redeemed: number; accrued: number },
): Promise<PointsReversalResult> {
  try {
    const redeemed =
      Number.isInteger(amounts.redeemed) && amounts.redeemed > 0
        ? amounts.redeemed
        : 0;
    const accrued =
      Number.isInteger(amounts.accrued) && amounts.accrued > 0
        ? amounts.accrued
        : 0;
    if (redeemed === 0 && accrued === 0) {
      return { ok: true, restored: 0, reclaimed: 0 };
    }
    if (!(await isPointsAvailable())) {
      return { ok: true, restored: 0, reclaimed: 0 };
    }

    const supabase = getServiceRoleSupabase();
    const errors: string[] = [];
    let restored = 0;
    let reclaimed = 0;

    if (redeemed > 0) {
      const dup = await hasLedgerEntry(supabase, orderId, 'ADJUSTMENT');
      if (dup.error) {
        errors.push(`restore idempotency check: ${dup.error}`);
      } else if (!dup.exists) {
        const tx = await applyPointsTransaction(
          userId,
          orderId,
          'ADJUSTMENT',
          redeemed,
          '주문 취소/환불 — 사용 적립금 복원',
        );
        if (tx.ok) {
          restored = redeemed;
        } else {
          errors.push(`restore: ${tx.error}`);
        }
      }
    }

    if (accrued > 0) {
      const dup = await hasLedgerEntry(supabase, orderId, 'REFUND');
      if (dup.error) {
        errors.push(`reclaim idempotency check: ${dup.error}`);
      } else if (!dup.exists) {
        const tx = await applyPointsTransaction(
          userId,
          orderId,
          'REFUND',
          -accrued,
          '주문 환불 — 적립 회수',
        );
        if (tx.ok) {
          reclaimed = accrued;
        } else {
          // 잔액 부족(CHECK) 포함 — 로그 후 계속. 주 흐름(환불)은 이미 완료.
          errors.push(`reclaim: ${tx.error}`);
        }
      }
    }

    if (errors.length > 0) {
      console.error(
        JSON.stringify({
          event: 'points_reversal_failed',
          orderId,
          userId,
          redeemed,
          accrued,
          restored,
          reclaimed,
          error: errors.join('; '),
        }),
      );
      return { ok: false, restored, reclaimed, error: errors.join('; ') };
    }
    return { ok: true, restored, reclaimed };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'points_reversal_failed',
        orderId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      ok: false,
      restored: 0,
      reclaimed: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
