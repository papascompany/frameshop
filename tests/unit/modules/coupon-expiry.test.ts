/**
 * normalizeCouponExpiry — 만료일 저장 정규화 (Sec P2, ADR-026).
 *
 * date-only(<input type="date"> 출력)를 UTC 자정이 아니라 KST(+09:00) 당일
 * 23:59:59 로 확정한다 — 만료 "당일"을 포함하고, KST 오전 9시 조기 만료 버그를
 * 막는다. 순수 함수(서버 클라이언트 미접근)라 서버 스텁만으로 검증 가능하다.
 */

import { describe, expect, it } from 'vitest';
import { normalizeCouponExpiry } from '@/lib/db/coupons';

describe('normalizeCouponExpiry', () => {
  it("date-only 를 KST 당일 23:59:59(+09:00)로 확정한다 (만료 당일 포함)", () => {
    const iso = normalizeCouponExpiry('2026-12-31');
    expect(iso).not.toBeNull();
    // +09:00 당일 종료시각과 시각 동치.
    expect(Date.parse(iso as string)).toBe(
      Date.parse('2026-12-31T23:59:59+09:00'),
    );
    // UTC 자정(조기 만료) 회귀 가드.
    expect(iso).not.toBe('2026-12-31T00:00:00.000Z');
    expect(iso).toBe('2026-12-31T14:59:59.000Z');
  });

  it('null/undefined/빈 문자열/공백 → null(무기한)', () => {
    expect(normalizeCouponExpiry(null)).toBeNull();
    expect(normalizeCouponExpiry(undefined)).toBeNull();
    expect(normalizeCouponExpiry('')).toBeNull();
    expect(normalizeCouponExpiry('   ')).toBeNull();
  });

  it('시간 성분이 있는 전체 타임스탬프는 그대로 ISO 정규화한다', () => {
    expect(normalizeCouponExpiry('2026-06-30T12:00:00Z')).toBe(
      '2026-06-30T12:00:00.000Z',
    );
  });
});
