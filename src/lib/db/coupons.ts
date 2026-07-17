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
 * - 보상(releaseCoupon)은 never-throws — 주문 생성 실패 흐름을 막지 않고
 *   구조화 로그만 남긴다(points 보상 패턴 미러).
 */

import 'server-only';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { asBrand } from '@/types/common';
import type { CouponId, OrderNo, UserId } from '@/types/common';
import type {
  Coupon,
  CouponErrorCode,
  CouponInput,
  CouponType,
  CouponValidationResult,
} from '@/types/coupon';
import { calcCouponDiscount, normalizeCouponCode } from '@/lib/coupon/calc';

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
 * 쿠폰 사용 확정 — 주문 INSERT 직전에 호출한다(ADR-026 §6).
 *
 * §4 SQL 시맨틱(`SET used_count = used_count + 1 WHERE id = ? AND is_active
 * AND (usage_limit IS NULL OR used_count < usage_limit)`, 0행 = 소진 거부)을
 * CAS 로 구현: 읽은 used_count 를 WHERE 에 고정해 갱신하므로 동시 요청이
 * 같은 슬롯을 이중 사용할 수 없다. 회원이면 redemptions INSERT(UNIQUE 충돌
 * 23505 = COUPON_ALREADY_USED — used_count 를 즉시 원복).
 *
 * @param orderNo 로그 연결용 — 주문 행이 아직 없어 redemptions.order_id 는
 *   NULL 로 남는다(042 계약: 사용 이력은 주문과 독립적으로 유지).
 */
export async function consumeCoupon(
  couponId: CouponId,
  userId: UserId | null,
  orderNo: OrderNo,
): Promise<ConsumeCouponResult> {
  const supabase = getServiceRoleSupabase();

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

  // 회원 1인 1회 원장 — UNIQUE(coupon_id, user_id)가 원자 근거.
  if (userId != null) {
    const { error: insErr } = await supabase
      .from('coupon_redemptions')
      .insert({ coupon_id: couponId as string, user_id: userId as string });

    if (insErr) {
      // 방금 올린 used_count 를 되돌린다. 23505(중복)면 이미 존재하는 행은
      // 경쟁 요청의 것 — 삭제하면 남의 사용 근거가 사라지므로 건드리지 않는다.
      await decrementUsedCount(couponId, orderNo);
      if (insErr.code === '23505') {
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

// ---------- releaseCoupon (보상 — never throws) ----------

/**
 * 보상 트랜잭션: consumeCoupon 이후 주문 생성이 실패했을 때 사용을 되돌린다 —
 * 회원 redemptions 행 삭제 + used_count 원복(GREATEST(used_count - 1, 0)).
 * consume 의 역순(원장 삭제 → 카운터 원복). never throws — 실패는 구조화
 * 로그만 남긴다(운영 수동 보정 대상, points 보상 패턴 미러).
 */
export async function releaseCoupon(
  couponId: CouponId,
  userId: UserId | null,
): Promise<void> {
  try {
    const supabase = getServiceRoleSupabase();

    if (userId != null) {
      const { error: delErr } = await supabase
        .from('coupon_redemptions')
        .delete()
        .eq('coupon_id', couponId as string)
        .eq('user_id', userId as string);
      if (delErr) {
        console.error(
          JSON.stringify({
            event: 'coupon_release_redemption_failed',
            couponId,
            error: delErr.message,
          }),
        );
      }
    }

    await decrementUsedCount(couponId, null);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'coupon_release_failed',
        couponId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * used_count 원복(CAS, 0 미만 방지). consume 의 23505 원복과 releaseCoupon 이
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
): Promise<ConsumeCouponResult> {
  const couponId = await findCouponIdByCode(code);
  if (couponId == null) {
    return {
      ok: false,
      errorCode: 'COUPON_INVALID',
      error: 'coupon not found for snapshot code',
    };
  }
  return consumeCoupon(couponId, userId, orderNo);
}

/**
 * 취소/환불 시 쿠폰 사용 복원 (FS-X-FIX-A P1-1). 주문이 PAID 이후(쿠폰이 실제
 * 소비된 상태)에서 취소/환불로 전이 **성공한 뒤에만** 호출한다 — CREATED(미결제)
 * 취소는 애초에 소비하지 않았으므로 호출측이 걸러낸다. 주문 스냅샷 code 로 id 를
 * 되찾아 releaseCoupon 보상 경로(used_count 원복 + 회원 redemptions 삭제)에
 * 위임한다. never throws — reversePointsForOrder 미러, fire-and-forget 안전.
 */
export async function releaseCouponByOrder(
  code: string,
  userId: UserId | null,
): Promise<void> {
  const couponId = await findCouponIdByCode(code);
  if (couponId == null) return; // 삭제된 쿠폰 등 — 복원 대상 없음(무동작 안전).
  await releaseCoupon(couponId, userId);
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
