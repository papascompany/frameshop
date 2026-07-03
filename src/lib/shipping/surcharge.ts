/**
 * 제주/도서산간 추가 배송비 — 순수 함수 (migration 030, ADR-008 스냅샷).
 *
 * 클라(체크아웃 표시)와 서버(createOrder 권위 재계산) **공용** 모듈이므로
 * server-only 를 import 하지 않는다. IO 없음 — UT 대상.
 *
 * 흐름: classifyZip(shipping.zip) → calcSurcharge(region, method) → 서버가
 * orders.surcharge_fee 로 동결(030 주석: 서버가 권위 있게 재계산하여 저장).
 *
 * FROZEN: 2026-07-03 by Architect (FS-EC-00).
 */

import type { ShippingMethod } from '@/types/shipping';

// ---------- Region union ----------

export const ZIP_REGIONS = ['mainland', 'jeju', 'remote'] as const;

export type ZipRegion = (typeof ZIP_REGIONS)[number];

// ---------- Zip ranges ----------

/** 제주특별자치도 신우편번호 전 범위(추자도·우도 포함). 030 주석: "제주 63xxx". */
const JEJU_ZIP_MIN = 63000;
const JEJU_ZIP_MAX = 63644;

/**
 * 도서산간(제주 외) 대표 우편번호 범위 — 우체국택배·주요 택배사가 공개하는
 * "도서(제주 외) 추가요금" 권역의 통상 리스트를 기반으로 한 대표 범위.
 * 세부 권역(신안·통영 부속도서 등)은 운영 정책 확정 시 범위를 **추가**한다
 * (추가 = 비파괴; 기존 판정 결과를 바꾸지 않음).
 */
const REMOTE_ZIP_RANGES: ReadonlyArray<readonly [number, number]> = [
  [23004, 23010], // 인천 옹진군 백령면(백령도·대청도·소청도)
  [23100, 23116], // 인천 옹진군 연평면·북도면 일대
  [23124, 23136], // 인천 옹진군 덕적면·자월면 일대
  [40200, 40240], // 경북 울릉군(울릉도·독도)
];

// ---------- Pure functions (UT target) ----------

/**
 * 우편번호 → 권역 판정.
 * 5자리 숫자가 아니면 'mainland'(추가비 0) — PICKUP 은 zip 이 빈 문자열일 수
 * 있고(checkout 스키마), zip 형식 자체는 shippingAddressSchema 가 검증한다.
 */
export function classifyZip(zip: string): ZipRegion {
  if (!/^\d{5}$/.test(zip)) return 'mainland';
  const n = Number(zip);
  if (n >= JEJU_ZIP_MIN && n <= JEJU_ZIP_MAX) return 'jeju';
  for (const [min, max] of REMOTE_ZIP_RANGES) {
    if (n >= min && n <= max) return 'remote';
  }
  return 'mainland';
}

/**
 * 권역 + 배송방법 설정 → 추가 배송비(KRW).
 * 030 주석 준수: STANDARD 에만 부과, PICKUP/QUICK 은 항상 0.
 * surcharge 설정 부재(030 미적용 → mapShippingMethod 0 폴백/undefined)는 0.
 */
export function calcSurcharge(
  region: ZipRegion,
  method: {
    code: ShippingMethod;
    surchargeFeeJeju?: number;
    surchargeFeeRemote?: number;
  },
): number {
  if (method.code !== 'STANDARD') return 0;
  if (region === 'jeju') return method.surchargeFeeJeju ?? 0;
  if (region === 'remote') return method.surchargeFeeRemote ?? 0;
  return 0;
}
