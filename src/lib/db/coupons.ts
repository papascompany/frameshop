/**
 * coupons / coupon_redemptions 데이터 접근 (FS-X-01, migration 042, ADR-026).
 *
 * Server-only. Uses the service-role client, which BYPASSES RLS — coupons has
 * NO select policy by design (코드 열거 방지), so every read/write MUST go
 * through this module and never through a user-scoped client.
 *
 * 금전 경로 원자성(ADR-026 §4~6):
 * - 전체 한도(usage_limit)는 조건부 UPDATE 원자 차감이 SSOT 다. PostgREST 는
 *   `used_count = used_count + 1` 같은 컬럼 상대 갱신을 표현할 수 없으므로,
 *   같은 시맨틱을 CAS(compare-and-swap: 읽은 used_count 를 WHERE 에 고정)로
 *   구현한다 — 경합 시 0행이면 재시도, 재시도가 소진되면 사용을 거부한다.
 *   어떤 경합 순서에서도 used_count 가 usage_limit 을 넘을 수 없다(안전 방향).
 * - 회원 1인 1회는 coupon_redemptions UNIQUE(coupon_id, user_id)가 원자 근거.
 *   INSERT 23505 = COUPON_ALREADY_USED — 이때 방금 올린 used_count 를 즉시
 *   되돌린다(redemption 행은 경쟁 요청의 것이므로 절대 지우지 않는다).
 * - 사용은 주문에 묶인다(보안 검토 P1-3, migration 045): 소비는 원장 행에 그
 *   주문(order_id, 045 이후 order_no)을 남기고, 복원(releaseCouponByOrder)은
 *   **그 주문이 남긴 행이 있을 때만** 행 삭제 + used_count −1 한다. never-throws —
 *   취소/환불 흐름을 막지 않고 구조화 로그만 남긴다(points 보상 패턴 미러).
 * - 회원은 쿠폰당 진행 중 주문 1건(045 orders 부분 UNIQUE). validateCoupon 은 결제완료
 *   계열 주문을 거부하고, checkCouponPayable 은 Toss 승인 직전에 다시 확인한다.
 */

import 'server-only';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { asBrand } from '@/types/common';
import type { CouponId, OrderId, OrderNo, UserId } from '@/types/common';
import type {
  Coupon,
  CouponErrorCode,
  CouponInput,
  CouponType,
  CouponValidationResult,
} from '@/types/coupon';
import { ORDER_STATUSES, type OrderStatus } from '@/types/order';
import { calcCouponDiscount, normalizeCouponCode } from '@/lib/coupon/calc';
import { isCouponOrderLedgerAvailable } from './feature-probe';

// ---------- row shape + mapper ----------

type CouponRow = {
  id: string;
  code: string;
  type: string;
  value: number;
  min_subtotal: number;
  expires_at: string | null;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
  created_at: string;
};

const COUPON_COLUMNS =
  'id, code, type, value, min_subtotal, expires_at, usage_limit, used_count, is_active, created_at';

function mapCoupon(row: CouponRow): Coupon {
  return {
    id: asBrand<CouponId>(row.id),
    code: row.code,
    type: row.type as CouponType,
    value: row.value,
    minSubtotal: row.min_subtotal ?? 0,
    expiresAt: row.expires_at,
    usageLimit: row.usage_limit,
    usedCount: row.used_count ?? 0,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

// ---------- result tuple (addresses.ts 선례) ----------

type DbResult<T> = { data: T; error: null } | { data: null; error: string };

/** consumeCoupon 결과 — 실패는 반드시 계약 에러코드로 판별 가능해야 한다. */
export type ConsumeCouponResult =
  | { ok: true }
  | { ok: false; errorCode: CouponErrorCode; error: string };

/** CAS 재시도 상한 — 초과 사용은 구조적으로 불가하므로 실패는 항상 안전 방향. */
const CAS_MAX_ATTEMPTS = 5;

// ---------- 진행 중 주문(쿠폰 점유) — 보안 검토 P1-3 ----------

/**
 * 쿠폰을 점유하는 진행 중 주문 상태 — CANCELLED/REFUNDED 가 아닌 전부. migration 045
 * `uniq_orders_active_coupon_per_user` 의 WHERE(status NOT IN ('CANCELLED','REFUNDED'))와
 * 같은 계약이다. 취소·환불로 전이하면 점유가 풀려 같은 쿠폰으로 다시 주문할 수 있다.
 */
export const ACTIVE_COUPON_ORDER_STATUSES: readonly OrderStatus[] =
  ORDER_STATUSES.filter((s) => s !== 'CANCELLED' && s !== 'REFUNDED');

export type ActiveCouponOrder = {
  id: OrderId;
  orderNo: OrderNo;
  status: OrderStatus;
};

/**
 * 이 회원이 이 쿠폰 코드(주문 스냅샷 orders.coupon_code)로 갖고 있는 진행 중 주문.
 * validateCoupon(결제완료 계열 거부)·createOrder(미결제 주문 대체)·confirm 직전 확인·
 * 복원의 레거시 판정이 같은 정의를 쓴다.
 */
export async function listActiveCouponOrders(
  userId: UserId,
  code: string,
): Promise<DbResult<ActiveCouponOrder[]>> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_no, status')
    .eq('user_id', userId as string)
    .eq('coupon_code', normalizeCouponCode(code))
    .in('status', [...ACTIVE_COUPON_ORDER_STATUSES]);
  if (error) return { data: null, error: error.message };
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    order_no: string;
    status: string;
  }>;
  return {
    data: rows.map((r) => ({
      id: asBrand<OrderId>(r.id),
      orderNo: asBrand<OrderNo>(r.order_no),
      status: r.status as OrderStatus,
    })),
    error: null,
  };
}

/** 이 주문이 남긴 사용 기록(원장 행)이 있는가 — 소비 멱등·복원 판정의 근거. */
async function findRedemptionByOrder(
  couponId: CouponId,
  orderId: OrderId,
): Promise<{ found: boolean; error: string | null }> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('coupon_redemptions')
    .select('id')
    .eq('coupon_id', couponId as string)
    .eq('order_id', orderId as string)
    .maybeSingle();
  if (error) return { found: false, error: error.message };
  return { found: data != null, error: null };
}

// ---------- validateCoupon ----------

/**
 * 쿠폰 검증(읽기 전용 — 어떤 상태도 바꾸지 않는다). /api/coupons/validate 와
 * createOrder 가 같은 함수를 사용해 표시/청구 판정이 일치한다.
 *
 * 코드 열거 방지: 부재/비활성/만료/최소금액 미달은 전부 COUPON_INVALID 단일
 * 표현으로 수렴한다(존재 여부를 구분해 주지 않는다). DB 오류도 fail-closed 로
 * COUPON_INVALID — 할인 0 은 항상 안전하고, 원인은 구조화 로그로 남긴다.
 *
 * @param payable 쿠폰 차감 전 결제예정액(subtotal + shipping + surcharge) —
 *   할인 상한(음수 방지). 검증 시점의 확정 할인액을 결과에 담아 돌려준다.
 */
export async function validateCoupon(
  code: string,
  subtotal: number,
  payable: number,
  userId: UserId | null,
): Promise<CouponValidationResult> {
  const normalized = normalizeCouponCode(code);
  if (normalized.length === 0) {
    return { valid: false, errorCode: 'COUPON_INVALID' };
  }

  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('coupons')
    .select(COUPON_COLUMNS)
    .eq('code', normalized)
    .maybeSingle();

  if (error) {
    console.error(
      JSON.stringify({ event: 'coupon_validate_db_error', error: error.message }),
    );
    return { valid: false, errorCode: 'COUPON_INVALID' };
  }
  if (!data) {
    return { valid: false, errorCode: 'COUPON_INVALID' };
  }

  const coupon = mapCoupon(data as unknown as CouponRow);
  if (!coupon.isActive) {
    return { valid: false, errorCode: 'COUPON_INVALID' };
  }
  if (coupon.expiresAt != null && Date.parse(coupon.expiresAt) <= Date.now()) {
    return { valid: false, errorCode: 'COUPON_INVALID' };
  }
  if (subtotal < coupon.minSubtotal) {
    return { valid: false, errorCode: 'COUPON_INVALID' };
  }
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, errorCode: 'COUPON_EXHAUSTED' };
  }

  // 회원 1인 1회 — 기사용 여부 사전 판정. 실제 원자 근거는 consumeCoupon 의
  // UNIQUE INSERT 이고, 여기는 UX 용 조기 거부다(경합 창은 consume 이 닫는다).
  if (userId != null) {
    const { data: redemption, error: rErr } = await supabase
      .from('coupon_redemptions')
      .select('id')
      .eq('coupon_id', coupon.id as string)
      .eq('user_id', userId as string)
      .maybeSingle();
    if (rErr) {
      console.error(
        JSON.stringify({
          event: 'coupon_redemption_check_db_error',
          error: rErr.message,
        }),
      );
      return { valid: false, errorCode: 'COUPON_INVALID' };
    }
    if (redemption) {
      return { valid: false, errorCode: 'COUPON_ALREADY_USED' };
    }

    // 보안 검토 P1-3: 소비는 결제 확정(PAID) 때 일어나고 실패해도 결제를 막지 않으므로
    // (fail-open), redemptions 만 보면 "결제됐지만 소비에 실패한" 주문을 놓친다. 이 쿠폰을
    // 단 결제완료 계열(PAID 이후) 주문이 이미 있으면 사용한 것으로 본다.
    // 미결제(CREATED) 주문은 여기서 거부하지 않는다 — 결제창을 닫고 다시 결제하면 매번 새
    // 주문이 생기므로(/payment/fail → /checkout), 거부하면 스윕 만료(24h)까지 쿠폰이 묶인다.
    // 대신 createOrder 가 이전 미결제 주문을 대체(CANCELLED)해 "진행 중 1건"을 유지하고,
    // 동시 생성 경합은 045 의 orders 부분 UNIQUE 인덱스가 원자적으로 막는다.
    const active = await listActiveCouponOrders(userId, coupon.code);
    if (active.data === null) {
      console.error(
        JSON.stringify({
          event: 'coupon_active_orders_check_db_error',
          error: active.error,
        }),
      );
      return { valid: false, errorCode: 'COUPON_INVALID' };
    }
    if (active.data.some((o) => o.status !== 'CREATED')) {
      return { valid: false, errorCode: 'COUPON_ALREADY_USED' };
    }
  }

  const discount = calcCouponDiscount(coupon, subtotal, payable);
  if (discount <= 0) {
    // 계약(CouponValidationResult): valid=true ⇒ 0 < discount. 할인이 0 으로
    // 계산되는 쿠폰을 "적용"하면 사용 횟수만 소모된다 — 거부가 안전하다.
    return { valid: false, errorCode: 'COUPON_INVALID' };
  }

  return {
    valid: true,
    couponId: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    discount,
  };
}

// ---------- consumeCoupon (원자 차감 + 회원 원장) ----------

/**
 * 쿠폰 사용 확정 — 결제 확정(PAID) 전이를 소유한 경로가 호출한다(FS-X-FIX-A P1-2).
 *
 * §4 SQL 시맨틱(`SET used_count = used_count + 1 WHERE id = ? AND is_active
 * AND (usage_limit IS NULL OR used_count < usage_limit)`, 0행 = 소진 거부)을
 * CAS 로 구현: 읽은 used_count 를 WHERE 에 고정해 갱신하므로 동시 요청이
 * 같은 슬롯을 이중 사용할 수 없다. 회원이면 redemptions INSERT(UNIQUE 충돌
 * 23505 = COUPON_ALREADY_USED — used_count 를 즉시 원복).
 *
 * 주문 연결(보안 검토 P1-3): 원장 행에 order_id(042 컬럼 — 항상)와 order_no(045
 * 적용 시)를 남긴다. 045 적용 후에는 비회원 사용도 user_id NULL 행으로 기록해,
 * 복원이 "그 주문이 실제로 소비했는가"를 회원·비회원 모두 판정할 수 있다.
 * 같은 주문의 재소비는 멱등 성공(차감 없음).
 */
export async function consumeCoupon(
  couponId: CouponId,
  userId: UserId | null,
  orderNo: OrderNo,
  orderId: OrderId,
): Promise<ConsumeCouponResult> {
  const supabase = getServiceRoleSupabase();

  // 주문 단위 멱등: 이 주문이 이미 소비했으면 다시 차감하지 않는다.
  const already = await findRedemptionByOrder(couponId, orderId);
  if (already.error != null) {
    console.error(
      JSON.stringify({
        event: 'coupon_consume_order_check_error',
        orderNo,
        error: already.error,
      }),
    );
    return { ok: false, errorCode: 'COUPON_INVALID', error: already.error };
  }
  if (already.found) return { ok: true };

  // 원장 행: 회원은 항상(1인 1회 근거), 비회원은 045 적용 후에만(user_id NULL 허용).
  const ledgerAvailable = await isCouponOrderLedgerAvailable();
  const writesLedger = userId != null || ledgerAvailable;

  let incremented = false;
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS && !incremented; attempt += 1) {
    const { data: row, error: readErr } = await supabase
      .from('coupons')
      .select('id, is_active, usage_limit, used_count')
      .eq('id', couponId as string)
      .maybeSingle();

    if (readErr) {
      console.error(
        JSON.stringify({
          event: 'coupon_consume_read_error',
          orderNo,
          error: readErr.message,
        }),
      );
      return { ok: false, errorCode: 'COUPON_INVALID', error: readErr.message };
    }
    const current = row as
      | { id: string; is_active: boolean; usage_limit: number | null; used_count: number }
      | null;
    // 행 부재/비활성/한도 도달 = §4 조건부 UPDATE 의 0행 시맨틱 → 소진 거부.
    if (!current || !current.is_active) {
      return { ok: false, errorCode: 'COUPON_EXHAUSTED', error: 'coupon not consumable' };
    }
    if (current.usage_limit != null && current.used_count >= current.usage_limit) {
      return { ok: false, errorCode: 'COUPON_EXHAUSTED', error: 'usage limit reached' };
    }

    // CAS: used_count 가 읽은 값 그대로일 때만 +1. 경합으로 0행이면 재시도 —
    // 재시도 중 한도에 닿으면 위 검사가 EXHAUSTED 로 거부한다.
    const { data: updated, error: updErr } = await supabase
      .from('coupons')
      .update({ used_count: current.used_count + 1 })
      .eq('id', couponId as string)
      .eq('is_active', true)
      .eq('used_count', current.used_count)
      .select('id')
      .maybeSingle();

    if (updErr) {
      console.error(
        JSON.stringify({
          event: 'coupon_consume_update_error',
          orderNo,
          error: updErr.message,
        }),
      );
      return { ok: false, errorCode: 'COUPON_INVALID', error: updErr.message };
    }
    if (updated) incremented = true;
  }

  if (!incremented) {
    // CAS 경합이 상한까지 지속 — 초과 사용 방지가 우선이므로 거부(안전 방향).
    console.error(
      JSON.stringify({ event: 'coupon_consume_contention', orderNo, couponId }),
    );
    return {
      ok: false,
      errorCode: 'COUPON_EXHAUSTED',
      error: 'coupon consume contention',
    };
  }

  // 사용 원장 — 회원 1인 1회는 UNIQUE(coupon_id, user_id), 주문당 1행은 045 의
  // UNIQUE(order_id)가 원자 근거. order_no 는 045 컬럼이라 conditional-spread.
  if (writesLedger) {
    const { error: insErr } = await supabase.from('coupon_redemptions').insert({
      coupon_id: couponId as string,
      user_id: userId != null ? (userId as string) : null,
      order_id: orderId as string,
      ...(ledgerAvailable ? { order_no: orderNo as string } : {}),
    });

    if (insErr) {
      // 방금 올린 used_count 를 되돌린다. 23505(중복)면 이미 존재하는 행은
      // 경쟁 요청의 것 — 삭제하면 남의 사용 근거가 사라지므로 건드리지 않는다.
      await decrementUsedCount(couponId, orderNo);
      if (insErr.code === '23505') {
        // 같은 주문의 동시 소비가 먼저 기록했다면 멱등 성공(우리 +1 은 방금 원복).
        const raced = await findRedemptionByOrder(couponId, orderId);
        if (raced.found) return { ok: true };
        return {
          ok: false,
          errorCode: 'COUPON_ALREADY_USED',
          error: 'coupon already redeemed by this user',
        };
      }
      console.error(
        JSON.stringify({
          event: 'coupon_redemption_insert_error',
          orderNo,
          error: insErr.message,
        }),
      );
      return { ok: false, errorCode: 'COUPON_INVALID', error: insErr.message };
    }
  }

  return { ok: true };
}

// ---------- 주문 단위 복원 (보상 — 보안 검토 P1-3) ----------

/** 복원을 건너뛴 이유를 남긴다 — 운영 수동 보정 판단 근거(쿠폰이 묶인 채 남는 쪽). */
function logReleaseSkipped(
  couponId: CouponId,
  orderId: OrderId,
  reason: string,
): void {
  console.warn(
    JSON.stringify({
      event: 'coupon_release_skipped',
      couponId,
      orderId,
      reason,
    }),
  );
}

/**
 * 취소/환불된 주문의 쿠폰 사용을 되돌린다 — **그 주문이 실제로 소비했을 때만**
 * 원장 행 삭제 + used_count −1(GREATEST(used_count - 1, 0)).
 *
 * 042 의 복원은 coupon_id + user_id 로 무조건 지웠다. 소비에 실패한 주문 B 를 취소하면
 * 주문 A 의 사용 기록이 지워져 쿠폰이 다시 쓸 수 있게 되던 결함(P1-3)의 수정:
 *  1. 이 주문(order_id)이 남긴 행이 있으면 그 행만 지우고 −1.
 *  2. 없고 비회원이면: 045 적용 후에는 비회원 소비도 항상 행을 남기므로 "소비 안 함" →
 *     무동작. 045 미적용이면 비회원 소비는 기록되지 않아 판정 불가 → 기존 동작(−1) 유지.
 *  3. 없고 회원이면: 주문 연결 이전(이 수정 배포 전)에 소비된 행은 order_id 가 NULL 이다.
 *     그 행은 이 회원이 이 쿠폰으로 가진 다른 진행 중 주문이 없을 때만 이 주문의 것으로
 *     확정할 수 있다 → 그때만 지우고 −1. 다른 주문의 행(order_id ≠ 이 주문)은 절대
 *     건드리지 않는다.
 * 판정할 수 없으면 복원하지 않는다(쿠폰이 묶인 채 남는 쪽 — 초과 사용보다 안전).
 * DB 오류도 같은 방향으로 무동작 + 구조화 로그.
 */
async function releaseCouponForOrder(
  couponId: CouponId,
  code: string,
  userId: UserId | null,
  orderId: OrderId,
): Promise<void> {
  const supabase = getServiceRoleSupabase();

  // 1. 이 주문이 남긴 사용 기록.
  const { data: deleted, error: delErr } = await supabase
    .from('coupon_redemptions')
    .delete()
    .eq('coupon_id', couponId as string)
    .eq('order_id', orderId as string)
    .select('id');
  if (delErr) {
    console.error(
      JSON.stringify({
        event: 'coupon_release_redemption_failed',
        couponId,
        orderId,
        error: delErr.message,
      }),
    );
    return;
  }
  if ((deleted ?? []).length > 0) {
    await decrementUsedCount(couponId, null);
    return;
  }

  // 2. 비회원.
  if (userId == null) {
    if (await isCouponOrderLedgerAvailable()) {
      logReleaseSkipped(couponId, orderId, 'guest_order_not_consumed');
      return;
    }
    await decrementUsedCount(couponId, null);
    return;
  }

  // 3. 회원 — 주문 연결 이전의 레거시 행.
  const { data: legacy, error: legacyErr } = await supabase
    .from('coupon_redemptions')
    .select('id')
    .eq('coupon_id', couponId as string)
    .eq('user_id', userId as string)
    .is('order_id', null)
    .maybeSingle();
  if (legacyErr) {
    console.error(
      JSON.stringify({
        event: 'coupon_release_legacy_lookup_failed',
        couponId,
        orderId,
        error: legacyErr.message,
      }),
    );
    return;
  }
  if (!legacy) {
    // 이 주문은 소비하지 않았다(소비 실패 등). 있는 행은 다른 주문의 것 — 보존.
    logReleaseSkipped(couponId, orderId, 'member_order_not_consumed');
    return;
  }

  const others = await listActiveCouponOrders(userId, code);
  if (others.data === null) {
    console.error(
      JSON.stringify({
        event: 'coupon_release_legacy_lookup_failed',
        couponId,
        orderId,
        error: others.error,
      }),
    );
    return;
  }
  if (others.data.some((o) => o.id !== orderId)) {
    logReleaseSkipped(couponId, orderId, 'legacy_redemption_ambiguous');
    return;
  }

  const legacyId = (legacy as { id: string }).id;
  const { data: legacyDeleted, error: legacyDelErr } = await supabase
    .from('coupon_redemptions')
    .delete()
    .eq('id', legacyId)
    .is('order_id', null)
    .select('id');
  if (legacyDelErr) {
    console.error(
      JSON.stringify({
        event: 'coupon_release_redemption_failed',
        couponId,
        orderId,
        error: legacyDelErr.message,
      }),
    );
    return;
  }
  if ((legacyDeleted ?? []).length > 0) {
    await decrementUsedCount(couponId, null);
  }
}

// ---------- 결제 승인 직전 확인 (보안 검토 P1-3) ----------

/** checkCouponPayable 결과 — 거부는 계약 에러코드로 판별 가능해야 한다. */
export type CouponPayableResult =
  | { ok: true }
  | { ok: false; errorCode: CouponErrorCode };

/**
 * Toss 승인 API 를 부르기 직전, 이 주문의 쿠폰 할인을 아직 지킬 수 있는지 확인한다
 * (읽기 전용). 소비는 PAID 이후라 결제를 되돌릴 수 없으므로, 청구가 일어나기 전에
 * 이미 사용된/소진된 쿠폰을 거부하는 마지막 지점이다:
 *  - 회원: 이 쿠폰의 사용 기록이 다른 주문 것으로 있거나, 이 쿠폰을 단 다른 결제완료
 *    계열 주문이 있으면 COUPON_ALREADY_USED.
 *  - 전체 한도: used_count ≥ usage_limit 이면 COUPON_EXHAUSTED(비회원 초과 사용 포함).
 * 이 주문이 이미 소비했다면(멱등 재확정) 통과.
 *
 * 쿠폰 행 부재·비활성·만료는 거부하지 않는다 — 주문 생성 시 유효했던 할인을 사후 정책
 * 변경으로 결제 단계에서 막지 않는 기존 동작을 유지한다(소비 단계가 로그로 남긴다).
 * DB 오류도 통과(fail-open)한다: 이 확인은 추가 방어선이고, 원자 근거는 045 인덱스와
 * 소비 단계의 UNIQUE/CAS 다 — 일시 오류로 정상 결제를 막지 않는다.
 * 동시에 승인되는 결제끼리는 둘 다 통과할 수 있다(남는 틈 — 045 가 회원 쪽을 닫는다).
 */
export async function checkCouponPayable(
  code: string,
  userId: UserId | null,
  orderId: OrderId,
): Promise<CouponPayableResult> {
  const logError = (stage: string, error: string): void => {
    console.error(
      JSON.stringify({ event: 'coupon_payable_check_error', stage, orderId, error }),
    );
  };
  try {
    const supabase = getServiceRoleSupabase();
    const { data, error } = await supabase
      .from('coupons')
      .select('id, usage_limit, used_count')
      .eq('code', normalizeCouponCode(code))
      .maybeSingle();
    if (error) {
      logError('coupon', error.message);
      return { ok: true };
    }
    if (!data) return { ok: true };
    const row = data as unknown as {
      id: string;
      usage_limit: number | null;
      used_count: number;
    };
    const couponId = asBrand<CouponId>(row.id);

    const own = await findRedemptionByOrder(couponId, orderId);
    if (own.error != null) {
      logError('own_redemption', own.error);
      return { ok: true };
    }
    if (own.found) return { ok: true };

    if (userId != null) {
      const { data: redemption, error: rErr } = await supabase
        .from('coupon_redemptions')
        .select('id')
        .eq('coupon_id', row.id)
        .eq('user_id', userId as string)
        .maybeSingle();
      if (rErr) {
        logError('member_redemption', rErr.message);
        return { ok: true };
      }
      if (redemption) return { ok: false, errorCode: 'COUPON_ALREADY_USED' };

      const active = await listActiveCouponOrders(userId, code);
      if (active.data === null) {
        logError('active_orders', active.error);
        return { ok: true };
      }
      if (active.data.some((o) => o.id !== orderId && o.status !== 'CREATED')) {
        return { ok: false, errorCode: 'COUPON_ALREADY_USED' };
      }
    }

    if (row.usage_limit != null && row.used_count >= row.usage_limit) {
      return { ok: false, errorCode: 'COUPON_EXHAUSTED' };
    }
    return { ok: true };
  } catch (err) {
    logError('unexpected', err instanceof Error ? err.message : String(err));
    return { ok: true };
  }
}

/**
 * used_count 원복(CAS, 0 미만 방지). consume 의 23505 원복과 releaseCouponForOrder 가
 * 공유한다. 실패해도 던지지 않는다 — 과소집계는 한도 검증이 차감 시점에만
 * 일어나므로 안전 방향 오차다(ADR-026 Consequences).
 */
async function decrementUsedCount(
  couponId: CouponId,
  orderNo: OrderNo | null,
): Promise<void> {
  const supabase = getServiceRoleSupabase();
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt += 1) {
    const { data: row, error: readErr } = await supabase
      .from('coupons')
      .select('id, used_count')
      .eq('id', couponId as string)
      .maybeSingle();
    if (readErr || !row) {
      console.error(
        JSON.stringify({
          event: 'coupon_decrement_read_failed',
          couponId,
          orderNo,
          error: readErr?.message ?? 'coupon row not found',
        }),
      );
      return;
    }
    const current = (row as { used_count: number }).used_count;
    if (current <= 0) return; // GREATEST(used_count - 1, 0) — 이미 바닥.

    const { data: updated, error: updErr } = await supabase
      .from('coupons')
      .update({ used_count: current - 1 })
      .eq('id', couponId as string)
      .eq('used_count', current)
      .select('id')
      .maybeSingle();
    if (updErr) {
      console.error(
        JSON.stringify({
          event: 'coupon_decrement_update_failed',
          couponId,
          orderNo,
          error: updErr.message,
        }),
      );
      return;
    }
    if (updated) return;
    // CAS 경합 — 재시도.
  }
  console.error(
    JSON.stringify({ event: 'coupon_decrement_contention', couponId, orderNo }),
  );
}

// ---------- code → id resolver (confirm/cancel 스냅샷 경로) ----------

/**
 * orders.coupon_code 스냅샷(정규화 코드)으로 coupon id 를 되찾는다. consume/release
 * 는 id 기반 원자 연산이지만, 결제 확정(PAID)·취소/환불 시점에는 주문 스냅샷의
 * code 만 갖고 있으므로(주문은 couponId 를 저장하지 않는다) 이 얇은 조회로 잇는다.
 * 부재/오류는 null — 호출측이 안전 방향(consume=거부, release=무동작)으로 처리한다.
 */
async function findCouponIdByCode(code: string): Promise<CouponId | null> {
  const normalized = normalizeCouponCode(code);
  if (normalized.length === 0) return null;
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('coupons')
    .select('id')
    .eq('code', normalized)
    .maybeSingle();
  if (error) {
    console.error(
      JSON.stringify({ event: 'coupon_lookup_by_code_error', error: error.message }),
    );
    return null;
  }
  return data ? asBrand<CouponId>((data as { id: string }).id) : null;
}

/**
 * 결제 확정(PAID) 시점의 쿠폰 사용 확정 (FS-X-FIX-A P1-2). createOrder 는 할인을
 * 예약(orders.coupon_code/coupon_discount 스냅샷)만 하고, 실제 원자 소비는 여기서
 * 일어난다 — 결제 실패·재시도가 회원의 1인 1회 쿠폰을 영구 소멸시키지 않게 한다.
 * 주문 스냅샷 code 로 id 를 되찾아 consumeCoupon 원자 경로에 위임한다. 쿠폰 행이
 * 사라졌으면(관리자 삭제) 안전 방향으로 거부(COUPON_INVALID) — 결제는 이미
 * 성사됐으므로 호출측(confirm.ts)이 fail-open 으로 주문을 유지한다.
 */
export async function consumeCouponByCode(
  code: string,
  userId: UserId | null,
  orderNo: OrderNo,
  orderId: OrderId,
): Promise<ConsumeCouponResult> {
  const couponId = await findCouponIdByCode(code);
  if (couponId == null) {
    return {
      ok: false,
      errorCode: 'COUPON_INVALID',
      error: 'coupon not found for snapshot code',
    };
  }
  return consumeCoupon(couponId, userId, orderNo, orderId);
}

/**
 * 취소/환불 시 쿠폰 사용 복원 (FS-X-FIX-A P1-1 + 보안 검토 P1-3). 주문이 PAID 이후
 * 에서 취소/환불로 전이 **성공한 뒤에만** 호출한다 — CREATED(미결제) 취소는 애초에
 * 소비하지 않았으므로 호출측이 걸러낸다. 주문 스냅샷 code 로 id 를 되찾아
 * releaseCouponForOrder(그 주문이 실제로 소비했을 때만 복원)에 위임한다.
 * never throws — reversePointsForOrder 미러, fire-and-forget 안전.
 */
export async function releaseCouponByOrder(
  code: string,
  userId: UserId | null,
  orderId: OrderId,
): Promise<void> {
  try {
    const couponId = await findCouponIdByCode(code);
    if (couponId == null) return; // 삭제된 쿠폰 등 — 복원 대상 없음(무동작 안전).
    await releaseCouponForOrder(couponId, code, userId, orderId);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'coupon_release_failed',
        orderId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ---------- admin CRUD ----------

/** 어드민 쿠폰 목록 — 최신 생성순. */
export async function listCoupons(): Promise<DbResult<Coupon[]>> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('coupons')
    .select(COUPON_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) return { data: null, error: error.message };
  return {
    data: ((data ?? []) as unknown as CouponRow[]).map(mapCoupon),
    error: null,
  };
}

/** date-only('YYYY-MM-DD') 판별 — 어드민 폼(<input type="date">)의 출력 형태. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 만료일 저장 정규화(순수 함수, 테스트용 export). date-only 입력은 만료 "당일"을
 * 포함하도록 KST(+09:00) 당일 23:59:59 로 확정한다 — UTC 자정으로 저장하면
 * KST 오전 9시에 하루 일찍 만료되던 버그(Sec P2) 수정. 시간 성분이 이미 있는
 * 전체 타임스탬프는 그대로 ISO 정규화한다. null/빈 문자열은 무기한(null).
 * 예: '2026-12-31' → '2026-12-31T14:59:59.000Z'(= 2026-12-31T23:59:59+09:00).
 */
export function normalizeCouponExpiry(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (DATE_ONLY_RE.test(trimmed)) {
    return new Date(`${trimmed}T23:59:59+09:00`).toISOString();
  }
  return new Date(trimmed).toISOString();
}

/**
 * 쿠폰 생성/수정. `id` 가 있으면 해당 행 UPDATE, 없으면 INSERT.
 * code 는 normalizeCouponCode 로 정규화 후 저장(042 CHECK 와 동일 계약).
 * used_count 는 결코 이 경로로 쓰지 않는다(원자 차감/보상 전용).
 * expiresAt/usageLimit 의 undefined 는 null(무기한/무제한)로 취급한다 —
 * 어드민 폼은 항상 전체 필드를 보낸다. 만료일은 normalizeCouponExpiry 로
 * KST 당일 종료시각(23:59:59+09:00)에 확정한다(만료 당일 포함).
 */
export async function upsertCoupon(
  input: CouponInput & { id?: CouponId },
): Promise<DbResult<Coupon>> {
  const supabase = getServiceRoleSupabase();

  const expiresAt = normalizeCouponExpiry(input.expiresAt);
  const patch = {
    code: normalizeCouponCode(input.code),
    type: input.type,
    value: input.value,
    min_subtotal: input.minSubtotal ?? 0,
    expires_at: expiresAt,
    usage_limit: input.usageLimit ?? null,
    is_active: input.isActive ?? true,
  };

  const query =
    input.id != null
      ? supabase
          .from('coupons')
          .update(patch)
          .eq('id', input.id as string)
          .select(COUPON_COLUMNS)
          .maybeSingle()
      : supabase.from('coupons').insert(patch).select(COUPON_COLUMNS).maybeSingle();

  const { data, error } = await query;
  if (error) {
    if (error.code === '23505') {
      return { data: null, error: '이미 존재하는 쿠폰 코드입니다.' };
    }
    return { data: null, error: error.message };
  }
  if (!data) return { data: null, error: 'upsertCoupon: not found' };
  return { data: mapCoupon(data as unknown as CouponRow), error: null };
}

/** 쿠폰 활성/비활성 토글 — 사용 이력이 있는 쿠폰의 권장 은퇴 경로. */
export async function toggleCouponActive(
  id: CouponId,
  isActive: boolean,
): Promise<DbResult<Coupon>> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('coupons')
    .update({ is_active: isActive })
    .eq('id', id as string)
    .select(COUPON_COLUMNS)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'toggleCouponActive: not found' };
  return { data: mapCoupon(data as unknown as CouponRow), error: null };
}

/**
 * 쿠폰 삭제 — 사용 이력이 전혀 없을 때만(회원 redemptions 0건 AND
 * used_count 0 — 비회원 사용은 redemptions 미기록이라 카운터도 본다).
 * 이력이 있으면 에러 반환(FK CASCADE 가 1인 1회 원장을 지워버리므로
 * 비활성화를 권장한다). 주문 표시는 orders.coupon_code 스냅샷이라 무관.
 */
export async function deleteCoupon(id: CouponId): Promise<DbResult<true>> {
  const supabase = getServiceRoleSupabase();

  const { data: row, error: readErr } = await supabase
    .from('coupons')
    .select('id, used_count')
    .eq('id', id as string)
    .maybeSingle();
  if (readErr) return { data: null, error: readErr.message };
  if (!row) return { data: null, error: 'deleteCoupon: not found' };
  if ((row as { used_count: number }).used_count > 0) {
    return {
      data: null,
      error: '사용 이력이 있는 쿠폰은 삭제할 수 없습니다. 비활성화를 사용하세요.',
    };
  }

  const { count, error: cntErr } = await supabase
    .from('coupon_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('coupon_id', id as string);
  if (cntErr) return { data: null, error: cntErr.message };
  if ((count ?? 0) > 0) {
    return {
      data: null,
      error: '사용 이력이 있는 쿠폰은 삭제할 수 없습니다. 비활성화를 사용하세요.',
    };
  }

  const { data, error } = await supabase
    .from('coupons')
    .delete()
    .eq('id', id as string)
    .select('id')
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'deleteCoupon: not found' };
  return { data: true, error: null };
}
