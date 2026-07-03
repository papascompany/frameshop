/**
 * Feature probe — 마이그레이션 미적용 graceful 게이트 (FS-EC-00).
 *
 * DB 마이그레이션은 CTO 수동 적용(029~035, 038~039 미적용 가정)이므로, 신규
 * 컬럼/테이블에 의존하는 기능은 실제 스키마 존재 여부를 probe 해서 켠다.
 * `select <column> limit 0` 은 행을 읽지 않아 비용이 0에 가깝고, 스키마 부재 시
 * 42703(undefined_column)/42P01(undefined_table)/PGRST 계열 에러로 판별된다.
 *
 * 캐시: 성공(true)은 영구(스키마는 롤백되지 않음 — 마이그레이션 불변 원칙),
 * 실패(false)는 60초 TTL — CTO 가 적용하면 최대 60초 내 기능이 자동 활성화된다.
 * 스키마 부재가 아닌 일시 오류(네트워크 등)는 캐시하지 않고 다음 호출에서 재시도.
 *
 * server-only: service-role 클라이언트를 쓰므로 클라 번들 유입 시 빌드가 깨진다.
 */

import 'server-only';
import { getServiceRoleSupabase } from '../supabase/service';

const PROBE_TTL_MS = 60_000;

/** 스키마 부재를 뜻하는 Postgres/PostgREST 에러 코드. */
const MISSING_SCHEMA_CODES: ReadonlySet<string> = new Set(['42703', '42P01']);

function isMissingSchemaCode(code: string | null | undefined): boolean {
  if (code == null) return false;
  return MISSING_SCHEMA_CODES.has(code) || code.startsWith('PGRST');
}

type CacheEntry = {
  value: boolean;
  /** epoch ms. `Number.POSITIVE_INFINITY` = 영구(성공 캐시). */
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

/**
 * `table.column` 존재 여부 probe. 성공 → true(영구 캐시), 스키마 부재 →
 * false(60초 캐시), 그 외 오류 → false(비캐시, 다음 호출 재시도).
 */
async function probeFeature(
  key: string,
  table: string,
  column: string,
): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from(table).select(column).limit(0);

  if (!error) {
    cache.set(key, { value: true, expiresAt: Number.POSITIVE_INFINITY });
    return true;
  }
  if (isMissingSchemaCode(error.code)) {
    cache.set(key, { value: false, expiresAt: now + PROBE_TTL_MS });
  }
  return false;
}

// ---------- Public probes (FS-EC-00 계약) ----------

/** 적립금(031): user_profiles.points_balance — 031 은 테이블+컬럼을 함께 만든다. */
export function isPointsAvailable(): Promise<boolean> {
  return probeFeature('points', 'user_profiles', 'points_balance');
}

/** 도서산간 추가 배송비(030): shipping_methods.surcharge_fee_jeju. */
export function isSurchargeAvailable(): Promise<boolean> {
  return probeFeature('surcharge', 'shipping_methods', 'surcharge_fee_jeju');
}

/** 현금영수증(039): orders.receipt_type. */
export function isReceiptAvailable(): Promise<boolean> {
  return probeFeature('receipt', 'orders', 'receipt_type');
}

/** 부분환불(038): orders.refunded_amount. */
export function isPartialRefundAvailable(): Promise<boolean> {
  return probeFeature('partialRefund', 'orders', 'refunded_amount');
}

/** 구매확정(033): orders.confirmed_at. */
export function isConfirmAvailable(): Promise<boolean> {
  return probeFeature('confirm', 'orders', 'confirmed_at');
}
