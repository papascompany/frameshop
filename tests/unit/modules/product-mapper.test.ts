/**
 * mapProduct product_type graceful fallback (ADR-023, 확장형 P0).
 *
 * product_type 는 migration 034 가 적용돼야 존재하는 컬럼이다. 미적용/NULL/예상 외
 * 값은 모두 'single'(현행 단품 경로)로 폴백해야 하며, 적용 시 'extended' 는 그대로
 * 전달돼야 한다 — 034 가 현행 게이트가 아니라 확장형 게이트임을 보장.
 */

import { describe, expect, it } from 'vitest';
import { mapProduct } from '@/lib/db/mappers';

const baseRow = {
  id: 'p-1',
  category_id: 'c-1',
  name: '클래식 액자',
  tagline: '한 줄 소개',
  description: '설명',
  base_price: 12000,
  has_frame: true,
  is_active: true,
  sort_order: 0,
  bleed_mm: 3,
  created_at: '2026-06-24T00:00:00.000Z',
};

describe('mapProduct productType fallback', () => {
  it("defaults to 'single' when product_type is absent (034 unapplied)", () => {
    expect(mapProduct({ ...baseRow }).productType).toBe('single');
  });

  it("defaults to 'single' when product_type is null", () => {
    expect(mapProduct({ ...baseRow, product_type: null }).productType).toBe('single');
  });

  it("passes 'extended' through when set (034 applied)", () => {
    expect(mapProduct({ ...baseRow, product_type: 'extended' }).productType).toBe(
      'extended',
    );
  });

  it("maps an unexpected value to 'single' (defensive)", () => {
    expect(
      mapProduct({ ...baseRow, product_type: 'bogus' }).productType,
    ).toBe('single');
  });

  it("keeps 'single' as single", () => {
    expect(mapProduct({ ...baseRow, product_type: 'single' }).productType).toBe(
      'single',
    );
  });
});
