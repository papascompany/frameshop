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

/**
 * 확장형 묶음 카트 DB 동기화(ADR-025): cart_items.project_id (migration 035).
 * 035 는 cart_projects(034) FK 를 참조하므로 이 컬럼 존재 = 034·035 모두 적용됨
 * (단일 probe 로 충분). false → 로그인 카트 동기화가 project 필드(project_id/
 * project_seq/orientation)를 생략하고 평면 저장한다 — 묶음 정보는 주문 생성 시
 * variant_snapshot(jsonb)에 동결돼 보존되므로 유실이 아니다(ADR-025 폴백 계약).
 * 익명 카트(localStorage v2)는 이 probe 와 무관하게 완전 동작한다.
 */
export function isProjectCartAvailable(): Promise<boolean> {
  return probeFeature('projectCart', 'cart_items', 'project_id');
}

// ---------- FS-X 웨이브 probes (ADR-026 — 배포~적용 창 graceful 게이트) ----------

/** 세트 템플릿(036): set_templates.id — 어드민 세트 탭·카탈로그 세트 노출 게이트. */
export function isSetTemplatesAvailable(): Promise<boolean> {
  return probeFeature('setTemplates', 'set_templates', 'id');
}

/** 구성 규칙(037): bundle_rules.id — 어드민 구성규칙 탭·구성 검증 게이트. */
export function isBundleRulesAvailable(): Promise<boolean> {
  return probeFeature('bundleRules', 'bundle_rules', 'id');
}

/** 1:1 문의(040): inquiries.id — 문의 작성/목록·admin/inquiries 게이트. */
export function isInquiriesAvailable(): Promise<boolean> {
  return probeFeature('inquiries', 'inquiries', 'id');
}

/** 위시리스트(041): wishlists.id — 하트 아일랜드·account/wishlist 게이트. */
export function isWishlistAvailable(): Promise<boolean> {
  return probeFeature('wishlist', 'wishlists', 'id');
}

/**
 * 쿠폰(042): coupons.code — 042 는 coupons/coupon_redemptions/orders 스냅샷
 * 2컬럼(coupon_code/coupon_discount)을 한 파일에서 함께 만들므로 단일 probe 로
 * 충분하다. false → 체크아웃 쿠폰 입력 카드 비노출 + createOrder 쿠폰 경로 거부.
 */
export function isCouponsAvailable(): Promise<boolean> {
  return probeFeature('coupons', 'coupons', 'code');
}
